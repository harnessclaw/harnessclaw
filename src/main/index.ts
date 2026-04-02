import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, chmodSync, rmSync } from 'fs'
import { homedir } from 'os'
import { spawn, spawnSync, ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { harnessclawClient } from './harnessclaw'
import {
  getDb, closeDb, upsertSession, updateSessionTitle, listSessions as dbListSessions,
  deleteSession as dbDeleteSession, insertMessage, updateMessageContent,
  getMessages, insertToolActivity
} from './db'

const HARNESSCLAW_DIR = join(homedir(), '.harnessclaw')
const NANOBOT_HOME = join(homedir(), '.nanobot')
const NANOBOT_CONFIG_PATH = join(NANOBOT_HOME, 'config.json')
const APP_CONFIG_PATH = join(homedir(), '.icuclaw.json')
const HARNESSCLAW_LAUNCHED_FLAG = join(HARNESSCLAW_DIR, '.launched')
const BIN_DIR = join(HARNESSCLAW_DIR, 'bin')
const CLAWHUB_BIN = join(BIN_DIR, process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub')
const DEFAULT_WORKSPACE = '~/.nanobot/workspace'

interface LaunchSpec {
  command: string
  args: string[]
  cwd?: string
  source: string
}

let nanobotProcess: ChildProcess | null = null
let safeConsoleInstalled = false

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
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

function isBrokenPipeError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: string }).code === 'EPIPE'
}

function installSafeConsole(): void {
  if (safeConsoleInstalled) return
  safeConsoleInstalled = true

  const methods = ['log', 'info', 'warn', 'error'] as const
  for (const method of methods) {
    const original = console[method].bind(console) as (...args: unknown[]) => void
    Object.defineProperty(console, method, {
      value: (...args: unknown[]) => {
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

function readJsonConfig(path: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
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
  return DEFAULT_WORKSPACE
}

function normalizeNanobotConfig(raw: unknown): Record<string, unknown> {
  const source = asRecord(raw)
  const { _error: _ignored, ...config } = source
  const providers = asRecord(config.providers)
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

  return {
    ...config,
    providers,
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        workspace: typeof defaults.workspace === 'string' && defaults.workspace.trim()
          ? defaults.workspace
          : getDefaultWorkspace(),
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
  const current = readJsonConfig(NANOBOT_CONFIG_PATH, { providers: {} })
  const normalized = normalizeNanobotConfig(current)
  ensureDir(NANOBOT_HOME)
  ensureDir(getWorkspaceDir(normalized))
  ensureDir(getSkillsDir(normalized))

  if (!existsSync(NANOBOT_CONFIG_PATH) || JSON.stringify(current) !== JSON.stringify(normalized)) {
    const saved = saveJsonConfig(NANOBOT_CONFIG_PATH, normalized)
    if (!saved.ok) {
      console.warn('[Nanobot] Failed to persist config:', saved.error)
    }
  }

  return normalized
}

function getWorkspaceDir(config?: Record<string, unknown>): string {
  const normalized = config ? normalizeNanobotConfig(config) : normalizeNanobotConfig(readJsonConfig(NANOBOT_CONFIG_PATH, { providers: {} }))
  const defaults = asRecord(asRecord(asRecord(normalized).agents).defaults)
  const workspace = typeof defaults.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : getDefaultWorkspace()
  return expandHomePath(workspace)
}

function getSkillsDir(config?: Record<string, unknown>): string {
  return join(getWorkspaceDir(config), 'skills')
}

function getClawhubWrapper(): string {
  if (process.platform === 'win32') {
    return `@echo off
setlocal
where bunx >nul 2>nul
if %errorlevel% equ 0 (
  call bunx --bun clawhub@latest %*
  exit /b %errorlevel%
)
where npx >nul 2>nul
if %errorlevel% equ 0 (
  call npx --yes clawhub@latest %*
  exit /b %errorlevel%
)
echo clawhub requires bunx or npx in PATH 1>&2
exit /b 127
`
  }

  return `#!/usr/bin/env bash
set -euo pipefail

if command -v bunx >/dev/null 2>&1; then
  exec bunx --bun clawhub@latest "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx --yes clawhub@latest "$@"
fi

echo "clawhub requires bunx or npx in PATH" >&2
exit 127
`
}

function installClawhubBinary(): { ok: boolean; path: string; error?: string } {
  try {
    ensureDir(BIN_DIR)
    writeFileSync(CLAWHUB_BIN, getClawhubWrapper(), 'utf-8')
    if (process.platform !== 'win32') {
      chmodSync(CLAWHUB_BIN, 0o755)
    }
    return { ok: true, path: CLAWHUB_BIN }
  } catch (err) {
    return { ok: false, path: CLAWHUB_BIN, error: String(err) }
  }
}

function getClawhubStatus(): { installed: boolean; path: string } {
  return {
    installed: existsSync(CLAWHUB_BIN),
    path: CLAWHUB_BIN,
  }
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
    join(appPath, '..', 'nanobot-feat-stream'),
    join(appPath, '..', '..', 'nanobot'),
    join(appPath, '..', '..', 'nanobot-feat-stream'),
    join(process.cwd(), '..', 'nanobot'),
    join(process.cwd(), '..', 'nanobot-feat-stream'),
    join(process.cwd(), 'nanobot'),
    join(process.cwd(), 'nanobot-feat-stream'),
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

  const pythonCandidates = getCommandCandidates(process.env.ICUCLAW_PYTHON, 'py', 'python', 'python3')
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
    if (!existsSync(CLAWHUB_BIN)) {
      resolve({ ok: false, stdout: '', stderr: `clawhub not found: ${CLAWHUB_BIN}`, code: null })
      return
    }

    const config = ensureNanobotConfig()
    const timeoutMs = options?.timeoutMs ?? 30000
    const workspaceDir = getWorkspaceDir(config)
    ensureDir(workspaceDir)

    const finalArgs = ['--workdir', workspaceDir, ...args]
    console.log('[ClawHub] Run:', [CLAWHUB_BIN, ...finalArgs].join(' '), options?.cwd ? `(cwd: ${options.cwd})` : '')

    const child = spawn(CLAWHUB_BIN, finalArgs, {
      env: buildChildEnv(),
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32',
      shell: requiresShell(CLAWHUB_BIN),
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
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
      resolve({ ok: false, stdout, stderr: String(err), code: null })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

function startNanobot(): void {
  if (nanobotProcess) return

  const config = ensureNanobotConfig()
  const launch = getNanobotLaunchSpec()
  if (!launch) {
    console.warn('[Nanobot] No launch target found. Checked repo source, bundled binaries and PATH.')
    return
  }

  console.log('[Nanobot] Starting gateway via', launch.source)
  nanobotProcess = spawn(launch.command, [...launch.args, 'gateway', '--config', NANOBOT_CONFIG_PATH], {
    cwd: launch.cwd,
    env: buildChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: process.platform === 'win32',
    shell: requiresShell(launch.command),
  })

  ensureDir(getWorkspaceDir(config))
  ensureDir(getSkillsDir(config))

  nanobotProcess.stdout?.on('data', (data) => {
    safeWrite(process.stdout, `[Nanobot] ${String(data)}`)
  })
  nanobotProcess.stderr?.on('data', (data) => {
    safeWrite(process.stderr, `[Nanobot] ${String(data)}`)
  })
  nanobotProcess.on('error', (err) => {
    console.error('[Nanobot] Failed to start:', err)
    nanobotProcess = null
  })
  nanobotProcess.on('exit', (code) => {
    console.log('[Nanobot] Exited with code:', code)
    nanobotProcess = null
  })
}

function stopNanobot(): void {
  if (!nanobotProcess) return
  console.log('[Nanobot] Stopping gateway...')
  nanobotProcess.kill()
  nanobotProcess = null
}

installSafeConsole()
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
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
    return ensureNanobotConfig()
  })

  ipcMain.handle('config:save', (_, data: unknown) => {
    const normalized = normalizeNanobotConfig(data)
    const result = saveJsonConfig(NANOBOT_CONFIG_PATH, normalized)
    if (result.ok) {
      ensureDir(getWorkspaceDir(normalized))
      ensureDir(getSkillsDir(normalized))
    }
    return result
  })
  ipcMain.handle('app-config:read', () => {
    return readJsonConfig(APP_CONFIG_PATH, {})
  })

  ipcMain.handle('app-config:save', (_, data: unknown) => {
    return saveJsonConfig(APP_CONFIG_PATH, data)
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
  startNanobot()
  getDb() // Initialize DB on startup
  harnessclawClient.connect()

  harnessclawClient.on('statusChange', (status) => {
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
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
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
          // Don't auto-create session in DB — session is created when user sends first message
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
              // No turn_start received — auto-create assistant message in DB
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
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:disconnect', () => {
    harnessclawClient.disconnect()
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:send', (_, content: string, sessionId?: string) => {
    harnessclawClient.send(content, sessionId)
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
          const title = content.trim().replace(/\n/g, ' ')
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
    return { ok: true }
  })

  ipcMain.handle('harnessclaw:stop', (_, sessionId?: string) => {
    harnessclawClient.stop(sessionId)
    return { ok: true }
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

  ipcMain.handle('harnessclaw:status', () => {
    return harnessclawClient.getStatus()
  })

  createWindow()

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
  stopNanobot()
  closeDb()
})

