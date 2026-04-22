import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage, screen } from 'electron'
import { basename, extname, join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { harnessclawClient } from './harnessclaw'
import { manuallyCheckForUpdates, setupAutoUpdater } from './updater'
import {
  HARNESSCLAW_DIR,
  ENGINE_CONFIG_PATH,
  resolveBundledBinaryPath,
  ensureDir,
  ensureHarnessclawConfigInitialized,
  ensureEngineConfigInitialized,
  readEngineConfig,
  saveEngineConfig,
  readHarnessclawConfig,
  saveHarnessclawConfig,
} from './config'
import {
  getDb, closeDb, upsertSession, updateSessionTitle, listSessions as dbListSessions,
  deleteSession as dbDeleteSession, insertMessage, updateMessageContent, updateMessageSystemNotice,
  getMessages, insertToolActivity, insertUsageEvent, listUsageEvents
} from './db'
import {
  LATEST_LOG_PATH,
  LOGS_DIR,
} from './runtime-paths'
import {
  type LogLevel,
  type UsageLogEntry,
  getLogThreshold,
  getDailyLogPath,
  initializeLogging,
  normalizeLogThreshold,
  readStructuredLogs,
  readTextFile,
  sanitizeForLogging,
  setLogThreshold,
  writeAppLog,
  writeExportFile,
  writeRendererLog,
  writeUsageLog,
} from './logging'
import {
  deleteInstalledSkill,
  installDiscoveredSkill,
  listDiscoveredSkills,
  listInstalledSkills,
  listSkillRepositories,
  previewDiscoveredSkill,
  readInstalledSkill,
  removeSkillRepository,
  saveSkillRepository,
  startDiscoverSkills,
} from './skills-market'

type PersistedSubagent = { taskId: string; label: string; status: string }
type PersistedTaskStatusPayload = {
  kind: 'task_event'
  taskId: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner?: string
  activeForm?: string
  scopeId?: string
  summary: string
}
type PersistedSystemNotice = {
  kind: 'error'
  title: string
  message: string
  reason?: string
  sessionId?: string
  hint?: string
}

const ERROR_ATTACH_WINDOW_MS = 30_000
const WINDOW_STATE_PATH = join(HARNESSCLAW_DIR, 'window-state.json')
const DEFAULT_WINDOW_WIDTH = 1200
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 1024
const MIN_WINDOW_HEIGHT = 768

type WindowState = {
  width: number
  height: number
  isMaximized?: boolean
}

function normalizeSubagent(raw: unknown): PersistedSubagent | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const candidate = raw as Record<string, unknown>
  const taskId = typeof candidate.task_id === 'string' ? candidate.task_id : ''
  const label = typeof candidate.label === 'string' ? candidate.label : ''
  const status = typeof candidate.status === 'string' ? candidate.status : ''
  if (!taskId || !label) return undefined
  return { taskId, label, status: status || 'ok' }
}

function createPersistedSubagent(taskId: string, label: string, status = 'running'): PersistedSubagent {
  return {
    taskId,
    label: label || 'subagent',
    status,
  }
}

function getPersistedSubagentVisualStatus(status?: string): 'running' | 'completed' | 'failed' {
  if (status === 'running') return 'running'
  if (status === 'completed' || status === 'ok' || status === 'success') return 'completed'
  return 'failed'
}

function normalizeEventType(type: string): string {
  return type.replace(/\./g, '_')
}

function createTaskStatusPayload(task: {
  taskId: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner?: string
  activeForm?: string
  scopeId?: string
}): PersistedTaskStatusPayload {
  return {
    kind: 'task_event',
    taskId: task.taskId,
    subject: task.subject,
    status: task.status,
    owner: task.owner,
    activeForm: task.activeForm,
    scopeId: task.scopeId,
    summary:
      task.status === 'in_progress'
        ? `任务进行中 · ${task.activeForm || task.subject}${task.owner ? ` · ${task.owner}` : ''}`
        : task.status === 'completed'
          ? `任务已完成 · ${task.subject}${task.owner ? ` · ${task.owner}` : ''}`
          : task.status === 'deleted'
            ? `任务已移除 · ${task.subject}`
            : `任务已创建 · ${task.subject}`,
  }
}

function findAttachablePersistedAssistantMessageId(
  messages: Array<{ id: string; role: string; created_at: number }>,
  referenceTs: number,
  preferredId?: string,
): string | null {
  if (preferredId && messages.some((message) => message.id === preferredId)) {
    return preferredId
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') break
    if (message.role !== 'assistant') continue
    if (referenceTs - message.created_at > ERROR_ATTACH_WINDOW_MS) break
    return message.id
  }

  return null
}

function readWindowState(): WindowState | null {
  try {
    if (!existsSync(WINDOW_STATE_PATH)) return null
    const parsed = JSON.parse(readFileSync(WINDOW_STATE_PATH, 'utf-8')) as Partial<WindowState>
    const width = Number(parsed.width)
    const height = Number(parsed.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null
    }
    return {
      width: Math.max(MIN_WINDOW_WIDTH, Math.round(width)),
      height: Math.max(MIN_WINDOW_HEIGHT, Math.round(height)),
      isMaximized: parsed.isMaximized === true,
    }
  } catch (error) {
    writeAppLog('warn', 'window.state', 'Failed to read window state', {
      error: String(error),
    })
    return null
  }
}

function writeWindowState(windowState: WindowState): void {
  try {
    ensureDir(HARNESSCLAW_DIR)
    writeFileSync(WINDOW_STATE_PATH, JSON.stringify(windowState, null, 2), 'utf-8')
  } catch (error) {
    writeAppLog('warn', 'window.state', 'Failed to persist window state', {
      error: String(error),
    })
  }
}

function resolveWindowState(): WindowState {
  const storedState = readWindowState()
  if (!storedState) {
    return {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      isMaximized: false,
    }
  }

  const primaryArea = screen.getPrimaryDisplay().workAreaSize
  return {
    width: Math.min(Math.max(storedState.width, MIN_WINDOW_WIDTH), Math.max(MIN_WINDOW_WIDTH, primaryArea.width)),
    height: Math.min(Math.max(storedState.height, MIN_WINDOW_HEIGHT), Math.max(MIN_WINDOW_HEIGHT, primaryArea.height)),
    isMaximized: storedState.isMaximized === true,
  }
}

function getWindowStateSnapshot(win: BrowserWindow): WindowState {
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds()
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height)),
    isMaximized: win.isMaximized(),
  }
}

function isSameSubagent(
  left?: PersistedSubagent,
  right?: PersistedSubagent,
): boolean {
  return left?.taskId === right?.taskId
}

function getModuleKey(subagent?: PersistedSubagent): string {
  return subagent?.taskId || '__main__'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildPersistedErrorHint(reason: string, message: string): string | undefined {
  if (reason === 'model_error' && message.toLowerCase().includes('not supported')) {
    return '请切换到当前账号可用的模型，或检查 Codex 使用的账号类型。'
  }
  if (message.toLowerCase().includes('websocket')) {
    return '请检查本地服务是否已启动，以及连接配置是否正确。'
  }
  return undefined
}

function buildPersistedSystemErrorNotice(event: Record<string, unknown>, sessionId?: string): PersistedSystemNotice {
  const payload = isRecord(event.error)
    ? event.error
    : isRecord(event.payload)
      ? event.payload
      : {}
  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof event.content === 'string'
      ? event.content
      : '请求失败，请稍后重试。'
  const reason = typeof payload.reason === 'string' ? payload.reason : undefined

  return {
    kind: 'error',
    title: '请求失败',
    message,
    reason,
    sessionId,
    hint: buildPersistedErrorHint(reason || '', message),
  }
}

function getEventSessionId(event: Record<string, unknown>): string | undefined {
  if (typeof event.session_id === 'string' && event.session_id) {
    return event.session_id
  }

  const payload = isRecord(event.payload) ? event.payload : undefined
  if (payload && typeof payload.session_id === 'string' && payload.session_id) {
    return payload.session_id
  }

  const error = isRecord(event.error) ? event.error : undefined
  if (error && typeof error.session_id === 'string' && error.session_id) {
    return error.session_id
  }

  return undefined
}

function stringifyToolPayload(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getToolEventName(source: Record<string, unknown>): string | undefined {
  if (typeof source.name === 'string' && source.name) return source.name
  if (typeof source.tool_name === 'string' && source.tool_name) return source.tool_name
  return undefined
}

function getToolEventCallId(source: Record<string, unknown>): string | undefined {
  if (typeof source.call_id === 'string' && source.call_id) return source.call_id
  if (typeof source.tool_use_id === 'string' && source.tool_use_id) return source.tool_use_id
  if (typeof source.request_id === 'string' && source.request_id) return source.request_id
  return undefined
}

function getToolCallEventContent(source: Record<string, unknown>): string {
  if ('arguments' in source) return stringifyToolPayload(source.arguments)
  if ('input' in source) return stringifyToolPayload(source.input)
  if (typeof source.tool_input === 'string') return source.tool_input
  if (typeof source.content === 'string') return source.content
  return ''
}

function getToolResultEventContent(source: Record<string, unknown>): string {
  if (typeof source.output === 'string') return source.output
  if (typeof source.content === 'string') return source.content
  return ''
}

function getToolDurationMs(source: Record<string, unknown>): number | undefined {
  return typeof source.duration_ms === 'number' && Number.isFinite(source.duration_ms)
    ? source.duration_ms
    : undefined
}

function getToolMetadataJson(source: Record<string, unknown>): string | undefined {
  if (!isRecord(source.metadata)) return undefined
  try {
    return JSON.stringify(source.metadata)
  } catch {
    return undefined
  }
}

function getToolRenderHint(source: Record<string, unknown>): string | undefined {
  return typeof source.render_hint === 'string' && source.render_hint ? source.render_hint : undefined
}

function getToolLanguage(source: Record<string, unknown>): string | undefined {
  return typeof source.language === 'string' && source.language ? source.language : undefined
}

function getToolFilePath(source: Record<string, unknown>): string | undefined {
  return typeof source.file_path === 'string' && source.file_path ? source.file_path : undefined
}

const HARNESSCLAW_LAUNCHED_FLAG = join(HARNESSCLAW_DIR, '.launched')
const HARNESSCLAW_ENGINE_BIN = resolveBundledBinaryPath('harnessclaw-engine')
let harnessclawEngineProcess: ChildProcess | null = null

function resolveDevIconPath(): string | undefined {
  const candidates = [
    join(process.cwd(), 'resources', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
  ]

  return candidates.find((candidate) => existsSync(candidate))
}

function applyDevAppIcon(): string | undefined {
  const iconPath = resolveDevIconPath()
  if (!iconPath) return undefined

  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(iconPath)
    if (!image.isEmpty()) {
      app.dock.setIcon(image)
    }
  }

  return iconPath
}

interface PickedLocalFile {
  name: string
  path: string
  url: string
  size: number
  extension: string
  kind: 'image' | 'video' | 'audio' | 'archive' | 'code' | 'document' | 'data' | 'other'
}

interface AppRuntimeStatus {
  localService: 'starting' | 'ready' | 'degraded'
  transport: 'disconnected' | 'connecting' | 'connected'
  llmConfigured: boolean
  applyingConfig: boolean
  lastError?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function inferConfiguredProvider(config: Record<string, unknown>): string {
  const llm = asRecord(config.llm)
  const providerGroups = [asRecord(config.providers), asRecord(llm.providers)]

  for (const providers of providerGroups) {
    for (const [key, rawValue] of Object.entries(providers)) {
      const provider = asRecord(rawValue)
      if (provider.enabled === false) continue

      const apiKey = typeof provider.api_key === 'string'
        ? provider.api_key
        : typeof provider.apiKey === 'string'
          ? provider.apiKey
          : ''
      const baseUrl = typeof provider.base_url === 'string'
        ? provider.base_url
        : typeof provider.apiBase === 'string'
          ? provider.apiBase
          : typeof provider.baseUrl === 'string'
            ? provider.baseUrl
            : ''

      if (apiKey.trim()) {
        return key
      }

      if ((key === 'ollama' || key === 'lmstudio' || key === 'vllm') && baseUrl.trim()) {
        return key
      }
    }
  }

  return 'unknown'
}

function inferAppRuntimeStatus(): AppRuntimeStatus {
  const harnessStatus = harnessclawClient.getStatus()
  const config = readEngineConfig({ providers: {} })
  return {
    localService: harnessStatus.status === 'disconnected' ? 'degraded' : 'ready',
    transport: harnessStatus.status as AppRuntimeStatus['transport'],
    llmConfigured: inferConfiguredProvider(config) !== 'unknown',
    applyingConfig: false,
    lastError: harnessStatus.status === 'disconnected' ? 'Harnessclaw websocket disconnected' : undefined,
  }
}

function broadcastAppRuntimeStatus(): void {
  const status = inferAppRuntimeStatus()
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('app-runtime:status', status)
  })
}

function broadcastSkillDiscoveryEvent(event: {
  type: 'started' | 'finished' | 'failed'
  taskId: string
  repositoryId?: string
  repositoryCount?: number
  successCount?: number
  errorCount?: number
  skillCount?: number
  error?: string
}): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('skills:discovery-event', event)
  })
}

function broadcastDbSessionsChanged(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('db:sessionsChanged')
  })
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

function buildExportPayload(type: string): { name: string; content: string } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (type === 'logs') {
    return {
      name: `logs-export-${stamp}.json`,
      content: JSON.stringify({
        exportedAt: new Date().toISOString(),
        latestLogPath: LATEST_LOG_PATH,
        dailyLogPath: getDailyLogPath(),
        latestLog: readTextFile(LATEST_LOG_PATH),
        usageEvents: listUsageEvents(1000),
      }, null, 2),
    }
  }

  if (type === 'config') {
    return {
      name: `config-export-${stamp}.json`,
      content: JSON.stringify({
        exportedAt: new Date().toISOString(),
        engineConfig: sanitizeForLogging(readEngineConfig({ providers: {} })),
        appConfig: sanitizeForLogging(readHarnessclawConfig({})),
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

function logProcessStream(level: LogLevel, source: string, payload: Buffer | string): void {
  const text = typeof payload === 'string' ? payload : payload.toString('utf-8')
  text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .forEach((line) => {
      writeAppLog(level, source, line)
    })
}

function startHarnessclawEngine(): void {
  if (harnessclawEngineProcess) return
  if (!HARNESSCLAW_ENGINE_BIN || !existsSync(HARNESSCLAW_ENGINE_BIN)) {
    writeAppLog('warn', 'harnessclaw-engine.process', 'Binary not found', {
      path: HARNESSCLAW_ENGINE_BIN || '<missing>',
    })
    return
  }
  writeAppLog('info', 'harnessclaw-engine.process', 'Starting engine', {
    binary: HARNESSCLAW_ENGINE_BIN,
    configPath: ENGINE_CONFIG_PATH,
  })
  harnessclawEngineProcess = spawn(HARNESSCLAW_ENGINE_BIN, ['-config', ENGINE_CONFIG_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  harnessclawEngineProcess.stdout?.on('data', (data) => {
    logProcessStream('debug', 'harnessclaw-engine.stdout', data)
  })
  harnessclawEngineProcess.stderr?.on('data', (data) => {
    logProcessStream('warn', 'harnessclaw-engine.stderr', data)
  })
  harnessclawEngineProcess.on('error', (err) => {
    writeAppLog('error', 'harnessclaw-engine.process', 'Failed to start engine', {
      error: String(err),
    })
    harnessclawEngineProcess = null
  })
  harnessclawEngineProcess.on('exit', (code) => {
    writeAppLog(code === 0 ? 'info' : 'error', 'harnessclaw-engine.process', 'Engine exited', {
      code,
    })
    harnessclawEngineProcess = null
  })
}

async function stopHarnessclawEngine(): Promise<void> {
  if (!harnessclawEngineProcess) return
  writeAppLog('info', 'harnessclaw-engine.process', 'Stopping engine')
  const processToStop = harnessclawEngineProcess

  await new Promise<void>((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const timeout = setTimeout(() => {
      processToStop.removeListener('exit', handleExit)
      try {
        processToStop.kill('SIGKILL')
      } catch {
        // Ignore kill errors during shutdown.
      }
      finish()
    }, 3000)

    const handleExit = () => {
      clearTimeout(timeout)
      finish()
    }

    processToStop.once('exit', handleExit)

    try {
      processToStop.kill('SIGTERM')
    } catch {
      clearTimeout(timeout)
      processToStop.removeListener('exit', handleExit)
      finish()
    }
  })

  if (harnessclawEngineProcess === processToStop) {
    harnessclawEngineProcess = null
  }
}

function startHarnessclawRuntime(): void {
  startHarnessclawEngine()
  harnessclawClient.connect()
  broadcastAppRuntimeStatus()
}

async function restartHarnessclawRuntime(): Promise<void> {
  harnessclawClient.disconnect()
  broadcastAppRuntimeStatus()
  await stopHarnessclawEngine()
  startHarnessclawRuntime()
}

function createWindow(): BrowserWindow {
  const devIconPath = is.dev ? applyDevAppIcon() : undefined
  const windowState = resolveWindowState()
  const mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#F5F5F7',
    ...(process.platform === 'darwin' ? {} : devIconPath ? { icon: devIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (windowState.isMaximized) {
      mainWindow.maximize()
    }
  })

  let persistTimer: NodeJS.Timeout | null = null
  const persistWindowState = () => {
    if (persistTimer) {
      clearTimeout(persistTimer)
    }
    persistTimer = setTimeout(() => {
      persistTimer = null
      writeWindowState(getWindowStateSnapshot(mainWindow))
    }, 180)
  }

  mainWindow.on('resize', persistWindowState)
  mainWindow.on('maximize', persistWindowState)
  mainWindow.on('unmaximize', persistWindowState)
  mainWindow.on('close', () => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    writeWindowState(getWindowStateSnapshot(mainWindow))
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

  setupAutoUpdater(mainWindow)
  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.iflytek.harnessclaw')
  initializeLogging()
  const appConfigInit = ensureHarnessclawConfigInitialized()
  const engineConfigInit = ensureEngineConfigInitialized()
  if (!appConfigInit.ok) {
    writeAppLog('error', 'app.config', 'Failed to initialize app config', {
      error: appConfigInit.error || 'unknown error',
    })
  }
  if (!engineConfigInit.ok) {
    writeAppLog('error', 'engine.config', 'Failed to initialize engine config', {
      path: ENGINE_CONFIG_PATH,
      error: engineConfigInit.error || 'unknown error',
    })
  }
  setLogThreshold(normalizeLogThreshold(asRecord(readHarnessclawConfig({})).logging?.level))
  writeAppLog('info', 'app.lifecycle', 'Application ready')

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
      writeAppLog('info', 'app.lifecycle', 'Launch flag created')
      if (engineConfigInit.ok) {
        startHarnessclawRuntime()
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  // Config file read/write
  ipcMain.handle('config:read', () => {
    return readEngineConfig({ providers: {} })
  })

  ipcMain.handle('config:save', async (_, data: unknown) => {
    ensureDir(HARNESSCLAW_DIR)
    const result = saveEngineConfig(data)
    if (result.ok && existsSync(HARNESSCLAW_LAUNCHED_FLAG)) {
      writeAppLog('info', 'setting.engine', 'Engine config saved, restarting runtime')
      await restartHarnessclawRuntime()
    } else if (result.ok) {
      writeAppLog('info', 'setting.engine', 'Engine config saved')
    } else {
      writeAppLog('error', 'setting.engine', 'Failed to save engine config', {
        error: result.error || 'unknown error',
      })
    }
    return result
  })

  ipcMain.handle('app-config:read', () => {
    return readHarnessclawConfig({})
  })

  ipcMain.handle('app-config:save', (_, data: unknown) => {
    ensureDir(HARNESSCLAW_DIR)
    const result = saveHarnessclawConfig(data)
    if (result.ok) {
      setLogThreshold(normalizeLogThreshold(asRecord(asRecord(data).logging).level))
      broadcastAppRuntimeStatus()
      writeAppLog('info', 'setting.app', 'App config saved', {
        loggingLevel: normalizeLogThreshold(asRecord(asRecord(data).logging).level),
      })
    } else {
      writeAppLog('error', 'setting.app', 'Failed to save app config', {
        error: result.error || 'unknown error',
      })
    }
    return result
  })

  ipcMain.handle('app-runtime:getStatus', () => {
    return inferAppRuntimeStatus()
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
      return { ok: true, path }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  // Skills reader and market
  ipcMain.handle('skills:list', () => {
    return listInstalledSkills()
  })

  ipcMain.handle('skills:read', (_, id: string) => {
    return readInstalledSkill(id)
  })

  ipcMain.handle('skills:delete', (_, id: string) => {
    return deleteInstalledSkill(id)
  })

  ipcMain.handle('skills:listRepositories', () => {
    return listSkillRepositories()
  })

  ipcMain.handle('skills:saveRepository', (_, input: {
    id?: string
    name?: string
    repoUrl: string
    branch?: string
    basePath?: string
    proxy?: {
      enabled?: boolean
      protocol?: 'http' | 'https' | 'socks5'
      host?: string
      port?: string
    }
    enabled?: boolean
  }) => {
    return saveSkillRepository(input)
  })

  ipcMain.handle('skills:removeRepository', (_, id: string) => {
    return removeSkillRepository(id)
  })

  ipcMain.handle('skills:discover', (_, repositoryId?: string) => {
    return startDiscoverSkills(repositoryId, broadcastSkillDiscoveryEvent)
  })

  ipcMain.handle('skills:listDiscovered', (_, repositoryId?: string) => {
    return listDiscoveredSkills(repositoryId)
  })

  ipcMain.handle('skills:previewDiscovered', (_, repositoryId: string, skillPath: string) => {
    return previewDiscoveredSkill(repositoryId, skillPath)
      .catch((error) => {
        console.error('[Skills] Failed to preview discovered skill:', error)
        return ''
      })
  })

  ipcMain.handle('skills:installDiscovered', (_, repositoryId: string, skillPath: string) => {
    return installDiscoveredSkill(repositoryId, skillPath)
  })

  getDb() // Initialize DB on startup
  if (engineConfigInit.ok && existsSync(HARNESSCLAW_LAUNCHED_FLAG)) {
    startHarnessclawRuntime()
  }

  harnessclawClient.on('statusChange', (status) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('harnessclaw:status', status)
    })
    broadcastAppRuntimeStatus()
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

  ipcMain.handle('db:createSession', (_, sessionId: string, title?: string) => {
    try {
      upsertSession(sessionId, title)
      broadcastDbSessionsChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
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
      broadcastDbSessionsChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('db:updateSessionTitle', (_, sessionId: string, title: string) => {
    try {
      updateSessionTitle(sessionId, title)
      broadcastDbSessionsChanged()
      return { ok: true }
    } catch (err) {
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

  // Track pending assistant message IDs per session for DB writes
  const pendingDbAssistantIds: Record<string, string> = {}
  const pendingDbSegments: Record<string, {
    segments: Array<{ text: string; ts: number; subagent?: PersistedSubagent }>
    lastToolTsByModule: Record<string, number>
  }> = {}

  harnessclawClient.on('event', (event) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('harnessclaw:event', event)
    })

    // Write to DB based on event type
    const type = event.type as string
    const normalizedType = normalizeEventType(type)
    const sid = getEventSessionId(event)
    const subagent = normalizeSubagent(event.subagent)
    try {
      const ensureDbAssistantMessage = (sessionId: string, now: number): string => {
        let aid = pendingDbAssistantIds[sessionId]
        if (aid) return aid

        aid = `ast-${now}`
        pendingDbAssistantIds[sessionId] = aid
        pendingDbSegments[sessionId] = { segments: [], lastToolTsByModule: {} }
        insertMessage({ id: aid, sessionId, role: 'assistant', content: '', contentSegments: [], createdAt: now })
        broadcastDbSessionsChanged()
        return aid
      }

      const appendPassiveDbActivity = (sessionId: string, activity: {
        type: string
        name?: string
        content: string
        callId?: string
        isError?: boolean
        durationMs?: number
        renderHint?: string
        language?: string
        filePath?: string
        metadataJson?: string
        subagent?: PersistedSubagent
      }): void => {
        const now = Date.now()
        let aid = pendingDbAssistantIds[sessionId]
        if (!aid) {
          const attachableAid = findAttachablePersistedAssistantMessageId(getMessages(sessionId), now)
          if (attachableAid) {
            aid = attachableAid
          } else {
            aid = `ast-collab-${now}`
            insertMessage({ id: aid, sessionId, role: 'assistant', content: '', contentSegments: [], createdAt: now })
          }
        }
        insertToolActivity(aid, activity)
      }

      switch (normalizedType) {
        case 'connected': {
          // Don't auto-create session in DB — session is created when user sends first message
          break
        }
        case 'turn_start': {
          if (sid) {
            const now = Date.now()
            if (subagent) {
              const aid = ensureDbAssistantMessage(sid, now)
              insertToolActivity(aid, {
                type: 'status',
                name: 'turn_start',
                content: subagent.status === 'running' ? '子任务启动' : '开始总结',
                subagent,
              })
              break
            }
            const id = `ast-${now}`
            pendingDbAssistantIds[sid] = id
            pendingDbSegments[sid] = { segments: [], lastToolTsByModule: {} }
            insertMessage({ id, sessionId: sid, role: 'assistant', content: '', contentSegments: [], createdAt: now })
          }
          break
        }
        case 'task_start': {
          if (sid && subagent) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            insertToolActivity(aid, {
              type: 'status',
              name: 'task_start',
              content: '子任务已创建',
              subagent,
            })
          }
          break
        }
        case 'subagent_event': {
          if (!sid) break
          const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
          if (!agentId) break
          const agentName = typeof event.agent_name === 'string' ? event.agent_name : 'subagent'
          const payload = isRecord(event.payload) ? event.payload : {}
          const eventType = typeof payload.event_type === 'string' ? payload.event_type : ''
          if (!eventType) break
          const persistedSubagent = createPersistedSubagent(agentId, agentName, 'running')
          const now = Date.now()

          if (eventType === 'text') {
            let aid = pendingDbAssistantIds[sid]
            const chunk = typeof payload.text === 'string' ? payload.text : ''
            if (!chunk) break
            if (!aid) {
              aid = ensureDbAssistantMessage(sid, now)
              const initialSegments = [{ text: chunk, ts: now, subagent: persistedSubagent }]
              pendingDbSegments[sid] = { ...(pendingDbSegments[sid] || { lastToolTsByModule: {}, segments: [] }), segments: initialSegments }
              updateMessageContent(aid, chunk, initialSegments)
            } else {
              const state = pendingDbSegments[sid] || { segments: [], lastToolTsByModule: {} }
              const segments = [...state.segments]
              const moduleKey = getModuleKey(persistedSubagent)
              const lastSegIndex = [...segments].reverse().findIndex((seg) => getModuleKey(seg.subagent) === moduleKey)
              const resolvedLastSegIndex = lastSegIndex === -1 ? -1 : segments.length - 1 - lastSegIndex
              const lastSeg = resolvedLastSegIndex >= 0 ? segments[resolvedLastSegIndex] : undefined
              const lastRelatedToolTs = state.lastToolTsByModule[moduleKey] || 0

              if (lastSeg && lastRelatedToolTs <= lastSeg.ts && isSameSubagent(lastSeg.subagent, persistedSubagent)) {
                segments[resolvedLastSegIndex] = { ...lastSeg, text: lastSeg.text + chunk, ts: lastSeg.ts }
              } else {
                segments.push({ text: chunk, ts: now, subagent: persistedSubagent })
              }

              pendingDbSegments[sid] = { ...state, segments }
              updateMessageContent(aid, chunk, segments)
            }
            break
          }

          const aid = ensureDbAssistantMessage(sid, now)
          const callId = typeof payload.tool_use_id === 'string' && payload.tool_use_id
            ? payload.tool_use_id
            : `${agentId}-${typeof event.event_id === 'string' ? event.event_id : now}`

          if (eventType === 'tool_start') {
            insertToolActivity(aid, {
              type: 'call',
              name: getToolEventName(payload) || 'tool',
              content: getToolCallEventContent(payload),
              callId,
              subagent: persistedSubagent,
            })
            const state = pendingDbSegments[sid]
            if (state) state.lastToolTsByModule[getModuleKey(persistedSubagent)] = now
            break
          }

          if (eventType === 'tool_end') {
            insertToolActivity(aid, {
              type: 'result',
              name: getToolEventName(payload) || 'tool',
              content: getToolResultEventContent(payload),
              callId,
              isError: payload.is_error === true,
              durationMs: getToolDurationMs(payload),
              renderHint: getToolRenderHint(payload),
              language: getToolLanguage(payload),
              filePath: getToolFilePath(payload),
              metadataJson: getToolMetadataJson(payload),
              subagent: persistedSubagent,
            })
            const state = pendingDbSegments[sid]
            if (state) state.lastToolTsByModule[getModuleKey(persistedSubagent)] = now
          }
          break
        }
        case 'task_created':
        case 'task_updated': {
          if (!sid) break
          const task = isRecord(event.task) ? event.task : {}
          const taskId = typeof task.task_id === 'string' ? task.task_id : ''
          if (!taskId) break
          const status = task.status === 'in_progress' || task.status === 'completed' || task.status === 'deleted'
            ? task.status
            : 'pending'
          appendPassiveDbActivity(sid, {
            type: 'status',
            name: 'task_event',
            content: JSON.stringify(createTaskStatusPayload({
              taskId,
              subject: typeof task.subject === 'string' ? task.subject : '未命名任务',
              status,
              owner: typeof task.owner === 'string' ? task.owner : undefined,
              activeForm: typeof task.active_form === 'string' ? task.active_form : undefined,
              scopeId: typeof task.scope_id === 'string' ? task.scope_id : undefined,
            })),
          })
          break
        }
        case 'subagent_end': {
          if (!sid) break
          const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
          if (!agentId) break
          const rawStatus = typeof event.status === 'string' ? event.status : 'completed'
          const status = rawStatus === 'completed' || rawStatus === 'max_turns' || rawStatus === 'model_error' || rawStatus === 'aborted' || rawStatus === 'timeout'
            ? rawStatus
            : 'error'
          const aid = ensureDbAssistantMessage(sid, Date.now())
          insertToolActivity(aid, {
            type: 'status',
            name: 'subagent_end',
            content: getPersistedSubagentVisualStatus(status) === 'failed' ? '子 Agent 执行失败' : '子 Agent 执行完成',
            subagent: createPersistedSubagent(
              agentId,
              typeof event.agent_name === 'string' ? event.agent_name : 'subagent',
              status,
            ),
          })
          break
        }
        case 'tool_hint': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, { type: 'hint', content: (event.content as string) || '', subagent })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'tool_call':
        case 'tool_start': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'call',
                name: getToolEventName(event),
                content: getToolCallEventContent(event),
                callId: getToolEventCallId(event),
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'tool_result':
        case 'tool_end': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'result',
                name: getToolEventName(event),
                content: getToolResultEventContent(event),
                callId: getToolEventCallId(event),
                isError: event.is_error as boolean,
                durationMs: getToolDurationMs(event),
                renderHint: getToolRenderHint(event),
                language: getToolLanguage(event),
                filePath: getToolFilePath(event),
                metadataJson: getToolMetadataJson(event),
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'permission_request': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'permission',
                name: event.name as string,
                content: JSON.stringify({
                  tool_input: (event.tool_input as string) || '',
                  message: (event.content as string) || '',
                  is_read_only: event.is_read_only === true,
                  options: Array.isArray(event.options) ? event.options : [],
                }),
                callId: event.request_id as string,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'permission_result': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'permission_result',
                name: event.name as string,
                content: JSON.stringify({
                  approved: event.approved === true,
                  scope: event.scope === 'session' ? 'session' : 'once',
                  message: (event.content as string) || '',
                }),
                callId: event.request_id as string,
                isError: event.approved !== true,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
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
              aid = ensureDbAssistantMessage(sid, now)
              const initialSegments = chunk ? [{ text: chunk, ts: now, subagent }] : []
              pendingDbSegments[sid] = { ...(pendingDbSegments[sid] || { lastToolTsByModule: {}, segments: [] }), segments: initialSegments }
              updateMessageContent(aid, chunk || '', initialSegments)
            } else if (chunk) {
              const state = pendingDbSegments[sid] || { segments: [], lastToolTsByModule: {} }
              const segments = [...state.segments]
              const moduleKey = getModuleKey(subagent)
              const lastSegIndex = [...segments].reverse().findIndex((seg) => getModuleKey(seg.subagent) === moduleKey)
              const resolvedLastSegIndex = lastSegIndex === -1 ? -1 : segments.length - 1 - lastSegIndex
              const lastSeg = resolvedLastSegIndex >= 0 ? segments[resolvedLastSegIndex] : undefined
              const lastRelatedToolTs = state.lastToolTsByModule[moduleKey] || 0
              if (lastSeg && lastRelatedToolTs <= lastSeg.ts && isSameSubagent(lastSeg.subagent, subagent)) {
                segments[resolvedLastSegIndex] = { ...lastSeg, text: lastSeg.text + chunk, ts: lastSeg.ts }
              } else {
                segments.push({ text: chunk, ts: now, subagent })
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
              aid = ensureDbAssistantMessage(sid, now)
              const segments = content ? [{ text: content, ts: now, subagent }] : []
              pendingDbSegments[sid] = { segments, lastToolTsByModule: {} }
              updateMessageContent(aid, content, segments)
            } else {
              const segments = pendingDbSegments[sid]?.segments || []
              if (content && segments.length === 0) {
                pendingDbSegments[sid] = { segments: [{ text: content, ts: now, subagent }], lastToolTsByModule: {} }
              }
              updateMessageContent(aid, content, pendingDbSegments[sid]?.segments)
            }

            if (!subagent) {
              updateMessageContent(aid, '', pendingDbSegments[sid]?.segments, toolsUsed, usage)
              delete pendingDbAssistantIds[sid]
              delete pendingDbSegments[sid]
            }
          }
          break
        }
        case 'response_end': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid) {
              if (subagent) {
                insertToolActivity(aid, {
                  type: 'status',
                  name: 'response_end',
                  content: subagent.status === 'error' ? '子任务失败' : '子任务完成',
                  subagent,
                })
                break
              }
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
        case 'task_end': {
          if (sid) {
            const aid = pendingDbAssistantIds[sid]
            if (aid && subagent) {
              insertToolActivity(aid, {
                type: 'status',
                name: 'task_end',
                content: subagent.status === 'error' ? '子任务生命周期结束，状态失败' : '子任务生命周期结束',
                subagent,
              })
            }
          }
          break
        }
        case 'error': {
          if (!sid) break
          const notice = buildPersistedSystemErrorNotice(event, sid)
          const errorAt = Date.now()
          upsertSession(sid)
          const pendingAid = pendingDbAssistantIds[sid]
          const attachableAid = pendingAid || findAttachablePersistedAssistantMessageId(getMessages(sid), errorAt)
          if (attachableAid) {
            updateMessageSystemNotice(attachableAid, notice, errorAt)
          } else {
            insertMessage({
              id: `asst-err-${errorAt}`,
              sessionId: sid,
              role: 'assistant',
              content: '',
              systemNotice: notice,
              createdAt: errorAt,
            })
          }
          broadcastDbSessionsChanged()
          delete pendingDbAssistantIds[sid]
          delete pendingDbSegments[sid]
          break
        }
      }
    } catch (err) {
      console.error('[DB] Event write error:', type, err)
    }
  })

  ipcMain.handle('harnessclaw:connect', () => {
    harnessclawClient.connect()
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:disconnect', () => {
    harnessclawClient.disconnect()
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:send', async (_, content: string, sessionId?: string) => {
    const ok = await harnessclawClient.send(content, sessionId)
    if (!ok) {
      return { ok: false, error: 'Failed to send message to Harnessclaw' }
    }
    // Write user message to DB
    if (sessionId) {
      try {
        upsertSession(sessionId)
        const msgId = `usr-${Date.now()}`
        insertMessage({ id: msgId, sessionId, role: 'user', content, createdAt: Date.now() })
        broadcastDbSessionsChanged()
        // Use first user message as session title
        const msgs = getMessages(sessionId)
        const userMsgs = msgs.filter((m) => m.role === 'user')
        if (userMsgs.length === 1) {
          const title = content.trim().replace(/\n/g, ' ')
          const truncated = title.length > 50 ? title.slice(0, 50) + '...' : title
          updateSessionTitle(sessionId, truncated)
          broadcastDbSessionsChanged()
        }
      } catch (err) {
        console.error('[DB] Send write error:', err)
      }
    }
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:command', (_, cmd: string, sessionId?: string) => {
    harnessclawClient.command(cmd, sessionId)
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:stop', async (_, sessionId?: string) => {
    const ok = await harnessclawClient.stop(sessionId)
    return ok ? { ok: true } : { ok: false, error: 'Failed to interrupt Harnessclaw session' }
  })

  ipcMain.handle('harnessclaw:subscribe', (_, sessionId: string) => {
    harnessclawClient.subscribe(sessionId)
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:unsubscribe', (_, sessionId: string) => {
    harnessclawClient.unsubscribe(sessionId)
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:listSessions', () => {
    harnessclawClient.listSessions()
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:probe', async () => {
    const ok = await harnessclawClient.probe()
    return { ok }
  })

  ipcMain.handle('harnessclaw:respondPermission', (_, requestId: string, approved: boolean, scope?: 'once' | 'session', message?: string) => {
    const ok = harnessclawClient.respondPermission(requestId, approved, scope === 'session' ? 'session' : 'once', message)
    return ok ? { ok: true } : { ok: false, error: 'Permission request not found or socket unavailable' }
  })

  ipcMain.handle('harnessclaw:status', () => {
    return harnessclawClient.getStatus()
  })

  ipcMain.handle('app:update:check', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) {
      return { ok: false, error: 'No active window' }
    }
    return manuallyCheckForUpdates(win)
  })

  createWindow()
  broadcastAppRuntimeStatus()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  harnessclawClient.disconnect()
  stopHarnessclawEngine()
  closeDb()
})
