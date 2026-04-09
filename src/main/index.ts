import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { dirname, join, basename, extname } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, chmodSync, rmSync } from 'fs'
import { homedir } from 'os'
import { spawn, spawnSync, ChildProcess } from 'child_process'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { harnessclawClient } from './harnessclaw'
import { runDoctor } from './doctor'
import {
  type BundledToolStatus,
  ensureBundledRuntimes,
  getBundledClawhubLaunchSpec,
  getBundledClawhubStatus,
  getBundledNanobotLaunchSpec,
  type LaunchSpec,
} from './bundled-tools'
import {
  APP_CONFIG_PATH,
  BIN_DIR,
  ENGINE_CONFIG_PATH,
  ENGINE_HOME,
  HARNESSCLAW_HOME,
  HARNESSCLAW_LAUNCHED_FLAG,
  IS_WINDOWS,
  LEGACY_APP_CONFIG_IN_HOME,
  LEGACY_APP_CONFIG_PATH,
  LEGACY_ENGINE_CONFIG_PATH,
  LEGACY_NANOBOT_HOME,
  NANOBOT_PID_PATH,
  LOGS_DIR,
  NANOBOT_PID_PATH,
  getDefaultWorkspaceSetting,
} from './runtime-paths'
import {
  getDb, closeDb, upsertSession, updateSessionTitle, listSessions as dbListSessions,
  deleteSession as dbDeleteSession, insertMessage, updateMessageContent,
  getMessages, insertToolActivity, insertUsageEvent, listUsageEvents
} from './db'
import {
  ensureLoggingDirs,
  getLogThreshold,
  normalizeLogThreshold,
  readStructuredLogs,
  readTextFile,
  sanitizeForLogging,
  setLogThreshold,
  writeAppLog,
  writeExportFile,
  writeRendererLog,
  writeUsageLog,
  type LogLevel,
  type LogThreshold,
  type UsageLogEntry,
} from './logging'
import { APP_LOG_PATH, RENDERER_LOG_PATH, USAGE_LOG_PATH } from './runtime-paths'

const HARNESSCLAW_DIR = HARNESSCLAW_HOME
const NANOBOT_HOME = ENGINE_HOME
const NANOBOT_CONFIG_PATH = ENGINE_CONFIG_PATH
const SUPPORTED_PROVIDER_KEYS = [
  'custom',
  'azure_openai',
  'anthropic',
  'openai',
  'openrouter',
  'deepseek',
  'groq',
  'zhipu',
  'dashscope',
  'vllm',
  'ollama',
  'gemini',
  'moonshot',
  'minimax',
  'aihubmix',
  'siliconflow',
  'volcengine',
  'volcengine_coding_plan',
  'byteplus',
  'byteplus_coding_plan',
  'openai_codex',
  'github_copilot',
] as const

interface PickedLocalFile {
  name: string
  path: string
  url: string
  size: number
  extension: string
  kind: 'image' | 'video' | 'audio' | 'archive' | 'code' | 'document' | 'data' | 'other'
}

let nanobotProcess: ChildProcess | null = null
let safeConsoleInstalled = false
let configApplyTimer: ReturnType<typeof setTimeout> | null = null
let pendingNanobotConfigApply: Record<string, unknown> | null = null
const DOCTOR_RUN_ONCE = process.argv.includes('--doctor-run-once')
const DOCTOR_FIX_ARG = process.argv.find((arg) => arg.startsWith('--doctor-fix='))?.split('=')[1] || ''
const DOCTOR_WAIT_MS = Math.max(
  0,
  Number.parseInt(process.env.HARNESSCLAW_DOCTOR_WAIT_MS || '12000', 10) || 12000
)

type LocalServiceStatus = 'starting' | 'ready' | 'degraded'
type TransportStatus = 'disconnected' | 'connecting' | 'connected'

interface AppRuntimeStatus {
  localService: LocalServiceStatus
  transport: TransportStatus
  llmConfigured: boolean
  applyingConfig: boolean
  lastError?: string
}

const appRuntimeStatus: AppRuntimeStatus = {
  localService: 'starting',
  transport: 'disconnected',
  llmConfigured: false,
  applyingConfig: false,
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readPidFile(path: string): number | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8').trim()
    const pid = Number.parseInt(raw, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function writePidFile(path: string, pid: number): void {
  ensureDir(dirname(path))
  writeFileSync(path, String(pid), 'utf-8')
}

function clearPidFile(path: string): void {
  try {
    if (existsSync(path)) {
      rmSync(path, { force: true })
    }
  } catch {
    // Ignore PID-file cleanup errors during shutdown.
  }
}

function killProcessTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return

  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < 1500) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Ignore processes that already exited.
  }
}

function collectStaleNanobotPids(): number[] {
  const configNeedles = [NANOBOT_CONFIG_PATH, LEGACY_ENGINE_CONFIG_PATH]
    .map((value) => value.trim())
    .filter(Boolean)
  const pids = new Set<number>()

  const pidFromFile = readPidFile(NANOBOT_PID_PATH)
  if (pidFromFile) {
    pids.add(pidFromFile)
  }

  if (IS_WINDOWS) {
    const escapedNeedles = configNeedles
      .map((value) => value.replace(/'/g, "''"))
      .map((value) => `'${value}'`)
      .join(',')
    const script = `
$needles = @(${escapedNeedles})
$matches = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne ${process.pid} -and
  $_.CommandLine -and
  $_.CommandLine -match 'nanobot(\\.exe)?\\s+gateway'
} | Where-Object {
  $cmd = $_.CommandLine
  foreach ($needle in $needles) {
    if ($cmd -like "*$needle*") { return $true }
  }
  return $false
} | Select-Object -ExpandProperty ProcessId
$matches | ForEach-Object { $_.ToString() }
`
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script], {
      encoding: 'utf-8',
      windowsHide: true,
    })
    if (result.status === 0) {
      for (const line of result.stdout.split(/\r?\n/)) {
        const pid = Number.parseInt(line.trim(), 10)
        if (Number.isFinite(pid) && pid > 0) {
          pids.add(pid)
        }
      }
    }
  } else {
    const result = spawnSync('ps', ['-ax', '-o', 'pid=,command='], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.status === 0) {
      for (const line of result.stdout.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const match = trimmed.match(/^(\d+)\s+(.*)$/)
        if (!match) continue
        const pid = Number.parseInt(match[1], 10)
        const command = match[2]
        if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue
        if (!/nanobot(\.exe)?\s+gateway/.test(command)) continue
        if (configNeedles.some((needle) => command.includes(needle))) {
          pids.add(pid)
        }
      }
    }
  }

  return [...pids]
}

function cleanupStaleNanobotProcesses(): void {
  const stalePids = collectStaleNanobotPids()
  if (stalePids.length === 0) {
    clearPidFile(NANOBOT_PID_PATH)
    return
  }

  console.log('[Nanobot] Cleaning stale gateway processes:', stalePids.join(', '))
  for (const pid of stalePids) {
    killProcessTree(pid)
  }
  clearPidFile(NANOBOT_PID_PATH)
}

function classifyFileKind(extension: string): PickedLocalFile['kind'] {
  const ext = extension.toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'image'
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video'
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return 'audio'
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'archive'
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.cs', '.json', '.yml', '.yaml', '.toml', '.xml', '.md', '.sql', '.sh', '.ps1', '.bat'].includes(ext)) return 'code'
  if (['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.rtf'].includes(ext)) return 'document'
  if (['.csv', '.parquet', '.log'].includes(ext)) return 'data'
  return 'other'
}

function buildPickedLocalFiles(filePaths: string[]): PickedLocalFile[] {
  const uniquePaths = [...new Set(filePaths.map((value) => value.trim()).filter(Boolean))]
  const files: PickedLocalFile[] = []

  for (const filePath of uniquePaths) {
    try {
      const stats = statSync(filePath)
      if (!stats.isFile()) continue

      const extension = extname(filePath)
      files.push({
        name: basename(filePath),
        path: filePath,
        url: pathToFileURL(filePath).toString(),
        size: stats.size,
        extension,
        kind: classifyFileKind(extension),
      })
    } catch (error) {
      console.warn('[Files] Failed to read file metadata:', filePath, error)
    }
  }

  return files
}

function stripAttachmentMetadataFromContent(content: string): string {
  return content
    .replace(/\n?\[HARNESSCLAW_LOCAL_ATTACHMENTS\][\s\S]*?\[\/HARNESSCLAW_LOCAL_ATTACHMENTS\]/g, '')
    .replace(/\n?Attached local files are listed below\.\nUse the local path or file URL with filesystem tools when you need to inspect file contents\./g, '')
    .trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function expandHomePath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2))
  }
  return value
}

function buildChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homedir(),
    USERPROFILE: homedir(),
    NANOBOT_HOME,
  }
}

function buildLaunchEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...buildChildEnv(),
    ...extraEnv,
  }
}

function isBrokenPipeError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: string }).code === 'EPIPE'
}

function installSafeConsole(): void {
  if (safeConsoleInstalled) return
  safeConsoleInstalled = true
  ensureLoggingDirs()

  const methods = ['debug', 'log', 'info', 'warn', 'error'] as const
  for (const method of methods) {
    const original = console[method].bind(console) as (...args: unknown[]) => void
    Object.defineProperty(console, method, {
      value: (...args: unknown[]) => {
        const text = createLogText(args)
        writeAppLog(classifyConsoleLevel(method, text), 'console', text)
        try {
          original(...args)
        } catch (error) {
          if (!isBrokenPipeError(error)) {
            throw error
          }
        }
      },
      configurable: true,
      writable: true,
    })
  }

  // Electron GUI launches can lose stdout/stderr handles, especially on Windows.
  process.stdout?.on('error', () => undefined)
  process.stderr?.on('error', () => undefined)
}

function safeWrite(stream: NodeJS.WriteStream | undefined | null, chunk: string): void {
  if (!stream?.writable) return
  try {
    stream.write(chunk)
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error
    }
  }
}

function createLogText(args: unknown[]): string {
  return args.map((arg) => {
    if (typeof arg === 'string') return arg
    try {
      return JSON.stringify(sanitizeForLogging(arg))
    } catch {
      return String(arg)
    }
  }).join(' ')
}

function classifyConsoleLevel(
  method: 'debug' | 'log' | 'info' | 'warn' | 'error',
  text: string
): LogLevel {
  if (method === 'debug') return 'debug'
  if (method === 'warn') return 'warn'
  if (method === 'error') return 'error'

  if (
    text.startsWith('[Gateway] debug sign')
    || (text.startsWith('[Harnessclaw]') && (text.includes('recv:') || text.includes('send:')))
  ) {
    return 'debug'
  }

  return 'info'
}

function scrubCliArgs(args: string[]): string[] {
  const scrubbed = [...args]
  for (let index = 0; index < scrubbed.length; index += 1) {
    const value = scrubbed[index]
    if (value === '--token' && scrubbed[index + 1]) {
      scrubbed[index + 1] = '[REDACTED]'
    }
  }
  return scrubbed
}

function broadcastAppRuntimeStatus(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('app-runtime:status', { ...appRuntimeStatus })
  })
}

function updateAppRuntimeStatus(patch: Partial<AppRuntimeStatus>): void {
  Object.assign(appRuntimeStatus, patch)
  broadcastAppRuntimeStatus()
}

function trackUsage(entry: UsageLogEntry): void {
  const createdAt = entry.createdAt || Date.now()
  const details = sanitizeForLogging(entry.details || {})
  try {
    insertUsageEvent({
      category: entry.category,
      action: entry.action,
      status: entry.status,
      detailsJson: JSON.stringify(details),
      sessionId: entry.sessionId,
      createdAt,
    })
  } catch (error) {
    writeAppLog('error', 'usage', 'Failed to insert usage event', { entry, error: String(error) })
  }
  writeUsageLog({ ...entry, details, createdAt })
}

function readJsonConfig(path: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

function getAppLogThreshold(config: Record<string, unknown>): LogThreshold {
  return normalizeLogThreshold(asRecord(config.logging).level)
}

function normalizeAppConfig(raw: unknown): Record<string, unknown> {
  const source = asRecord(raw)
  const logging = asRecord(source.logging)

  return {
    ...source,
    logging: {
      ...logging,
      level: getAppLogThreshold(source),
    },
  }
}

function ensureAppConfig(): Record<string, unknown> {
  if (existsSync(APP_CONFIG_PATH)) {
    const current = readJsonConfig(APP_CONFIG_PATH, {})
    const normalized = normalizeAppConfig(current)
    setLogThreshold(getAppLogThreshold(normalized))
    if (JSON.stringify(current) !== JSON.stringify(normalized)) {
      saveJsonConfig(APP_CONFIG_PATH, normalized)
    }
    return normalized
  }

  const legacyCandidates = [LEGACY_APP_CONFIG_IN_HOME, LEGACY_APP_CONFIG_PATH]
  for (const legacyPath of legacyCandidates) {
    if (!existsSync(legacyPath)) continue
    const data = readJsonConfig(legacyPath, {})
    const normalized = normalizeAppConfig(data)
    saveJsonConfig(APP_CONFIG_PATH, normalized)
    setLogThreshold(getAppLogThreshold(normalized))
    return normalized
  }

  const initial = normalizeAppConfig({})
  saveJsonConfig(APP_CONFIG_PATH, initial)
  setLogThreshold(getAppLogThreshold(initial))
  return initial
}

function saveJsonConfig(path: string, data: unknown): { ok: boolean; error?: string } {
  try {
    ensureDir(dirname(path))
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function getDefaultWorkspace(): string {
  return getDefaultWorkspaceSetting()
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isLegacyWindowsWorkspace(value: string): boolean {
  if (!IS_WINDOWS) return false
  const normalized = normalizePathLike(value)
  return normalized === '~/.nanobot/workspace'
    || normalized === normalizePathLike(join(LEGACY_NANOBOT_HOME, 'workspace'))
}

function shouldBootstrapNanobotConfig(): boolean {
  return !existsSync(NANOBOT_CONFIG_PATH)
}

function migrateLegacyWindowsNanobotConfig(): void {
  if (!IS_WINDOWS) return
  if (existsSync(NANOBOT_CONFIG_PATH)) return
  if (!existsSync(LEGACY_ENGINE_CONFIG_PATH)) return

  const legacy = readJsonConfig(LEGACY_ENGINE_CONFIG_PATH, { providers: {} })
  const normalized = normalizeNanobotConfig(legacy)
  const saved = saveJsonConfig(NANOBOT_CONFIG_PATH, normalized)
  if (saved.ok) {
    console.log('[Nanobot] Migrated legacy Windows config to', NANOBOT_CONFIG_PATH)
    return
  }

  console.warn('[Nanobot] Failed to migrate legacy Windows config:', saved.error)
}

function bootstrapNanobotConfigWithOnboard(): void {
  migrateLegacyWindowsNanobotConfig()
  if (!shouldBootstrapNanobotConfig()) return

  const launch = getNanobotLaunchSpec()
  if (!launch) {
    console.warn('[Nanobot] Skipping onboard bootstrap because no launch target was found.')
    return
  }

  console.log('[Nanobot] Bootstrapping config via onboard using', launch.source)
  const result = spawnSync(launch.command, [
    ...launch.args,
    'onboard',
    '--config',
    NANOBOT_CONFIG_PATH,
    '--workspace',
    getDefaultWorkspace(),
  ], {
    cwd: launch.cwd,
    env: buildChildEnv(),
    encoding: 'utf-8',
    windowsHide: process.platform === 'win32',
    shell: requiresShell(launch.command),
  })

  if (result.status === 0 && existsSync(NANOBOT_CONFIG_PATH)) {
    return
  }

  console.warn('[Nanobot] Onboard bootstrap did not complete successfully.')
  if (result.stdout?.trim()) {
    console.warn('[Nanobot] onboard stdout:', result.stdout.trim())
  }
  if (result.stderr?.trim()) {
    console.warn('[Nanobot] onboard stderr:', result.stderr.trim())
  }
}

function readNanobotConfigSource(): Record<string, unknown> {
  migrateLegacyWindowsNanobotConfig()

  if (existsSync(NANOBOT_CONFIG_PATH)) {
    return readJsonConfig(NANOBOT_CONFIG_PATH, { providers: {} })
  }

  return { providers: {} }
}

function normalizeNanobotConfig(raw: unknown): Record<string, unknown> {
  const source = asRecord(raw)
  const { _error: _ignored, metadata: _metadataIgnored, ...config } = source
  const providerSource = asRecord(config.providers)
  const providers = Object.fromEntries(
    SUPPORTED_PROVIDER_KEYS.map((key) => [key, asRecord(providerSource[key])])
  ) as Record<string, unknown>
  for (const [key, value] of Object.entries(providerSource)) {
    if (!(key in providers)) {
      providers[key] = asRecord(value)
    }
  }
  const agents = asRecord(config.agents)
  const defaults = asRecord(agents.defaults)
  const channels = asRecord(config.channels)
  const harnessclaw = asRecord(channels.harnessclaw)
  const parsedPort = typeof harnessclaw.port === 'number'
    ? harnessclaw.port
    : typeof harnessclaw.port === 'string'
      ? Number.parseInt(harnessclaw.port, 10)
      : Number.NaN
  const allowFrom = Array.isArray(harnessclaw.allowFrom)
    ? harnessclaw.allowFrom.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : ['*']
  const configuredWorkspace = typeof defaults.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : getDefaultWorkspace()
  const workspace = isLegacyWindowsWorkspace(configuredWorkspace)
    ? getDefaultWorkspace()
    : configuredWorkspace

  return {
    ...config,
    providers,
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        workspace,
      },
    },
    channels: {
      ...channels,
      harnessclaw: {
        ...harnessclaw,
        enabled: true,
        host: typeof harnessclaw.host === 'string' && harnessclaw.host.trim()
          ? harnessclaw.host
          : '127.0.0.1',
        port: Number.isFinite(parsedPort) ? parsedPort : 18765,
        token: typeof harnessclaw.token === 'string' ? harnessclaw.token : '',
        allowFrom: allowFrom.length > 0 ? allowFrom : ['*'],
      },
    },
  }
}

function ensureNanobotConfig(): Record<string, unknown> {
  bootstrapNanobotConfigWithOnboard()

  const current = readNanobotConfigSource()
  const normalized = normalizeNanobotConfig(current)
  ensureDir(NANOBOT_HOME)
  ensureDir(getWorkspaceDir(normalized))
  ensureDir(getSkillsDir(normalized))
  ensureDir(BIN_DIR)

  if (!existsSync(NANOBOT_CONFIG_PATH) || JSON.stringify(current) !== JSON.stringify(normalized)) {
    const saved = saveJsonConfig(NANOBOT_CONFIG_PATH, normalized)
    if (!saved.ok) {
      console.warn('[Nanobot] Failed to persist config:', saved.error)
    }
  }

  return normalized
}

function getWorkspaceDir(config?: Record<string, unknown>): string {
  const normalized = config ? normalizeNanobotConfig(config) : normalizeNanobotConfig(readNanobotConfigSource())
  const defaults = asRecord(asRecord(asRecord(normalized).agents).defaults)
  const workspace = typeof defaults.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : getDefaultWorkspace()
  return expandHomePath(workspace)
}

function getSkillsDir(config?: Record<string, unknown>): string {
  return join(getWorkspaceDir(config), 'skills')
}

function getProviderDefaultBase(providerKey: string): string {
  const provider = providerKey.toLowerCase()
  const defaults: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    openrouter: 'https://openrouter.ai/api/v1',
    deepseek: 'https://api.deepseek.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    minimax: 'https://api.minimax.chat/v1',
    siliconflow: 'https://api.siliconflow.cn/v1',
    byteplus: 'https://ark.cn-beijing.volces.com/api/v3',
    volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  }
  return defaults[provider] || ''
}

function inferConfiguredProvider(config: Record<string, unknown>): string {
  const defaults = asRecord(asRecord(asRecord(config).agents).defaults)
  const model = typeof defaults.model === 'string' ? defaults.model.trim() : ''
  if (model.includes('/')) {
    const provider = model.split('/')[0]?.trim()
    if (provider) return provider
  }
  const fallbackProvider = typeof defaults.provider === 'string' ? defaults.provider.trim() : ''
  return fallbackProvider && fallbackProvider !== 'auto' ? fallbackProvider : ''
}

function isLlmConfigured(config: Record<string, unknown>): boolean {
  const defaults = asRecord(asRecord(asRecord(config).agents).defaults)
  const model = typeof defaults.model === 'string' ? defaults.model.trim() : ''
  if (!model) return false

  const providerKey = inferConfiguredProvider(config)
  if (!providerKey) return true

  const provider = asRecord(asRecord(config.providers)[providerKey])
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
  const apiBase = typeof provider.apiBase === 'string' ? provider.apiBase.trim() : ''
  const localProviders = new Set(['ollama', 'vllm', 'custom'])

  if (localProviders.has(providerKey.toLowerCase())) {
    return true
  }

  return Boolean(apiKey || apiBase || getProviderDefaultBase(providerKey))
}

function installClawhubBinary(): { ok: boolean; path: string; error?: string } {
  const status = getBundledClawhubStatus({ forceSync: true })
  writeAppLog(status.installed ? 'info' : 'warn', 'clawhub', 'Ensured bundled runtime', {
    source: status.source,
    sourcePath: status.sourcePath,
    runtimePath: status.runtimePath,
    entryPath: status.entryPath,
    archivePath: status.archivePath,
    error: status.error,
  })
  return status.installed
    ? { ok: true, path: status.runtimePath }
    : { ok: false, path: status.runtimePath, error: status.error || 'Bundled ClawHub runtime is unavailable' }
}

function getClawhubStatus(): BundledToolStatus {
  return getBundledClawhubStatus()
}

function requiresShell(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
}

function getCommandCandidates(...values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (!value) continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }

  return result
}

function findCommandInPath(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(locator, [command], {
    encoding: 'utf-8',
    windowsHide: process.platform === 'win32',
  })
  if (result.status !== 0) return null
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || null
}

function getPythonPrefixArgs(command: string): string[] {
  const base = command.split(/[\\/]/).pop() || command
  return /^py(?:\.exe)?$/i.test(base) ? ['-3'] : []
}

function canImportNanobot(command: string, cwd?: string): boolean {
  const result = spawnSync(command, [...getPythonPrefixArgs(command), '-c', 'import nanobot'], {
    cwd,
    env: buildChildEnv(),
    stdio: 'ignore',
    windowsHide: process.platform === 'win32',
  })
  return result.status === 0
}

function getNanobotRepoCandidates(): string[] {
  const appPath = app.getAppPath()
  const candidates = [
    process.env.ICUCLAW_NANOBOT_SRC,
    join(appPath, '..', 'nanobot'),
    join(appPath, '..', '..', 'nanobot'),
    join(process.cwd(), '..', 'nanobot'),
    join(process.cwd(), 'nanobot'),
  ]

  const seen = new Set<string>()
  const repos: string[] = []

  for (const candidate of candidates) {
    if (!candidate) continue
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate
    if (seen.has(key)) continue
    seen.add(key)

    try {
      if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
        continue
      }
      if (!existsSync(join(candidate, 'nanobot'))) {
        continue
      }
      repos.push(candidate)
    } catch {
      continue
    }
  }

  return repos
}

function getNanobotLaunchSpec(): LaunchSpec | null {
  const explicitBin = process.env.ICUCLAW_NANOBOT_BIN
  if (explicitBin && existsSync(explicitBin)) {
    return { command: explicitBin, args: [], source: 'ICUCLAW_NANOBOT_BIN' }
  }

  const bundledLaunch = getBundledNanobotLaunchSpec()
  if (bundledLaunch) {
    return bundledLaunch
  }

  const repoCandidates = getNanobotRepoCandidates()
  for (const repo of repoCandidates) {
    const repoPython = process.platform === 'win32'
      ? join(repo, '.venv', 'Scripts', 'python.exe')
      : join(repo, '.venv', 'bin', 'python')
    if (existsSync(repoPython) && canImportNanobot(repoPython, repo)) {
      return {
        command: repoPython,
        args: [...getPythonPrefixArgs(repoPython), '-m', 'nanobot'],
        cwd: repo,
        source: `repo venv: ${repo}`,
      }
    }
  }

  const pythonCandidates = getCommandCandidates(
    process.env.ICUCLAW_PYTHON,
    'py',
    'python',
    'python3',
  )
  for (const repo of repoCandidates) {
    for (const python of pythonCandidates) {
      if (canImportNanobot(python, repo)) {
        return {
          command: python,
          args: [...getPythonPrefixArgs(python), '-m', 'nanobot'],
          cwd: repo,
          source: `${python} @ ${repo}`,
        }
      }
    }
  }

  for (const binary of process.platform === 'win32' ? ['nanobot.exe', 'nanobot.cmd', 'nanobot'] : ['nanobot']) {
    const resolved = findCommandInPath(binary)
    if (resolved) {
      return { command: resolved, args: [], source: `PATH: ${binary}` }
    }
  }

  for (const python of pythonCandidates) {
    if (canImportNanobot(python)) {
      return {
        command: python,
        args: [...getPythonPrefixArgs(python), '-m', 'nanobot'],
        source: `${python} from PATH`,
      }
    }
  }

  return null
}

function runClawhub(
  args: string[],
  options?: { timeoutMs?: number; cwd?: string }
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const launch = getBundledClawhubLaunchSpec()
    if (!launch) {
      const status = getClawhubStatus()
      resolve({
        ok: false,
        stdout: '',
        stderr: status.error || `clawhub not found: ${status.path}`,
        code: null,
      })
      return
    }

    const config = ensureNanobotConfig()
    const timeoutMs = options?.timeoutMs ?? 30000
    const workspaceDir = getWorkspaceDir(config)
    ensureDir(workspaceDir)

    const finalArgs = [...launch.args, '--workdir', workspaceDir, ...args]
    const loggedArgs = scrubCliArgs(finalArgs)
    console.log('[ClawHub] Run via', launch.source, [launch.command, ...loggedArgs].join(' '), options?.cwd ? `(cwd: ${options.cwd})` : '')
    trackUsage({
      category: 'clawhub',
      action: args[0] || 'run',
      status: 'started',
      details: {
        command: launch.command,
        args: loggedArgs,
        cwd: options?.cwd || launch.cwd || '',
        source: launch.source,
      },
    })

    const child = spawn(launch.command, finalArgs, {
      env: buildLaunchEnv(launch.env),
      cwd: options?.cwd || launch.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32',
      shell: requiresShell(launch.command),
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      trackUsage({
        category: 'clawhub',
        action: args[0] || 'run',
        status: 'timeout',
        details: { timeoutMs },
      })
      resolve({ ok: false, stdout, stderr: stderr || `Timed out after ${timeoutMs}ms`, code: null })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      writeAppLog('error', 'clawhub', 'Spawn error', { args, error: String(err) })
      trackUsage({
        category: 'clawhub',
        action: args[0] || 'run',
        status: 'error',
        details: { error: String(err) },
      })
      resolve({ ok: false, stdout, stderr: String(err), code: null })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
       trackUsage({
        category: 'clawhub',
        action: args[0] || 'run',
        status: code === 0 ? 'ok' : 'failed',
        details: {
          code,
          stdout: stdout.trim().slice(0, 2000),
          stderr: stderr.trim().slice(0, 2000),
        },
      })
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

function startNanobot(): void {
  if (nanobotProcess) return

  // Electron dev restarts and hard closes can orphan the previous gateway process.
  // Always reclaim our last known instance before spawning a new one.
  cleanupStaleNanobotProcesses()

  const config = ensureNanobotConfig()
  updateAppRuntimeStatus({
    localService: 'starting',
    llmConfigured: isLlmConfigured(config),
    lastError: undefined,
  })
  ensureBundledRuntimes()
  const launch = getNanobotLaunchSpec()
  if (!launch) {
    console.warn('[Nanobot] No launch target found. Checked repo source, bundled binaries and PATH.')
    updateAppRuntimeStatus({
      localService: 'degraded',
      lastError: 'Nanobot runtime not found',
    })
    return
  }

  console.log('[Nanobot] Starting gateway via', launch.source)
  trackUsage({
    category: 'runtime',
    action: 'nanobot_start',
    status: 'started',
    details: { source: launch.source },
  })
  nanobotProcess = spawn(launch.command, [...launch.args, 'gateway', '--config', NANOBOT_CONFIG_PATH], {
    cwd: launch.cwd,
    env: buildLaunchEnv(launch.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: process.platform === 'win32',
    shell: requiresShell(launch.command),
  })

  if (nanobotProcess.pid) {
    writePidFile(NANOBOT_PID_PATH, nanobotProcess.pid)
  }

  ensureDir(getWorkspaceDir(config))
  ensureDir(getSkillsDir(config))
  updateAppRuntimeStatus({
    localService: 'ready',
    llmConfigured: isLlmConfigured(config),
    lastError: undefined,
  })

  nanobotProcess.stdout?.on('data', (data) => {
    safeWrite(process.stdout, `[Nanobot] ${String(data)}`)
    writeAppLog('info', 'nanobot.stdout', String(data).trim())
  })
  nanobotProcess.stderr?.on('data', (data) => {
    safeWrite(process.stderr, `[Nanobot] ${String(data)}`)
    writeAppLog('warn', 'nanobot.stderr', String(data).trim())
  })
  nanobotProcess.on('error', (err) => {
    console.error('[Nanobot] Failed to start:', err)
    updateAppRuntimeStatus({
      localService: 'degraded',
      lastError: `Nanobot failed to start: ${String(err)}`,
    })
    trackUsage({
      category: 'runtime',
      action: 'nanobot_start',
      status: 'error',
      details: { error: String(err) },
    })
    clearPidFile(NANOBOT_PID_PATH)
    nanobotProcess = null
  })
  nanobotProcess.on('exit', (code) => {
    console.log('[Nanobot] Exited with code:', code)
    updateAppRuntimeStatus({
      localService: code === 0 ? 'starting' : 'degraded',
      lastError: code === 0 ? undefined : `Nanobot exited with code ${String(code)}`,
    })
    trackUsage({
      category: 'runtime',
      action: 'nanobot_exit',
      status: code === 0 ? 'ok' : 'failed',
      details: { code },
    })
    clearPidFile(NANOBOT_PID_PATH)
    nanobotProcess = null
  })
}

function stopNanobot(): void {
  if (!nanobotProcess) return
  console.log('[Nanobot] Stopping gateway...')
  trackUsage({
    category: 'runtime',
    action: 'nanobot_stop',
    status: 'started',
  })
  if (nanobotProcess.pid) {
    killProcessTree(nanobotProcess.pid)
  } else {
    nanobotProcess.kill()
  }
  clearPidFile(NANOBOT_PID_PATH)
  nanobotProcess = null
}

function applyNanobotConfigNow(config: Record<string, unknown>): void {
  updateAppRuntimeStatus({
    applyingConfig: true,
    localService: 'starting',
    llmConfigured: isLlmConfigured(config),
    lastError: undefined,
  })
  trackUsage({
    category: 'config',
    action: 'apply_nanobot_config',
    status: 'started',
    details: { provider: inferConfiguredProvider(config), llmConfigured: isLlmConfigured(config) },
  })

  try {
    harnessclawClient.disconnect()
    stopNanobot()
    startNanobot()
    harnessclawClient.connect()
    updateAppRuntimeStatus({
      applyingConfig: false,
      llmConfigured: isLlmConfigured(config),
    })
    trackUsage({
      category: 'config',
      action: 'apply_nanobot_config',
      status: 'ok',
      details: { provider: inferConfiguredProvider(config), llmConfigured: isLlmConfigured(config) },
    })
  } catch (error) {
    updateAppRuntimeStatus({
      applyingConfig: false,
      localService: 'degraded',
      lastError: `Failed to apply config: ${String(error)}`,
    })
    trackUsage({
      category: 'config',
      action: 'apply_nanobot_config',
      status: 'error',
      details: { error: String(error) },
    })
  }
}

async function performDoctorFix(checkId: string): Promise<{ ok: boolean; message: string }> {
  switch (checkId) {
    case 'environment.runtime_dirs':
    case 'config.workspace': {
      const config = ensureNanobotConfig()
      ensureDir(HARNESSCLAW_DIR)
      ensureDir(BIN_DIR)
      ensureDir(join(HARNESSCLAW_DIR, 'db'))
      ensureDir(NANOBOT_HOME)
      ensureDir(getWorkspaceDir(config))
      ensureDir(getSkillsDir(config))
      return { ok: true, message: 'Runtime directories have been created or refreshed.' }
    }

    case 'config.app_exists': {
      ensureAppConfig()
      return { ok: true, message: 'App config file has been created.' }
    }

    case 'config.nanobot_exists': {
      ensureNanobotConfig()
      return { ok: true, message: 'Engine config has been bootstrapped.' }
    }

    case 'runtime.clawhub_installed': {
      const result = installClawhubBinary()
      return result.ok
        ? { ok: true, message: `ClawHub wrapper installed at ${result.path}.` }
        : { ok: false, message: result.error || 'Failed to install ClawHub wrapper.' }
    }

    case 'runtime.harnessclaw_connection': {
      harnessclawClient.disconnect()
      harnessclawClient.connect()
      return { ok: true, message: 'Requested a gateway reconnect from the app side.' }
    }

    case 'runtime.gateway_process':
    case 'runtime.gateway_port':
    case 'flow.gateway_handshake': {
      harnessclawClient.disconnect()
      stopNanobot()
      startNanobot()
      harnessclawClient.connect()
      return { ok: true, message: 'Gateway restart and reconnect have been requested.' }
    }

    default:
      return { ok: false, message: 'No automatic fix is available for this check yet.' }
  }
}

function scheduleNanobotConfigApply(config: Record<string, unknown>): void {
  pendingNanobotConfigApply = config
  updateAppRuntimeStatus({
    applyingConfig: true,
    llmConfigured: isLlmConfigured(config),
    lastError: undefined,
  })

  if (configApplyTimer) {
    clearTimeout(configApplyTimer)
  }

  configApplyTimer = setTimeout(() => {
    configApplyTimer = null
    const next = pendingNanobotConfigApply
    pendingNanobotConfigApply = null
    if (next) {
      applyNanobotConfigNow(next)
    }
  }, 1000)
}

function buildExportPayload(type: string): { name: string; content: string } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (type === 'logs') {
    return {
      name: `logs-export-${stamp}.json`,
      content: JSON.stringify({
        exportedAt: new Date().toISOString(),
        appLog: readTextFile(APP_LOG_PATH),
        rendererLog: readTextFile(RENDERER_LOG_PATH),
        usageLog: readTextFile(USAGE_LOG_PATH),
        usageEvents: listUsageEvents(1000),
      }, null, 2),
    }
  }

  if (type === 'config') {
    return {
      name: `config-export-${stamp}.json`,
      content: JSON.stringify({
        exportedAt: new Date().toISOString(),
        nanobotConfig: sanitizeForLogging(ensureNanobotConfig()),
        appConfig: sanitizeForLogging(ensureAppConfig()),
      }, null, 2),
    }
  }

  return {
    name: `chat-export-${stamp}.json`,
    content: JSON.stringify({
      exportedAt: new Date().toISOString(),
      sessions: dbListSessions().map((session) => ({
        ...session,
        messages: getMessages(session.session_id),
      })),
    }, null, 2),
  }
}

setLogThreshold(getAppLogThreshold(ensureAppConfig()))
installSafeConsole()
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#F5F5F7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.openclaw.nanny')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // First-launch detection
  ipcMain.handle('app:isFirstLaunch', () => {
    return !existsSync(HARNESSCLAW_LAUNCHED_FLAG)
  })

  ipcMain.handle('app:markLaunched', () => {
    try {
      if (!existsSync(HARNESSCLAW_DIR)) {
        mkdirSync(HARNESSCLAW_DIR, { recursive: true })
      }
      writeFileSync(HARNESSCLAW_LAUNCHED_FLAG, new Date().toISOString(), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Config file read/write
  ipcMain.handle('config:read', () => {
    const config = ensureNanobotConfig()
    updateAppRuntimeStatus({ llmConfigured: isLlmConfigured(config) })
    return config
  })

  ipcMain.handle('config:save', (_, data: unknown) => {
    const normalized = normalizeNanobotConfig(data)
    const result = saveJsonConfig(NANOBOT_CONFIG_PATH, normalized)
    if (result.ok) {
      ensureDir(getWorkspaceDir(normalized))
      ensureDir(getSkillsDir(normalized))
      updateAppRuntimeStatus({ llmConfigured: isLlmConfigured(normalized) })
      scheduleNanobotConfigApply(normalized)
      trackUsage({
        category: 'config',
        action: 'save_nanobot_config',
        status: 'ok',
        details: { provider: inferConfiguredProvider(normalized), llmConfigured: isLlmConfigured(normalized), applyScheduled: true },
      })
      } else {
        trackUsage({
          category: 'config',
          action: 'save_nanobot_config',
          status: 'error',
          details: { error: result.error || 'Unknown error' },
        })
    }
    return result
  })
  ipcMain.handle('app-config:read', () => {
    return ensureAppConfig()
  })

  ipcMain.handle('app-config:save', (_, data: unknown) => {
    const normalized = normalizeAppConfig(data)
    const result = saveJsonConfig(APP_CONFIG_PATH, normalized)
    if (result.ok) {
      setLogThreshold(getAppLogThreshold(normalized))
    }
    trackUsage({
      category: 'config',
      action: 'save_app_config',
      status: result.ok ? 'ok' : 'error',
      details: result.ok
        ? { logLevel: getAppLogThreshold(normalized) }
        : { error: result.error || 'Unknown error' },
    })
    return result
  })

  ipcMain.handle('app-runtime:getStatus', () => {
    return { ...appRuntimeStatus }
  })

  ipcMain.handle('app-runtime:getLogLevel', () => {
    return getLogThreshold()
  })

  ipcMain.handle('app-runtime:getLogs', (_, options) => {
    return readStructuredLogs(options || {})
  })

  ipcMain.handle('app-runtime:openLogsDirectory', async () => {
    const error = await shell.openPath(LOGS_DIR)
    return {
      ok: !error,
      path: LOGS_DIR,
      error: error || undefined,
    }
  })

  ipcMain.handle('app-runtime:logRenderer', (_, level: LogLevel, message: string, details?: Record<string, unknown>) => {
    writeRendererLog(level, message, details)
    return { ok: true }
  })

  ipcMain.handle('app-runtime:trackUsage', (_, entry: UsageLogEntry) => {
    trackUsage(entry)
    return { ok: true }
  })

  ipcMain.handle('app-runtime:exportData', (_, type: string) => {
    try {
      const payload = buildExportPayload(type)
      const path = writeExportFile(payload.name, payload.content)
      trackUsage({
        category: 'export',
        action: type,
        status: 'ok',
        details: { path },
      })
      return { ok: true, path }
    } catch (error) {
      const errText = String(error)
      trackUsage({
        category: 'export',
        action: type,
        status: 'error',
        details: { error: errText },
      })
      return { ok: false, error: errText }
    }
  })

  ipcMain.handle('clawhub:getStatus', () => {
    return getClawhubStatus()
  })

  ipcMain.handle('clawhub:install', () => {
    return installClawhubBinary()
  })

  ipcMain.handle('clawhub:verifyToken', async (_, token: string) => {
    const trimmed = token.trim()
    if (!trimmed) {
      return { ok: false, stdout: '', stderr: 'Token is required', code: null }
    }
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = installClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Failed to install clawhub', code: null }
      }
    }
    return runClawhub(['login', '--token', trimmed])
  })

  ipcMain.handle('clawhub:explore', async () => {
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = installClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Failed to install clawhub', code: null }
      }
    }
    return runClawhub(['explore'])
  })

  ipcMain.handle('clawhub:search', async (_, query: string) => {
    const trimmed = query.trim()
    if (!trimmed) {
      return { ok: false, stdout: '', stderr: 'Query is required', code: null }
    }
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = installClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Failed to install clawhub', code: null }
      }
    }
    return runClawhub(['search', trimmed])
  })

  ipcMain.handle('clawhub:installSkill', async (_, slug: string) => {
    const trimmed = slug.trim()
    if (!trimmed) {
      return { ok: false, stdout: '', stderr: 'Skill slug is required', code: null }
    }
    const status = getClawhubStatus()
    if (!status.installed) {
      const install = installClawhubBinary()
      if (!install.ok) {
        return { ok: false, stdout: '', stderr: install.error || 'Failed to install clawhub', code: null }
      }
    }
    const skillsDir = getSkillsDir()
    ensureDir(skillsDir)
    return runClawhub(['install', trimmed], { cwd: skillsDir, timeoutMs: 120000 })
  })
  // Skills reader
  ipcMain.handle('skills:list', () => {
    try {
      const skillsDir = getSkillsDir()
      if (!existsSync(skillsDir)) return []
      const dirs = readdirSync(skillsDir).filter((name) => {
        const full = join(skillsDir, name)
        return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'))
      })
      return dirs.map((dirName) => {
        const md = readFileSync(join(skillsDir, dirName, 'SKILL.md'), 'utf-8')
        // Parse YAML frontmatter
        const match = md.match(/^---\n([\s\S]*?)\n---/)
        const meta: Record<string, string> = {}
        if (match) {
          match[1].split('\n').forEach((line) => {
            const idx = line.indexOf(':')
            if (idx > 0) {
              meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
            }
          })
        }
        const hasRefs = existsSync(join(skillsDir, dirName, 'references'))
        const hasTemplates = existsSync(join(skillsDir, dirName, 'templates'))
        return {
          id: dirName,
          name: meta.name || dirName,
          description: meta.description || '',
          allowedTools: meta['allowed-tools'] || '',
          hasReferences: hasRefs,
          hasTemplates: hasTemplates,
        }
      })
    } catch (err) {
      console.error('[Skills] Failed to list:', err)
      return []
    }
  })
  ipcMain.handle('skills:read', (_, id: string) => {
    try {
      const filePath = join(getSkillsDir(), id, 'SKILL.md')
      if (!existsSync(filePath)) return ''
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      console.error('[Skills] Failed to read:', err)
      return ''
    }
  })

  ipcMain.handle('skills:delete', (_, id: string) => {
    try {
      const trimmed = id.trim()
      if (!trimmed || trimmed.includes('..') || trimmed.includes('/')) {
        return { ok: false, error: 'Invalid skill id' }
      }
      const skillDir = join(getSkillsDir(), trimmed)
      if (!existsSync(skillDir)) {
        return { ok: false, error: 'Skill not found' }
      }
      rmSync(skillDir, { recursive: true, force: true })
      console.log('[Skills] Deleted:', trimmed)
      return { ok: true }
    } catch (err) {
      console.error('[Skills] Failed to delete:', err)
      return { ok: false, error: String(err) }
    }
  })

  // Start nanobot gateway, then connect Harnessclaw (auto-retries until gateway is ready)
  ensureLoggingDirs()
  ensureAppConfig()
  const initialNanobotConfig = ensureNanobotConfig()
  updateAppRuntimeStatus({
    localService: 'starting',
    transport: 'disconnected',
    llmConfigured: isLlmConfigured(initialNanobotConfig),
    applyingConfig: false,
    lastError: undefined,
  })
  trackUsage({
    category: 'app',
    action: 'startup',
    status: 'ok',
    details: { version: app.getVersion() },
  })
  startNanobot()
  try {
    getDb() // Initialize DB on startup
  } catch (err) {
    console.error('[DB] Startup initialization failed:', err)
  }
  harnessclawClient.connect()

  harnessclawClient.on('statusChange', (status) => {
    updateAppRuntimeStatus({
      transport: status as TransportStatus,
      localService: status === 'connected' ? 'ready' : appRuntimeStatus.localService === 'degraded' ? 'degraded' : appRuntimeStatus.localService,
      lastError: status === 'connected' ? undefined : appRuntimeStatus.lastError,
    })
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('harnessclaw:status', status)
    })
  })

  // DB IPC handlers
  ipcMain.handle('db:listSessions', () => {
    try {
      return dbListSessions()
    } catch (err) {
      console.error('[DB] listSessions error:', err)
      return []
    }
  })

  ipcMain.handle('db:getMessages', (_, sessionId: string) => {
    try {
      return getMessages(sessionId)
    } catch (err) {
      console.error('[DB] getMessages error:', err)
      return []
    }
  })

  ipcMain.handle('db:deleteSession', (_, sessionId: string) => {
    try {
      dbDeleteSession(sessionId)
      trackUsage({ category: 'chat', action: 'delete_session', status: 'ok', sessionId })
      return { ok: true }
    } catch (err) {
      trackUsage({ category: 'chat', action: 'delete_session', status: 'error', sessionId, details: { error: String(err) } })
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('files:pick', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    return buildPickedLocalFiles(result.filePaths)
  })

  ipcMain.handle('files:resolve', (_, filePaths: string[]) => {
    return buildPickedLocalFiles(Array.isArray(filePaths) ? filePaths : [])
  })

  ipcMain.handle('doctor:run', async () => {
    return await runDoctor()
  })

  ipcMain.handle('doctor:fix', async (_, checkId: string) => {
    return await performDoctorFix(String(checkId || ''))
  })

  // Track pending assistant message IDs per session for DB writes
  const pendingDbAssistantIds: Record<string, string> = {}
  const pendingDbSegments: Record<string, { segments: Array<{ text: string; ts: number }>; lastToolTs: number }> = {}

  harnessclawClient.on('event', (event) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('harnessclaw:event', event)
    })

    // Write to DB based on event type
    const type = event.type as string
    const sid = event.session_id as string | undefined
    try {
      switch (type) {
        case 'connected': {
          // Don't auto-create session in DB 鈥?session is created when user sends first message
          updateAppRuntimeStatus({ localService: 'ready', transport: 'connected', lastError: undefined })
          break
        }
        case 'turn_start': {
          if (sid) {
            const now = Date.now()
            const id = `ast-${now}`
            pendingDbAssistantIds[sid] = id
            pendingDbSegments[sid] = { segments: [], lastToolTs: 0 }
            insertMessage({ id, sessionId: sid, role: 'assistant', content: '', contentSegments: [], createdAt: now })
          }
          break
        }
        case 'tool_hint': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid) {
              insertToolActivity(aid, { type: 'hint', content: (event.content as string) || '' })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTs = Date.now()
            }
          }
          break
        }
        case 'tool_call': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid) {
              insertToolActivity(aid, {
                type: 'call',
                name: event.name as string,
                content: JSON.stringify(event.arguments, null, 2),
                callId: event.call_id as string,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTs = Date.now()
            }
          }
          break
        }
        case 'tool_result': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid) {
              insertToolActivity(aid, {
                type: 'result',
                name: event.name as string,
                content: (event.content as string) || '',
                callId: event.call_id as string,
                isError: event.is_error as boolean,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTs = Date.now()
            }
          }
          break
        }
        case 'text_delta': {
          if (sid) {
            let aid = pendingDbAssistantIds[sid]
            const chunk = event.content as string
            const now = Date.now()
            if (!aid) {
              // No turn_start received 鈥?auto-create assistant message in DB
              aid = `ast-${now}`
              pendingDbAssistantIds[sid] = aid
              const initialSegments = chunk ? [{ text: chunk, ts: now }] : []
              pendingDbSegments[sid] = { segments: initialSegments, lastToolTs: 0 }
              insertMessage({
                id: aid,
                sessionId: sid,
                role: 'assistant',
                content: chunk || '',
                contentSegments: initialSegments,
                createdAt: now
              })
            } else if (chunk) {
              const state = pendingDbSegments[sid] || { segments: [], lastToolTs: 0 }
              const segments = [...state.segments]
              const lastSeg = segments[segments.length - 1]
              if (lastSeg && state.lastToolTs <= lastSeg.ts) {
                segments[segments.length - 1] = { text: lastSeg.text + chunk, ts: lastSeg.ts }
              } else {
                segments.push({ text: chunk, ts: now })
              }
              pendingDbSegments[sid] = { ...state, segments }
              updateMessageContent(aid, chunk, segments)
            }
          }
          break
        }
        case 'response': {
          if (sid) {
            let aid = pendingDbAssistantIds[sid]
            const content = (event.content as string) || ''
            const now = Date.now()
            const toolsUsed = event.tools_used as string[] | undefined
            const usage = event.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined

            if (!aid) {
              aid = `ast-${now}`
              pendingDbAssistantIds[sid] = aid
              const segments = content ? [{ text: content, ts: now }] : []
              insertMessage({
                id: aid,
                sessionId: sid,
                role: 'assistant',
                content,
                contentSegments: segments,
                createdAt: now,
              })
              updateMessageContent(aid, '', segments, toolsUsed, usage)
            } else {
              const segments = content ? [{ text: content, ts: now }] : pendingDbSegments[sid]?.segments
              updateMessageContent(aid, content, segments, toolsUsed, usage)
            }

            delete pendingDbAssistantIds[sid]
            delete pendingDbSegments[sid]
          }
          break
        }
        case 'response_end': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid) {
              const toolsUsed = event.tools_used as string[] | undefined
              const usage = event.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined
              // Content already accumulated via text_delta; just update metadata
              updateMessageContent(aid, '', pendingDbSegments[sid]?.segments, toolsUsed, usage)
              delete pendingDbAssistantIds[sid]
              delete pendingDbSegments[sid]
            }
          }
          break
        }
      }
    } catch (err) {
      console.error('[DB] Event write error:', type, err)
    }
  })

  ipcMain.handle('harnessclaw:connect', () => {
    harnessclawClient.connect()
    trackUsage({ category: 'chat', action: 'connect', status: 'started' })
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:disconnect', () => {
    harnessclawClient.disconnect()
    trackUsage({ category: 'chat', action: 'disconnect', status: 'ok' })
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:send', (_, content: string, sessionId?: string) => {
    harnessclawClient.send(content, sessionId)
    trackUsage({
      category: 'chat',
      action: 'send_message',
      status: 'ok',
      sessionId,
      details: { contentLength: content.length },
    })
    // Write user message to DB
    if (sessionId) {
      try {
        upsertSession(sessionId)
        const msgId = `usr-${Date.now()}`
        insertMessage({ id: msgId, sessionId, role: 'user', content, createdAt: Date.now() })
        // Use first user message as session title
        const msgs = getMessages(sessionId)
        const userMsgs = msgs.filter((m) => m.role === 'user')
        if (userMsgs.length === 1) {
          const visibleContent = stripAttachmentMetadataFromContent(content)
          const titleSource = visibleContent || '附件会话'
          const title = titleSource.trim().replace(/\n/g, ' ')
          const truncated = title.length > 50 ? title.slice(0, 50) + '...' : title
          updateSessionTitle(sessionId, truncated)
        }
      } catch (err) {
        console.error('[DB] Send write error:', err)
      }
    }
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:command', (_, cmd: string, sessionId?: string) => {
    harnessclawClient.command(cmd, sessionId)
    trackUsage({ category: 'chat', action: 'command', status: 'ok', sessionId, details: { command: cmd } })
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:stop', (_, sessionId?: string) => {
    harnessclawClient.stop(sessionId)
    trackUsage({ category: 'chat', action: 'stop', status: 'ok', sessionId })
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:subscribe', (_, sessionId: string) => {
    harnessclawClient.subscribe(sessionId)
    trackUsage({ category: 'chat', action: 'subscribe', status: 'ok', sessionId })
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:unsubscribe', (_, sessionId: string) => {
    harnessclawClient.unsubscribe(sessionId)
    trackUsage({ category: 'chat', action: 'unsubscribe', status: 'ok', sessionId })
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:listSessions', () => {
    harnessclawClient.listSessions()
    trackUsage({ category: 'chat', action: 'list_sessions', status: 'ok' })
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:status', () => {
    return harnessclawClient.getStatus()
  })

  if (DOCTOR_RUN_ONCE) {
    setTimeout(async () => {
      try {
        let fixResult: { ok: boolean; message: string } | undefined
        if (DOCTOR_FIX_ARG) {
          fixResult = await performDoctorFix(DOCTOR_FIX_ARG)
        }
        const result = await runDoctor()
        console.log(JSON.stringify({
          fix: fixResult,
          result,
        }))
      } catch (error) {
        console.error('[DoctorRunOnce] Failed:', error)
        process.exitCode = 1
      } finally {
        app.quit()
      }
    }, DOCTOR_WAIT_MS)
  } else {
    createWindow()
  }

  app.on('activate', function () {
    if (!DOCTOR_RUN_ONCE && BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  if (configApplyTimer) {
    clearTimeout(configApplyTimer)
    configApplyTimer = null
  }
  harnessclawClient.disconnect()
  stopNanobot()
  closeDb()
})


