import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
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
  deleteSession as dbDeleteSession, insertMessage, updateMessageContent,
  getMessages, insertToolActivity, insertUsageEvent, listUsageEvents
} from './db'
import {
  APP_LOG_PATH,
  LOGS_DIR,
  RENDERER_LOG_PATH,
  USAGE_LOG_PATH,
} from './runtime-paths'
import {
  type LogLevel,
  type LogThreshold,
  type UsageLogEntry,
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
type PersistedSystemNotice = {
  kind: 'error'
  title: string
  message: string
  reason?: string
  sessionId?: string
  hint?: string
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

function startHarnessclawEngine(): void {
  if (harnessclawEngineProcess) return
  if (!HARNESSCLAW_ENGINE_BIN || !existsSync(HARNESSCLAW_ENGINE_BIN)) {
    console.warn('[HarnessclawEngine] Binary not found:', HARNESSCLAW_ENGINE_BIN || '<missing>')
    return
  }
  console.log('[HarnessclawEngine] Starting engine...')
  harnessclawEngineProcess = spawn(HARNESSCLAW_ENGINE_BIN, ['-config', ENGINE_CONFIG_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  harnessclawEngineProcess.stdout?.on('data', (data) => {
    process.stdout.write(`[HarnessclawEngine] ${data}`)
  })
  harnessclawEngineProcess.stderr?.on('data', (data) => {
    process.stderr.write(`[HarnessclawEngine] ${data}`)
  })
  harnessclawEngineProcess.on('error', (err) => {
    console.error('[HarnessclawEngine] Failed to start:', err)
    harnessclawEngineProcess = null
  })
  harnessclawEngineProcess.on('exit', (code) => {
    console.log('[HarnessclawEngine] Exited with code:', code)
    harnessclawEngineProcess = null
  })
}

async function stopHarnessclawEngine(): Promise<void> {
  if (!harnessclawEngineProcess) return
  console.log('[HarnessclawEngine] Stopping engine...')
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
  ensureLoggingDirs()
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
      await restartHarnessclawRuntime()
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

      switch (type) {
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
        case 'tool_call': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'call',
                name: event.name as string,
                content: JSON.stringify(event.arguments, null, 2),
                callId: event.call_id as string,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'tool_result': {
          if (sid) {
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              insertToolActivity(aid, {
                type: 'result',
                name: event.name as string,
                content: (event.content as string) || '',
                callId: event.call_id as string,
                isError: event.is_error as boolean,
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
          upsertSession(sid)
          insertMessage({
            id: `sys-${Date.now()}`,
            sessionId: sid,
            role: 'system',
            content: notice.message,
            systemNotice: notice,
            createdAt: Date.now(),
          })
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
