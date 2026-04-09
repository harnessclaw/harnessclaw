import { spawnSync } from 'child_process'
import { app } from 'electron'
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  statSync,
} from 'fs'
import net from 'net'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { WebSocket } from 'ws'
import { getDb } from './db'
import { harnessclawClient } from './harnessclaw'
import {
  APP_CONFIG_PATH,
  BIN_DIR,
  DB_DIR,
  DB_PATH,
  ENGINE_CONFIG_PATH,
  ENGINE_HOME,
  HARNESSCLAW_HOME,
  IS_WINDOWS,
  NANOBOT_PID_PATH,
  getDefaultWorkspaceSetting,
} from './runtime-paths'

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip'
export type DoctorStage = 'environment' | 'config' | 'runtime' | 'flow'

export interface DoctorCheckResult {
  id: string
  stage: DoctorStage
  title: string
  status: DoctorStatus
  summary: string
  detail?: string
  impact?: string
  fixHint?: string
  durationMs: number
  data?: Record<string, unknown>
}

export interface DoctorRunResult {
  ok: boolean
  startedAt: string
  finishedAt: string
  summary: {
    pass: number
    warn: number
    fail: number
    skip: number
  }
  checks: DoctorCheckResult[]
}

interface LaunchSpec {
  command: string
  args: string[]
  cwd?: string
  source: string
}

interface HarnessclawChannelConfig {
  enabled: boolean
  host: string
  port: number
  token: string
  allowFrom: string[]
}

interface EndpointProbeTarget {
  raw: string
  host: string
  port: number
  protocol: string
}

const CLAWHUB_BIN = join(BIN_DIR, process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub')
const SUPPORTED_PROVIDER_KEYS = new Set([
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
  'auto',
])
const API_KEY_OPTIONAL_PROVIDERS = new Set(['ollama', 'vllm', 'custom'])
const BASE_URL_EXPECTED_PROVIDERS = new Set(['custom', 'vllm', 'azure_openai'])

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function getStringValue(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      return value.trim()
    }
  }
  return ''
}

function getNumberValue(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return null
}

function getStringArrayValue(record: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
  }
  return []
}

function readJsonConfigSafe(path: string): { ok: boolean; data: Record<string, unknown>; error?: string } {
  try {
    if (!existsSync(path)) {
      return { ok: false, data: {}, error: 'File not found' }
    }
    return { ok: true, data: asRecord(JSON.parse(readFileSync(path, 'utf-8'))) }
  } catch (error) {
    return { ok: false, data: {}, error: String(error) }
  }
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
    NANOBOT_HOME: ENGINE_HOME,
  }
}

function getPythonPrefixArgs(command: string): string[] {
  const base = command.split(/[\\/]/).pop() || command
  return /^py(?:\.exe)?$/i.test(base) ? ['-3'] : []
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

function canImportNanobot(command: string, cwd?: string): boolean {
  const result = spawnSync(command, [...getPythonPrefixArgs(command), '-c', 'import nanobot'], {
    cwd,
    env: buildChildEnv(),
    stdio: 'ignore',
    windowsHide: process.platform === 'win32',
    shell: requiresShell(command),
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
      if (!existsSync(candidate) || !statSync(candidate).isDirectory()) continue
      if (!existsSync(join(candidate, 'nanobot'))) continue
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

  const bundledCandidates = getCommandCandidates(
    join(BIN_DIR, process.platform === 'win32' ? 'nanobot.cmd' : 'nanobot'),
    join(BIN_DIR, process.platform === 'win32' ? 'nanobot.exe' : 'nanobot'),
  )
  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) {
      return { command: candidate, args: [], source: `bundled: ${candidate}` }
    }
  }

  for (const binary of process.platform === 'win32' ? ['nanobot.exe', 'nanobot.cmd', 'nanobot'] : ['nanobot']) {
    const resolved = findCommandInPath(binary)
    if (resolved) {
      return { command: resolved, args: [], source: `PATH: ${resolved}` }
    }
  }

  return null
}

function getWorkspaceDir(config?: Record<string, unknown>): string {
  const defaults = asRecord(asRecord(asRecord(config).agents).defaults)
  const workspace = getStringValue(defaults, 'workspace') || getDefaultWorkspaceSetting()
  return expandHomePath(workspace)
}

function getSkillsDir(config?: Record<string, unknown>): string {
  return join(getWorkspaceDir(config), 'skills')
}

function readHarnessclawChannelConfig(config: Record<string, unknown>): HarnessclawChannelConfig {
  const harnessclaw = asRecord(asRecord(config.channels).harnessclaw)
  const parsedPort = getNumberValue(harnessclaw, 'port')

  return {
    enabled: typeof harnessclaw.enabled === 'boolean' ? harnessclaw.enabled : true,
    host: getStringValue(harnessclaw, 'host') || '127.0.0.1',
    port: parsedPort && parsedPort > 0 ? parsedPort : 18765,
    token: getStringValue(harnessclaw, 'token'),
    allowFrom: getStringArrayValue(harnessclaw, 'allowFrom', 'allow_from'),
  }
}

function getProviderConfig(providers: Record<string, unknown>, provider: string): Record<string, unknown> {
  return asRecord(providers[provider])
}

function getProviderApiKey(providerConfig: Record<string, unknown>): string {
  return getStringValue(providerConfig, 'apiKey', 'api_key')
}

function getProviderApiBase(providerConfig: Record<string, unknown>): string {
  return getStringValue(providerConfig, 'apiBase', 'api_base')
}

function getResolvedProviderApiBase(provider: string, providerConfig: Record<string, unknown>): string {
  const configured = getProviderApiBase(providerConfig)
  if (configured) return configured

  if (provider === 'ollama') return 'http://localhost:11434'
  return ''
}

function checkWritablePath(targetPath: string): { ok: boolean; detail: string } {
  try {
    const probePath = existsSync(targetPath) ? targetPath : dirname(targetPath)
    accessSync(probePath, fsConstants.W_OK)
    return { ok: true, detail: probePath }
  } catch (error) {
    return { ok: false, detail: String(error) }
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

function findNanobotGatewayPids(configPath: string): number[] {
  const needles = [configPath.trim()].filter(Boolean)
  const pids = new Set<number>()

  const pidFromFile = readPidFile(NANOBOT_PID_PATH)
  if (pidFromFile) pids.add(pidFromFile)

  if (IS_WINDOWS) {
    const escapedNeedles = needles
      .map((value) => value.replace(/'/g, "''"))
      .map((value) => `'${value}'`)
      .join(',')
    const script = `
$needles = @(${escapedNeedles})
$matches = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'nanobot(\\.exe)?\\s+gateway'
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
        if (Number.isFinite(pid) && pid > 0) pids.add(pid)
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
        if (!Number.isFinite(pid) || pid <= 0) continue
        if (!/nanobot(\.exe)?\s+gateway/.test(command)) continue
        if (needles.some((needle) => command.includes(needle))) {
          pids.add(pid)
        }
      }
    }
  }

  return [...pids]
}

function canConnectToPort(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })

    const finish = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1'
    || normalized === '[::1]'
}

function parseEndpointTarget(rawUrl: string): EndpointProbeTarget | null {
  try {
    const url = new URL(rawUrl)
    const protocol = url.protocol.replace(':', '')
    const port = url.port
      ? Number.parseInt(url.port, 10)
      : protocol === 'https'
        ? 443
        : 80
    if (!url.hostname || !Number.isFinite(port) || port <= 0) {
      return null
    }

    return {
      raw: rawUrl,
      host: url.hostname,
      port,
      protocol,
    }
  } catch {
    return null
  }
}

function hasCliRuntime(): { ok: boolean; detail: string } {
  const bunx = findCommandInPath('bunx')
  const npx = findCommandInPath('npx')

  if (bunx || npx) {
    return {
      ok: true,
      detail: [bunx ? `bunx=${bunx}` : '', npx ? `npx=${npx}` : ''].filter(Boolean).join('\n'),
    }
  }

  return {
    ok: false,
    detail: 'Neither bunx nor npx was found in PATH.',
  }
}

function runClawhub(args: string[], timeoutMs = 15000): {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
} {
  if (!existsSync(CLAWHUB_BIN)) {
    return {
      ok: false,
      stdout: '',
      stderr: `clawhub not found: ${CLAWHUB_BIN}`,
      code: null,
    }
  }

  const result = spawnSync(CLAWHUB_BIN, args, {
    cwd: HARNESSCLAW_HOME,
    env: buildChildEnv(),
    encoding: 'utf-8',
    timeout: timeoutMs,
    windowsHide: process.platform === 'win32',
    shell: requiresShell(CLAWHUB_BIN),
  })

  if (result.error) {
    return {
      ok: false,
      stdout: result.stdout || '',
      stderr: String(result.error),
      code: null,
    }
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status,
  }
}

function runLaunchSmokeTest(launch: LaunchSpec): {
  ok: boolean
  summary: string
  detail?: string
} {
  const result = spawnSync(launch.command, [...launch.args, '--help'], {
    cwd: launch.cwd,
    env: buildChildEnv(),
    encoding: 'utf-8',
    timeout: 8000,
    windowsHide: process.platform === 'win32',
    shell: requiresShell(launch.command),
  })

  if (result.error) {
    return {
      ok: false,
      summary: 'Nanobot launch command failed before startup.',
      detail: String(result.error),
    }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      summary: 'Nanobot launch command is present but did not execute cleanly.',
      detail: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || `exit=${result.status}`,
    }
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  return {
    ok: true,
    summary: 'Nanobot launch command executed successfully.',
    detail: output ? output.slice(0, 1200) : `${launch.command} ${launch.args.join(' ')}`.trim(),
  }
}

async function runGatewayHandshakeProbe(config: HarnessclawChannelConfig): Promise<{
  status: DoctorStatus
  summary: string
  detail?: string
  data?: Record<string, unknown>
}> {
  return await new Promise((resolve) => {
    const ws = new WebSocket(`ws://${config.host}:${config.port}`)
    let settled = false
    let connected = false
    let pong = false
    let sessionsReceived = false
    let sessionCount = 0
    let sessionId = ''

    const finish = (result: {
      status: DoctorStatus
      summary: string
      detail?: string
      data?: Record<string, unknown>
    }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // Ignore close errors during doctor probe.
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      if (!connected) {
        finish({
          status: 'fail',
          summary: 'Gateway handshake timed out before the connected event.',
          detail: `target=ws://${config.host}:${config.port}`,
        })
        return
      }

      finish({
        status: pong && sessionsReceived ? 'pass' : 'warn',
        summary: pong && sessionsReceived
          ? 'Gateway handshake completed.'
          : 'Gateway connected, but some handshake responses were missing.',
        detail: [
          `sessionId=${sessionId || '(empty)'}`,
          `pong=${pong}`,
          `sessions=${sessionsReceived}`,
          `sessionCount=${sessionCount}`,
        ].join('\n'),
        data: { sessionId, pong, sessionsReceived, sessionCount },
      })
    }, 8000)

    ws.on('open', () => {
      if (config.token) {
        ws.send(JSON.stringify({ type: 'auth', token: config.token }))
      }
    })

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>
        const type = String(message.type || '')

        if (type === 'connected') {
          connected = true
          sessionId = String(message.session_id || '')
          ws.send(JSON.stringify({ type: 'ping' }))
          ws.send(JSON.stringify({ type: 'list_sessions' }))
          return
        }

        if (type === 'pong') {
          pong = true
          if (connected && sessionsReceived) {
            finish({
              status: 'pass',
              summary: 'Gateway handshake completed.',
              detail: `sessionId=${sessionId}\nsessionCount=${sessionCount}`,
              data: { sessionId, pong, sessionsReceived, sessionCount },
            })
          }
          return
        }

        if (type === 'sessions') {
          sessionsReceived = true
          sessionCount = Array.isArray(message.data) ? message.data.length : 0
          if (connected && pong) {
            finish({
              status: 'pass',
              summary: 'Gateway handshake completed.',
              detail: `sessionId=${sessionId}\nsessionCount=${sessionCount}`,
              data: { sessionId, pong, sessionsReceived, sessionCount },
            })
          }
          return
        }

        if (type === 'error') {
          finish({
            status: 'fail',
            summary: 'Gateway returned an error during handshake.',
            detail: String(message.content || 'Unknown gateway error'),
          })
        }
      } catch (error) {
        finish({
          status: 'fail',
          summary: 'Gateway returned an unreadable handshake response.',
          detail: String(error),
        })
      }
    })

    ws.on('error', (error) => {
      finish({
        status: 'fail',
        summary: 'Gateway handshake connection failed.',
        detail: String(error),
      })
    })

    ws.on('close', (code, reason) => {
      if (!settled && !connected) {
        finish({
          status: 'fail',
          summary: 'Gateway closed the socket during handshake.',
          detail: `code=${code} reason=${reason.toString()}`,
        })
      }
    })
  })
}

async function runHarnessclawMessageProbe(config: HarnessclawChannelConfig): Promise<{
  ok: boolean
  summary: string
  detail?: string
  data?: Record<string, unknown>
}> {
  return await new Promise((resolve) => {
    const ws = new WebSocket(`ws://${config.host}:${config.port}`)
    let settled = false
    let responseText = ''
    let connectedSessionId = ''

    const finish = (result: { ok: boolean; summary: string; detail?: string; data?: Record<string, unknown> }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // Ignore close errors during doctor probe.
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        summary: 'Minimal message probe timed out.',
        detail: 'Gateway connected, but no complete response arrived within 25 seconds.',
      })
    }, 25000)

    ws.on('open', () => {
      if (config.token) {
        ws.send(JSON.stringify({ type: 'auth', token: config.token }))
      }
    })

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>
        const type = String(message.type || '')

        if (type === 'connected') {
          connectedSessionId = String(message.session_id || '')
          ws.send(JSON.stringify({
            type: 'message',
            session_id: connectedSessionId,
            content: 'Reply with exactly OK.',
          }))
          return
        }

        if (type === 'text_delta') {
          responseText += String(message.content || '')
          return
        }

        if (type === 'response') {
          responseText += String(message.content || '')
          const trimmed = responseText.trim()
          const looksLikeError = /^Error calling LLM:/i.test(trimmed) || /^Error:/i.test(trimmed)
          finish({
            ok: trimmed.length > 0 && !looksLikeError,
            summary: trimmed.length === 0
              ? 'A response arrived, but it was empty.'
              : looksLikeError
                ? 'Model roundtrip returned an explicit runtime error.'
                : 'Minimal message probe succeeded.',
            detail: trimmed,
            data: { sessionId: connectedSessionId, response: trimmed },
          })
          return
        }

        if (type === 'response_end') {
          const trimmed = responseText.trim()
          const looksLikeError = /^Error calling LLM:/i.test(trimmed) || /^Error:/i.test(trimmed)
          finish({
            ok: trimmed.length > 0 && !looksLikeError,
            summary: trimmed.length === 0
              ? 'The response finished without any text content.'
              : looksLikeError
                ? 'Model roundtrip returned an explicit runtime error.'
                : 'Minimal message probe succeeded.',
            detail: trimmed || 'response_end arrived without text content',
            data: { sessionId: connectedSessionId, response: trimmed },
          })
          return
        }

        if (type === 'error') {
          finish({
            ok: false,
            summary: 'Minimal message probe failed.',
            detail: String(message.content || 'Unknown gateway error'),
          })
        }
      } catch (error) {
        finish({
          ok: false,
          summary: 'Minimal message probe returned an unreadable message.',
          detail: String(error),
        })
      }
    })

    ws.on('error', (error) => {
      finish({
        ok: false,
        summary: 'Minimal message probe could not connect.',
        detail: String(error),
      })
    })

    ws.on('close', (code, reason) => {
      if (!settled) {
        finish({
          ok: false,
          summary: 'Minimal message probe socket was closed.',
          detail: `code=${code} reason=${reason.toString()}`,
        })
      }
    })
  })
}

async function runCheck(
  id: string,
  stage: DoctorStage,
  title: string,
  fn: () => Promise<Omit<DoctorCheckResult, 'id' | 'stage' | 'title' | 'durationMs'>> | Omit<DoctorCheckResult, 'id' | 'stage' | 'title' | 'durationMs'>
): Promise<DoctorCheckResult> {
  const startedAt = Date.now()
  try {
    const result = await fn()
    return {
      id,
      stage,
      title,
      durationMs: Date.now() - startedAt,
      ...result,
    }
  } catch (error) {
    return {
      id,
      stage,
      title,
      status: 'fail',
      summary: 'Check execution threw an exception.',
      detail: String(error),
      durationMs: Date.now() - startedAt,
    }
  }
}

export async function runDoctor(): Promise<DoctorRunResult> {
  const startedAt = new Date().toISOString()
  const checks: DoctorCheckResult[] = []

  const engineConfigExists = existsSync(ENGINE_CONFIG_PATH)
  const engineConfigResult = readJsonConfigSafe(ENGINE_CONFIG_PATH)
  const engineConfig = engineConfigResult.data
  const appConfigExists = existsSync(APP_CONFIG_PATH)
  const appConfigResult = appConfigExists
    ? readJsonConfigSafe(APP_CONFIG_PATH)
    : { ok: false, data: {}, error: 'File not found' }
  const appConfig = appConfigResult.data

  const workspaceDir = getWorkspaceDir(engineConfig)
  const skillsDir = getSkillsDir(engineConfig)
  const harnessclawConfig = readHarnessclawChannelConfig(engineConfig)
  const defaults = asRecord(asRecord(engineConfig.agents).defaults)
  const clawhubConfig = asRecord(appConfig.clawhub)
  const providers = asRecord(engineConfig.providers)
  const configuredProvider = getStringValue(defaults, 'provider')
  const configuredModel = getStringValue(defaults, 'model')
  const inferredProvider = configuredProvider && configuredProvider !== 'auto'
    ? configuredProvider
    : (configuredModel.includes('/') ? configuredModel.split('/')[0].trim() : '')
  const providerConfig = inferredProvider ? getProviderConfig(providers, inferredProvider) : {}
  const providerApiKey = inferredProvider ? getProviderApiKey(providerConfig) : ''
  const providerApiBase = inferredProvider ? getResolvedProviderApiBase(inferredProvider, providerConfig) : ''
  const clawhubToken = getStringValue(clawhubConfig, 'token')

  checks.push(await runCheck(
    'environment.home_path',
    'environment',
    'User home directory',
    () => ({
      status: existsSync(homedir()) ? 'pass' : 'fail',
      summary: existsSync(homedir()) ? 'User home directory is available.' : 'User home directory could not be resolved.',
      detail: homedir(),
      fixHint: existsSync(homedir()) ? undefined : 'Check HOME / USERPROFILE environment variables.',
    })
  ))

  checks.push(await runCheck(
    'environment.runtime_dirs',
    'environment',
    'Runtime directory layout',
    () => {
      const targets = [
        HARNESSCLAW_HOME,
        BIN_DIR,
        DB_DIR,
        ENGINE_HOME,
        workspaceDir,
        skillsDir,
      ]
      const missing = targets.filter((target) => !existsSync(target))

      if (missing.length === 0) {
        return {
          status: 'pass',
          summary: 'All core runtime directories already exist.',
          detail: targets.join('\n'),
        }
      }

      return {
        status: 'warn',
        summary: `${missing.length} runtime directories are missing.`,
        detail: missing.join('\n'),
        impact: 'First-run bootstrap or some features may create these directories lazily.',
        fixHint: 'Start the app once, or add an explicit bootstrap step to create missing directories.',
      }
    }
  ))

  checks.push(await runCheck(
    'environment.write_access',
    'environment',
    'Writable runtime paths',
    () => {
      const targets = [HARNESSCLAW_HOME, DB_DIR, workspaceDir, skillsDir]
      const failures = targets
        .map((target) => ({ target, result: checkWritablePath(target) }))
        .filter((item) => !item.result.ok)

      if (failures.length === 0) {
        return {
          status: 'pass',
          summary: 'All key runtime paths are writable.',
          detail: targets.join('\n'),
        }
      }

      return {
        status: 'fail',
        summary: `${failures.length} runtime paths are not writable.`,
        detail: failures.map((item) => `${item.target}\n${item.result.detail}`).join('\n\n'),
        impact: 'Config persistence, database writes, workspace operations, or binary installation will fail.',
        fixHint: 'Fix directory permissions or move runtime paths into a user-writable location.',
      }
    }
  ))

  checks.push(await runCheck(
    'config.nanobot_exists',
    'config',
    'Engine config file',
    () => ({
      status: engineConfigExists ? 'pass' : 'fail',
      summary: engineConfigExists ? 'config.json was found.' : 'config.json is missing.',
      detail: ENGINE_CONFIG_PATH,
      impact: engineConfigExists ? undefined : 'Provider, model, and gateway settings cannot be resolved.',
      fixHint: engineConfigExists ? undefined : 'Run onboard or let the app bootstrap the initial config.',
    })
  ))

  checks.push(await runCheck(
    'config.app_exists',
    'config',
    'App config file',
    () => ({
      status: appConfigExists ? 'pass' : 'warn',
      summary: appConfigExists ? 'harnessclaw.json was found.' : 'harnessclaw.json is missing.',
      detail: APP_CONFIG_PATH,
      impact: appConfigExists ? undefined : 'App-layer preferences may not persist yet.',
      fixHint: appConfigExists ? undefined : 'Open settings and save once to materialize the app config.',
    })
  ))

  checks.push(await runCheck(
    'config.clawhub_token',
    'config',
    'ClawHub token configuration',
    () => {
      if (!appConfigExists || !appConfigResult.ok) {
        return {
          status: 'skip',
          summary: 'Skipped because harnessclaw.json is unavailable.',
        }
      }

      if (!clawhubToken) {
        return {
          status: 'warn',
          summary: 'ClawHub token is not configured in app settings.',
          impact: 'Skill marketplace access may fail on fresh machines or new user profiles.',
          fixHint: 'Open Settings > ClawHub and save a valid token.',
        }
      }

      return {
        status: 'pass',
        summary: 'ClawHub token is present in app settings.',
        detail: `token=${'*'.repeat(Math.min(clawhubToken.length, 8))}`,
      }
    }
  ))

  checks.push(await runCheck(
    'config.parse',
    'config',
    'Config JSON parsing',
    () => {
      const failures: string[] = []
      if (!engineConfigResult.ok) failures.push(`config.json: ${engineConfigResult.error}`)
      if (appConfigExists && !appConfigResult.ok) failures.push(`harnessclaw.json: ${appConfigResult.error}`)

      if (failures.length === 0) {
        return {
          status: 'pass',
          summary: 'Config files parse correctly.',
        }
      }

      return {
        status: 'fail',
        summary: 'At least one config file cannot be parsed.',
        detail: failures.join('\n'),
        impact: 'Runtime will fall back to defaults or ignore sections of the config.',
        fixHint: 'Repair the JSON syntax or revert to a known-good config file.',
      }
    }
  ))

  checks.push(await runCheck(
    'config.harnessclaw_channel',
    'config',
    'Harnessclaw channel config',
    () => {
      if (!engineConfigExists || !engineConfigResult.ok) {
        return {
          status: 'skip',
          summary: 'Skipped because config.json is unavailable.',
        }
      }

      const problems: string[] = []
      if (!harnessclawConfig.enabled) problems.push('channels.harnessclaw.enabled=false')
      if (!harnessclawConfig.host) problems.push('channels.harnessclaw.host is empty')
      if (!Number.isInteger(harnessclawConfig.port) || harnessclawConfig.port <= 0 || harnessclawConfig.port > 65535) {
        problems.push(`invalid port=${harnessclawConfig.port}`)
      }
      if (harnessclawConfig.allowFrom.length === 0) {
        problems.push('allowFrom is empty')
      }

      if (problems.length > 0) {
        return {
          status: 'fail',
          summary: 'Harnessclaw channel config is invalid.',
          detail: problems.join('\n'),
          impact: 'The Electron app cannot connect to the nanobot gateway reliably.',
          fixHint: 'Keep the channel enabled and use a valid host, port, and allowFrom list.',
        }
      }

      return {
        status: 'pass',
        summary: 'Harnessclaw channel config looks valid.',
        detail: [
          `enabled=${harnessclawConfig.enabled}`,
          `host=${harnessclawConfig.host}`,
          `port=${harnessclawConfig.port}`,
          `token=${harnessclawConfig.token ? '(set)' : '(empty)'}`,
          `allowFrom=${harnessclawConfig.allowFrom.join(', ') || '(empty)'}`,
        ].join('\n'),
      }
    }
  ))

  checks.push(await runCheck(
    'config.workspace',
    'config',
    'Workspace and skills path',
    () => {
      if (!engineConfigExists || !engineConfigResult.ok) {
        return {
          status: 'skip',
          summary: 'Skipped because config.json is unavailable.',
        }
      }

      const workspaceSetting = getStringValue(defaults, 'workspace') || getDefaultWorkspaceSetting()
      const legacyWindowsWorkspace = IS_WINDOWS && workspaceSetting.replace(/\\/g, '/').startsWith('~/.nanobot/')

      return {
        status: legacyWindowsWorkspace ? 'warn' : 'pass',
        summary: legacyWindowsWorkspace
          ? 'Workspace still points at the legacy Windows nanobot path.'
          : 'Workspace path resolved successfully.',
        detail: [
          `workspaceSetting=${workspaceSetting}`,
          `workspaceDir=${workspaceDir}`,
          `skillsDir=${skillsDir}`,
        ].join('\n'),
        impact: legacyWindowsWorkspace ? 'Skills and session files may be written into the old location.' : undefined,
        fixHint: legacyWindowsWorkspace ? 'Use ~/.harnessclaw/workspace on Windows for the unified runtime layout.' : undefined,
      }
    }
  ))

  checks.push(await runCheck(
    'config.provider_model_valid',
    'config',
    'Default provider and model',
    () => {
      if (!engineConfigExists || !engineConfigResult.ok) {
        return {
          status: 'skip',
          summary: 'Skipped because config.json is unavailable.',
        }
      }

      if (!configuredModel && !configuredProvider) {
        return {
          status: 'fail',
          summary: 'Default provider/model is not configured.',
          impact: 'Sessions can open, but model calls cannot complete successfully.',
          fixHint: 'Set at least one working provider/model pair in settings.',
        }
      }

      if (!configuredModel) {
        return {
          status: 'fail',
          summary: 'Default model is empty.',
          impact: 'The gateway can receive messages, but the LLM request cannot be constructed correctly.',
          fixHint: 'Set a concrete default model in Settings > Agents or Settings > Models.',
        }
      }

      if (configuredProvider && !SUPPORTED_PROVIDER_KEYS.has(configuredProvider)) {
        return {
          status: 'fail',
          summary: `Unsupported provider: ${configuredProvider}`,
          detail: `provider=${configuredProvider}`,
          fixHint: 'Use a supported provider key or leave provider as auto and keep model in provider/model format.',
        }
      }

      if (!inferredProvider) {
        return {
          status: 'warn',
          summary: 'The effective provider could not be inferred from the current defaults.',
          detail: `provider=${configuredProvider || '(empty)'} model=${configuredModel || '(empty)'}`,
          impact: 'Runtime may fall back to the wrong provider when sending the first turn.',
          fixHint: 'Set an explicit provider, or keep the model as provider/model.',
        }
      }

      if (!API_KEY_OPTIONAL_PROVIDERS.has(inferredProvider) && !providerApiKey) {
        return {
          status: 'fail',
          summary: `${inferredProvider} is missing its API key.`,
          detail: `model=${configuredModel || '(empty)'}`,
          impact: 'Model requests will fail during actual execution.',
          fixHint: 'Add the API key for the selected provider in the model settings page.',
        }
      }

      if (BASE_URL_EXPECTED_PROVIDERS.has(inferredProvider) && !providerApiBase) {
        return {
          status: 'warn',
          summary: `${inferredProvider} has no base URL configured.`,
          detail: `provider=${inferredProvider}`,
          impact: 'OpenAI-compatible or Azure-compatible endpoints may not be routable.',
          fixHint: 'Set apiBase / base URL for the selected provider.',
        }
      }

      if (configuredProvider && configuredProvider !== 'auto' && configuredModel.includes('/')) {
        const modelPrefix = configuredModel.split('/')[0].trim()
        if (modelPrefix && modelPrefix !== configuredProvider) {
          return {
            status: 'warn',
            summary: 'Configured provider and model prefix do not match.',
            detail: `provider=${configuredProvider}\nmodel=${configuredModel}`,
            impact: 'The UI may appear configured, but the runtime may route requests differently than expected.',
            fixHint: 'Either keep provider=auto, or align the model prefix with the selected provider.',
          }
        }
      }

      return {
        status: 'pass',
        summary: `Detected default model ${configuredModel || '(empty)'}.`,
        detail: `provider=${configuredProvider || '(empty)'} inferred=${inferredProvider || '(empty)'}`,
        data: { provider: inferredProvider, model: configuredModel },
      }
    }
  ))

  checks.push(await runCheck(
    'config.provider_endpoint',
    'config',
    'Provider endpoint reachability',
    async () => {
      if (!engineConfigExists || !engineConfigResult.ok) {
        return {
          status: 'skip',
          summary: 'Skipped because config.json is unavailable.',
        }
      }

      if (!inferredProvider) {
        return {
          status: 'skip',
          summary: 'Skipped because no effective provider is configured yet.',
        }
      }

      if (!providerApiBase) {
        if (inferredProvider === 'ollama') {
          return {
            status: 'skip',
            summary: 'Skipped endpoint probe because Ollama will use its default local endpoint.',
            detail: 'default=http://localhost:11434',
          }
        }

        return {
          status: 'skip',
          summary: 'Skipped endpoint probe because no concrete apiBase is configured.',
        }
      }

      const target = parseEndpointTarget(providerApiBase)
      if (!target) {
        return {
          status: 'fail',
          summary: 'The configured provider endpoint is not a valid URL.',
          detail: providerApiBase,
          fixHint: 'Use a full URL such as http://127.0.0.1:11434 or https://api.example.com/v1.',
        }
      }

      const ok = await canConnectToPort(target.host, target.port, 1800)
      if (ok) {
        return {
          status: 'pass',
          summary: 'Provider endpoint is reachable from the app.',
          detail: `${target.protocol}://${target.host}:${target.port}`,
          data: target,
        }
      }

      const local = isLoopbackHost(target.host)
      return {
        status: local ? 'fail' : 'warn',
        summary: local
          ? 'Local provider endpoint is not reachable.'
          : 'Remote provider endpoint could not be reached during the probe.',
        detail: `${target.protocol}://${target.host}:${target.port}`,
        impact: local
          ? 'Model calls will fail immediately on the current machine.'
          : 'This may be a transient network issue, proxy issue, or endpoint outage.',
        fixHint: local
          ? 'Start the local model service, or correct apiBase to the actual listening address.'
          : 'Verify network access, proxy settings, and the provider endpoint address.',
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.launch_target',
    'runtime',
    'Nanobot launch target',
    () => {
      const launch = getNanobotLaunchSpec()
      if (!launch) {
        return {
          status: 'fail',
          summary: 'No usable nanobot launch target was found.',
          impact: 'The app cannot bring up the gateway process.',
          fixHint: 'Provide nanobot via repo venv, bundled binary, or PATH.',
        }
      }

      return {
        status: 'pass',
        summary: 'A nanobot launch target was resolved.',
        detail: `${launch.source}\n${launch.command} ${launch.args.join(' ')}`.trim(),
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.launch_smoke',
    'runtime',
    'Nanobot command smoke test',
    () => {
      const launch = getNanobotLaunchSpec()
      if (!launch) {
        return {
          status: 'skip',
          summary: 'Skipped because no launch target was resolved.',
        }
      }

      const probe = runLaunchSmokeTest(launch)
      return {
        status: probe.ok ? 'pass' : 'fail',
        summary: probe.summary,
        detail: probe.detail,
        impact: probe.ok ? undefined : 'Even if a binary exists, the command cannot currently execute correctly.',
        fixHint: probe.ok ? undefined : 'Verify the Python environment, bundled binary, or PATH installation.',
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.database',
    'runtime',
    'Local database access',
    () => {
      try {
        const row = getDb().prepare('SELECT 1 as ok').get() as { ok: number } | undefined
        if (row?.ok === 1) {
          return {
            status: 'pass',
            summary: 'The local database can be opened.',
            detail: DB_PATH,
          }
        }
        return {
          status: 'warn',
          summary: 'The database opened, but the probe result was unexpected.',
          detail: DB_PATH,
        }
      } catch (error) {
        return {
          status: 'fail',
          summary: 'Database access failed.',
          detail: `${DB_PATH}\n${String(error)}`,
          impact: 'Session history and messages cannot be persisted.',
          fixHint: 'Check db directory permissions and ensure the file is not locked by another process.',
        }
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.gateway_process',
    'runtime',
    'Nanobot gateway process',
    () => {
      const pids = findNanobotGatewayPids(ENGINE_CONFIG_PATH)
      if (pids.length === 0) {
        return {
          status: 'fail',
          summary: 'No nanobot gateway process was detected.',
          detail: NANOBOT_PID_PATH,
          impact: 'The app cannot establish a websocket channel to the engine.',
          fixHint: 'Start the app again or add an explicit restart-gateway action.',
        }
      }

      return {
        status: 'pass',
        summary: `Detected ${pids.length} gateway process(es).`,
        detail: pids.join(', '),
        data: { pids },
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.gateway_port',
    'runtime',
    'Gateway port listening',
    async () => {
      const ok = await canConnectToPort(harnessclawConfig.host, harnessclawConfig.port)
      if (!ok) {
        return {
          status: 'fail',
          summary: `Cannot connect to ${harnessclawConfig.host}:${harnessclawConfig.port}.`,
          impact: 'Even if the process exists, the Electron app cannot use the engine websocket.',
          fixHint: 'Check whether the port is occupied, blocked, or the gateway failed during startup.',
        }
      }

      return {
        status: 'pass',
        summary: `Port ${harnessclawConfig.port} is accepting connections.`,
        detail: `${harnessclawConfig.host}:${harnessclawConfig.port}`,
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.harnessclaw_connection',
    'runtime',
    'App to gateway connection status',
    () => {
      const status = harnessclawClient.getStatus()
      if (status.status === 'connected') {
        return {
          status: 'pass',
          summary: 'The app is connected to the gateway.',
          detail: `clientId=${status.clientId} sessionId=${status.sessionId}`,
          data: status,
        }
      }

      if (status.status === 'connecting') {
        return {
          status: 'warn',
          summary: 'The app is still connecting to the gateway.',
          detail: 'The websocket handshake has not completed yet.',
          data: status,
        }
      }

      return {
        status: 'fail',
        summary: 'The app is not connected to the gateway.',
        detail: `status=${status.status}`,
        impact: 'The chat page will stay in a waiting state.',
        fixHint: 'Check the gateway process and listening port, then trigger reconnect.',
        data: status,
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.clawhub_installed',
    'runtime',
    'ClawHub wrapper',
    () => ({
      status: existsSync(CLAWHUB_BIN) ? 'pass' : 'warn',
      summary: existsSync(CLAWHUB_BIN) ? 'ClawHub wrapper is present.' : 'ClawHub wrapper is not installed yet.',
      detail: CLAWHUB_BIN,
      impact: existsSync(CLAWHUB_BIN) ? undefined : 'Skill search and install actions may be unavailable.',
      fixHint: existsSync(CLAWHUB_BIN) ? undefined : 'Run the one-time ClawHub install step from settings.',
    })
  ))

  checks.push(await runCheck(
    'runtime.clawhub_runtime',
    'runtime',
    'ClawHub runtime prerequisites',
    () => {
      const runtime = hasCliRuntime()
      if (runtime.ok) {
        return {
          status: 'pass',
          summary: 'ClawHub runtime prerequisites are available.',
          detail: runtime.detail,
        }
      }

      return {
        status: existsSync(CLAWHUB_BIN) ? 'fail' : 'warn',
        summary: 'No CLI runtime was found for the ClawHub wrapper.',
        detail: runtime.detail,
        impact: 'Skill market actions cannot execute successfully.',
        fixHint: 'Install Node.js (for npx) or Bun (for bunx), and keep it in PATH.',
      }
    }
  ))

  checks.push(await runCheck(
    'runtime.clawhub_token_validation',
    'runtime',
    'ClawHub token validation',
    () => {
      const wrapperInstalled = existsSync(CLAWHUB_BIN)
      const runtime = hasCliRuntime()

      if (!clawhubToken) {
        return {
          status: 'skip',
          summary: 'Skipped because no ClawHub token is configured.',
        }
      }

      if (!wrapperInstalled || !runtime.ok) {
        return {
          status: 'skip',
          summary: 'Skipped because ClawHub runtime prerequisites are not ready.',
        }
      }

      const result = runClawhub(['login', '--token', clawhubToken], 20000)
      if (result.ok) {
        return {
          status: 'pass',
          summary: 'ClawHub token login succeeded.',
          detail: result.stdout.trim() || 'login ok',
        }
      }

      return {
        status: 'fail',
        summary: 'ClawHub token validation failed.',
        detail: [result.stderr, result.stdout].filter(Boolean).join('\n').trim() || `exit=${result.code}`,
        impact: 'Skill search and install will fail even if the wrapper is present.',
        fixHint: 'Replace the token with a valid one and verify it again in Settings > ClawHub.',
      }
    }
  ))

  checks.push(await runCheck(
    'flow.gateway_handshake',
    'flow',
    'Gateway handshake probe',
    async () => {
      const hasHardFailure = checks.some((check) =>
        check.id === 'runtime.gateway_port' && check.status === 'fail'
        || check.id === 'config.harnessclaw_channel' && check.status === 'fail'
      )

      if (hasHardFailure) {
        return {
          status: 'skip',
          summary: 'Skipped because gateway socket prerequisites already failed.',
        }
      }

      const probe = await runGatewayHandshakeProbe(harnessclawConfig)
      return {
        status: probe.status,
        summary: probe.summary,
        detail: probe.detail,
        impact: probe.status === 'fail' ? 'The websocket channel itself is not healthy yet.' : undefined,
        fixHint: probe.status === 'fail' ? 'Check token, host/port, and gateway startup logs.' : undefined,
        data: probe.data,
      }
    }
  ))

  checks.push(await runCheck(
    'flow.session_message_probe',
    'flow',
    'Default model usability probe',
    async () => {
      const hasHardFailure = checks.some((check) =>
        check.id === 'config.provider_model_valid' && check.status === 'fail'
        || check.id === 'runtime.gateway_port' && check.status === 'fail'
        || check.id === 'flow.gateway_handshake' && check.status === 'fail'
      )

      if (hasHardFailure) {
        return {
          status: 'skip',
          summary: 'Skipped because an earlier gateway or model prerequisite already failed.',
        }
      }

      const probe = await runHarnessclawMessageProbe(harnessclawConfig)
      return {
        status: probe.ok ? 'pass' : 'fail',
        summary: probe.summary,
        detail: probe.detail,
        impact: probe.ok ? undefined : 'The app may show connected, but the default model/API key chain is not usable yet.',
        fixHint: probe.ok ? undefined : 'Check provider/model config, API key, base URL, and nanobot runtime logs.',
        data: probe.data,
      }
    }
  ))

  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1
      return acc
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 }
  )

  return {
    ok: summary.fail === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    checks,
  }
}
