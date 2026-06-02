import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage, screen, globalShortcut, protocol, net } from 'electron'
import { basename, dirname, extname, isAbsolute, join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, copyFileSync } from 'fs'
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
  getDb, closeDb, upsertSession, updateSessionTitle, updateSessionProject, listSessions as dbListSessions,
  deleteSession as dbDeleteSession, insertMessage, updateMessageContent, updateMessageSystemNotice,
  getMessages, insertToolActivity, insertUsageEvent, listUsageEvents, createProject, getProject,
  listProjects as dbListProjects, softDeleteProjectWithSessions, listProjectSessions,
} from './db'
import {
  DB_PATH,
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
import {
  listAgents as consoleListAgents,
  getAgent as consoleGetAgent,
  createAgent as consoleCreateAgent,
  updateAgent as consoleUpdateAgent,
  deleteAgent as consoleDeleteAgent,
  probeConsole,
  setConsolePort,
  getConsolePort,
  getSessionMetrics,
  listRegistryModels,
  listProviderModels,
  getAgentCapabilities,
  listProviders,
  createProvider,
  getFallbackChain,
  updateFallbackChain,
  getAgentConfig,
  patchAgentConfig,
  patchProvider,
  listEndpoints,
  createEndpoint,
  patchEndpoint,
  deleteEndpoint,
  listTools,
  getTool,
  patchTool,
  fetchArtifactContent,
  type ProviderPatch,
  type ProviderCreatePayload,
  type EndpointCreatePayload,
  type EndpointPatch,
  type AgentPatch,
  type ToolPatchPayload,
} from './console-api'

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
const PROJECT_CONTEXT_BLOCK_START = '[HARNESSCLAW_PROJECT_CONTEXT]'
const PROJECT_CONTEXT_BLOCK_END = '[/HARNESSCLAW_PROJECT_CONTEXT]'
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

function stripProjectContextBlock(content: string): string {
  const startIndex = content.indexOf(PROJECT_CONTEXT_BLOCK_START)
  const endIndex = content.indexOf(PROJECT_CONTEXT_BLOCK_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return content

  return `${content.slice(0, startIndex)}${content.slice(endIndex + PROJECT_CONTEXT_BLOCK_END.length)}`.trim()
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

// Returns true when the only differences between `previous` and `next`
// engine configs are inside `llm.providers`, `llm.default_provider`, or
// `llm.fallback_chain` — sections that the Providers Management API
// (harnessclaw-engine/docs/api/providers-management-api.md) hot-reloads
// at runtime. In that case the renderer has already pushed the change
// through the API, so killing + relaunching the engine would only
// disconnect the WebSocket for no benefit (and emit a server-side WARN
// about the unclean close).
function isProvidersOnlyConfigChange(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  // Top-level keys outside `llm` must be byte-identical.
  const prevTop = { ...previous, llm: undefined }
  const nextTop = { ...next, llm: undefined }
  if (JSON.stringify(prevTop) !== JSON.stringify(nextTop)) return false

  // Inside `llm`, only the providers / default_provider / fallback_chain
  // keys are allowed to differ. Everything else (health, default_max_tokens,
  // etc.) requires a restart.
  const prevLlm = asRecord(previous.llm)
  const nextLlm = asRecord(next.llm)
  const hotKeys = new Set(['providers', 'default_provider', 'fallback_chain'])
  const allKeys = new Set([...Object.keys(prevLlm), ...Object.keys(nextLlm)])
  for (const key of allKeys) {
    if (hotKeys.has(key)) continue
    if (JSON.stringify(prevLlm[key]) !== JSON.stringify(nextLlm[key])) return false
  }
  return true
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

// Extensions whose bytes are NOT valid UTF-8 text. Reading these with
// `readFileSync(path, 'utf-8')` produces mojibake (例如 .docx 这类压缩包
// 格式)。这些文件必须当作二进制处理：预览时不展示原始字节，导出时直接复制
// 源文件，避免在 UTF-8 与二进制之间来回转换导致内容损坏。
const BINARY_FILE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.avif', '.tiff', '.tif',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.parquet',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
])

function isBinaryFile(filePath: string): boolean {
  return BINARY_FILE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

// sniffMimeForBase64 returns the MIME type for files that are allowed
// to flow through user.message.content as a base64 image/PDF block.
// Returns "" for any file outside the whitelist — caller treats that
// as an `unsupported_mime` rejection so the engine + renderer agree
// on the same closed set (mirror of multimodal.AllowedImageMIMEs).
const ALLOWED_INLINE_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

function sniffMimeForBase64(filePath: string): string {
  return ALLOWED_INLINE_MIMES[extname(filePath).toLowerCase()] ?? ''
}

// 富预览：用于 docx / xlsx / pptx / pdf 这几类「二进制但可读出可读内容」
// 的文件。把它们在主进程统一转成 HTML 或纯文本字符串，前端按 kind 渲染：
//   - 'html': 直接 dangerouslySetInnerHTML 到 prose 容器
//   - 'text': pre-wrap 排版，保留换行与分页标记
type RichPreviewKind = 'html' | 'text'
type RichPreviewResult = { kind: RichPreviewKind; content: string }

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function buildRichPreview(ext: string, filePath: string): Promise<RichPreviewResult> {
  // .docx → mammoth：直接产出干净的语义化 HTML（段落、标题、列表、表格、
  // 加粗、斜体、链接、内联图）。
  if (ext === '.docx') {
    const mammoth = require('mammoth') as typeof import('mammoth')
    const result = await mammoth.convertToHtml({ path: filePath })
    return { kind: 'html', content: result.value || '' }
  }

  // .xlsx → SheetJS：每个 sheet 单独转成 HTML 表格，加 sheet 名作为小标题，
  // 多 sheet 之间用 <hr/> 分隔。SheetJS 输出的 HTML 自带边框/合并单元格属性，
  // 配合 prose 容器里的 prose-table 样式即可获得可读的表格预览。
  if (ext === '.xlsx') {
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.readFile(filePath, { cellHTML: true })
    const parts: string[] = []
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name]
      if (!sheet) continue
      const tableHtml = XLSX.utils.sheet_to_html(sheet, { header: '', footer: '' })
      parts.push(`<h3>${escapeHtml(name)}</h3>${tableHtml}`)
    }
    return { kind: 'html', content: parts.join('<hr/>') }
  }

  // .pptx → 自写解析：pptx 也是 ZIP+XML，没有体量合适的 JS 解析器，所以
  // 直接用 mammoth 已经间接带入的 jszip，把每张幻灯片里 <a:t> 标签里的
  // 文本抽出来，按幻灯片组织为标题 + 文本块。够用来浏览要点，比塞个庞大
  // 的 pptx 解析依赖更划算。
  if (ext === '.pptx') {
    const JSZip = require('jszip') as typeof import('jszip')
    const buffer = readFileSync(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const slideNames = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const an = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || '0', 10)
        const bn = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || '0', 10)
        return an - bn
      })
    const sections: string[] = []
    for (let i = 0; i < slideNames.length; i += 1) {
      const xml = await zip.file(slideNames[i])!.async('string')
      // <a:t>...</a:t> 是 OOXML 里的纯文本运行节点；按出现顺序拼接，
      // 不同 <a:p>（段落）之间在 XML 里是 `</a:p><a:p>`，用换行近似还原。
      const paragraphs = xml.split(/<\/a:p>/).map((chunk) => {
        const texts = [...chunk.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => m[1])
        return texts.join('')
      }).filter((line) => line.trim().length > 0)
      const body = paragraphs.length
        ? paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
        : '<p class="text-muted-foreground">（空白幻灯片）</p>'
      sections.push(`<section><h3>幻灯片 ${i + 1} / ${slideNames.length}</h3>${body}</section>`)
    }
    return {
      kind: 'html',
      content: sections.length ? sections.join('<hr/>') : '<p>（未检测到幻灯片内容）</p>',
    }
  }

  // .pdf → pdf-parse(1.x)：内部用 pdf.js 解析。视觉版式恢复成本远高于
  // 收益，这里只取纯文本，PDF 原始排版以"导出"按钮（copyFileSync 原始字节）
  // 为准。直接从 lib 子路径 require 以绕开包入口的调试逻辑（pdf-parse 顶层
  // 在 `!module.parent` 时会尝试读取一个示例 pdf 文件用于自测，打包后可能
  // 触发误判）。
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as
      (data: Buffer) => Promise<{ text: string; numpages: number }>
    const buffer = readFileSync(filePath)
    const data = await pdfParse(buffer)
    const header = `（共 ${data.numpages} 页，仅提取文本，原始版式以"导出"为准）\n\n`
    return { kind: 'text', content: header + (data.text || '') }
  }

  throw new Error(`unsupported rich preview ext: ${ext}`)
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
      // Enable the <webview> tag so the chat search-result drawer can preview
      // external URLs in-app without leaving the React shell. Each <webview>
      // runs in an isolated guest renderer.
      webviewTag: true,
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

  // Plain `<a href="https://...">` clicks (without target=_blank) trigger
  // `will-navigate` instead of going through `setWindowOpenHandler`. Without
  // this guard, the BrowserWindow would replace the renderer app with the
  // external URL — for example, clicking an artifact preview link in chat
  // would navigate the whole app away from the React shell.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    // Allow the renderer's own host (dev server) and local file:// pages.
    const currentURL = mainWindow.webContents.getURL()
    let currentHost = ''
    try {
      currentHost = new URL(currentURL).host
    } catch {
      currentHost = ''
    }
    const isInternal =
      parsed.protocol === 'file:' ||
      (currentHost && parsed.host === currentHost)
    if (isInternal) return

    event.preventDefault()
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      void shell.openExternal(parsed.toString())
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  setupAutoUpdater(mainWindow)
  mainWindowRef = mainWindow
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
    }
  })
  return mainWindow
}

// ────────────────────────────────────────────────────────────────────
// Quick-launcher window (Alfred-style)
//
// A small, frameless, always-on-top BrowserWindow that loads the same
// renderer bundle but at the `#/launcher` hash. The renderer detects
// that hash and renders <LauncherPage /> instead of the full app shell.
//
// The window is created lazily on first hotkey press and reused
// afterwards (cheaper than re-creating per toggle; the renderer
// remembers the input value across hides). Submitting the question
// hides the launcher, focuses the main window, and pushes a
// `launcher:question` IPC event with the prompt; <App> in the main
// renderer subscribes to it and navigates to /chat with the prompt
// pre-filled (which ChatPage then auto-sends as its initial turn).
// ────────────────────────────────────────────────────────────────────

let launcherWindow: BrowserWindow | null = null
let mainWindowRef: BrowserWindow | null = null

const LAUNCHER_WIDTH = 710
const LAUNCHER_HEIGHT = 90
// Distance from the top edge of the display (NOT the work area, so
// the menu bar / taskbar is excluded) to the launcher's top edge.
// The user pins this at 140px so the bar feels anchored just below
// the top of the screen — a familiar Spotlight-ish anchor point.
const LAUNCHER_TOP_OFFSET = 140

function createLauncherWindow(): BrowserWindow {
  // Anchor the launcher to whichever display currently has the cursor
  // so the user sees it on the screen they're actively using (e.g. an
  // external monitor) rather than the primary one.
  const cursorPoint = screen.getCursorScreenPoint()
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint)
  // Use the full display `bounds` (not `workArea`) for both axes so the
  // 140px top offset is measured from the actual screen edge rather
  // than from below the menu bar / taskbar.
  const { x: dx, y: dy, width: dw } = targetDisplay.bounds
  const x = Math.round(dx + (dw - LAUNCHER_WIDTH) / 2)
  const y = dy + LAUNCHER_TOP_OFFSET

  const win = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#FFFFFF',
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Always float above other apps, even fullscreen ones (macOS).
  win.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // Hide when focus is lost so the launcher behaves like a popover —
  // clicking elsewhere dismisses it, just like Alfred / Spotlight.
  win.on('blur', () => {
    if (launcherWindow && !launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      launcherWindow.hide()
    }
  })

  win.on('closed', () => {
    if (launcherWindow === win) {
      launcherWindow = null
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/launcher`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/launcher' })
  }

  return win
}

function showLauncher(): void {
  let coldStart = false
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    launcherWindow = createLauncherWindow()
    coldStart = true
  } else {
    // Re-anchor to the current cursor display each time so users with
    // multiple monitors see it next to where they're looking. The
    // top offset is measured against the display's outer bounds so
    // the launcher sits 140px below the screen edge regardless of
    // the menu bar / taskbar.
    const cursorPoint = screen.getCursorScreenPoint()
    const targetDisplay = screen.getDisplayNearestPoint(cursorPoint)
    const { x: dx, y: dy, width: dw } = targetDisplay.bounds
    launcherWindow.setBounds({
      x: Math.round(dx + (dw - LAUNCHER_WIDTH) / 2),
      y: dy + LAUNCHER_TOP_OFFSET,
      width: LAUNCHER_WIDTH,
      height: LAUNCHER_HEIGHT,
    })
  }
  const win = launcherWindow
  win.show()
  win.focus()
  // On cold start the React app hasn't mounted yet, so `launcher:reset`
  // would be lost. Defer it until the renderer finishes loading; on
  // warm re-shows the listener is already wired so we can send right
  // away to clear stale input and re-focus the field.
  if (coldStart) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('launcher:reset')
    })
  } else {
    win.webContents.send('launcher:reset')
  }
}

function toggleLauncher(): void {
  if (launcherWindow && !launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
    launcherWindow.hide()
    return
  }
  showLauncher()
}

/**
 * Resolve the launcher settings out of the app config.
 *   • `enabled` — whether the global hotkey should be registered at all.
 *     Default true. Disabling here doesn't tear down the launcher
 *     window; the user can no longer summon it via the OS-level
 *     accelerator, but in-app entry points (if any are added later)
 *     still work.
 *   • `hotkey`  — Electron accelerator string (e.g. `"Alt+Space"`,
 *     `"CommandOrControl+Shift+K"`). Stored verbatim so we can hand
 *     it straight to `globalShortcut.register`.
 */
const DEFAULT_LAUNCHER_HOTKEY = 'Alt+Space'

function readLauncherSettings(): { enabled: boolean; hotkey: string } {
  try {
    const cfg = asRecord(readHarnessclawConfig({}))
    const launcher = asRecord(cfg.launcher)
    const enabled = launcher.enabled === true
    const hotkey = typeof launcher.hotkey === 'string' && launcher.hotkey.trim().length > 0
      ? String(launcher.hotkey).trim()
      : DEFAULT_LAUNCHER_HOTKEY
    return { enabled, hotkey }
  } catch {
    return { enabled: false, hotkey: DEFAULT_LAUNCHER_HOTKEY }
  }
}

let registeredLauncherAccelerator: string | null = null

/**
 * Apply the current launcher config — unregister any previously bound
 * accelerator and re-register the new one if the launcher is enabled.
 * Safe to call repeatedly (idempotent for the same hotkey).
 */
function applyLauncherConfig(): void {
  const { enabled, hotkey } = readLauncherSettings()

  // Always release the prior binding first so changing the hotkey
  // doesn't leave the old one wired up.
  if (registeredLauncherAccelerator) {
    try {
      globalShortcut.unregister(registeredLauncherAccelerator)
    } catch {
      /* ignore — accelerator may have been unregistered already */
    }
    registeredLauncherAccelerator = null
  }

  if (!enabled) {
    writeAppLog('info', 'launcher.shortcut', 'Quick launcher disabled by config')
    return
  }

  try {
    const ok = globalShortcut.register(hotkey, () => {
      toggleLauncher()
    })
    if (ok) {
      registeredLauncherAccelerator = hotkey
      writeAppLog('info', 'launcher.shortcut', `Registered launcher hotkey: ${hotkey}`)
    } else {
      writeAppLog('warn', 'launcher.shortcut', `Failed to register ${hotkey} — another app may already own it`)
    }
  } catch (error) {
    writeAppLog('warn', 'launcher.shortcut', `Invalid launcher hotkey: ${hotkey}`, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// 注册自定义协议 `local-file://`，用于在渲染端安全加载磁盘上的图片 /
// 音视频等本地资源。直接 <img src="file:///..."> 在 Electron 默认安全
// 配置（webSecurity=true, contextIsolation=true）下会被跨源策略拦截，
// 尤其在 dev 模式下页面本身来自 http://localhost。`local-file` 走自定义
// scheme：renderer 侧拼成 `local-file://local/<absolute-path>`（`local`
// 是固定占位 host，避免 Chromium 把路径首段提升为 host），主进程在
// protocol.handle 里转回 file:// 用 net.fetch 读取。
// registerSchemesAsPrivileged 必须在 app.ready 之前调用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
])

app.whenReady().then(() => {
  // 把 local-file:// 解析回磁盘路径，再以 file:// 流回浏览器。
  //
  // URL 形如 `local-file://local/<encoded-abs-path>`：`local` 是固定占位
  // host（详见 renderer 端 `localFileUrl` 的注释 —— 没有 host 时 Chromium
  // 会把路径首段提升为 host，pathname 就少一段，文件就读不到）。所以
  // 这里只看 `url.pathname`，host 直接忽略。
  //
  // 之后必须用 pathToFileURL 重新编码成合法 file:// URL，否则带空格 /
  // 中文 / `#` / `?` 的路径会拼出非法 URL，net.fetch 会静默失败、渲染端
  // 只看到一张破图。
  protocol.handle('local-file', (request) => {
    try {
      const url = new URL(request.url)
      // macOS/Linux: pathname = /Users/foo/bar.png
      // Windows:    pathname = /C:/Users/foo.png，需要去掉前导 `/` 还原盘符
      let filePath = decodeURIComponent(url.pathname)
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1)
      }
      return net.fetch(pathToFileURL(filePath).href)
    } catch (err) {
      writeAppLog('error', 'protocol.local-file', 'Failed to resolve URL', {
        url: request.url,
        error: String(err),
      })
      return new Response('Bad Request', { status: 400 })
    }
  })

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
    // Snapshot the on-disk config before the write so we can detect
    // whether the diff is hot-reloadable. If only the LLM provider /
    // chain / default_provider keys changed, the renderer has already
    // pushed the change through the Providers Management API and a
    // restart would just churn the WebSocket. See
    // harnessclaw-engine/docs/api/providers-management-api.md.
    const previous = readEngineConfig({ providers: {} })
    const result = saveEngineConfig(data)
    if (result.ok && existsSync(HARNESSCLAW_LAUNCHED_FLAG)) {
      const next = asRecord(data)
      if (isProvidersOnlyConfigChange(previous, next)) {
        writeAppLog(
          'info',
          'setting.engine',
          'Engine config saved (providers-only, hot-reloaded; skipping restart)',
        )
      } else {
        writeAppLog('info', 'setting.engine', 'Engine config saved, restarting runtime')
        await restartHarnessclawRuntime()
      }
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
      // Re-apply launcher hotkey / enabled state so changes from the
      // settings page take effect without an app restart.
      applyLauncherConfig()
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

  ipcMain.handle('app-runtime:openDatabaseLocation', async (_, rawPath?: string) => {
    const expandHome = (input: string): string => {
      if (input === '~') return homedir()
      if (input.startsWith('~/')) return join(homedir(), input.slice(2))
      return input
    }

    const candidate = typeof rawPath === 'string' && rawPath.trim().length > 0 ? rawPath.trim() : DB_PATH
    const expanded = expandHome(candidate)
    const absolute = isAbsolute(expanded) ? expanded : join(homedir(), expanded)

    if (existsSync(absolute) && statSync(absolute).isFile()) {
      shell.showItemInFolder(absolute)
      return { ok: true, path: absolute }
    }

    const parent = dirname(absolute)
    if (!existsSync(parent)) {
      return { ok: false, path: parent, error: `目录不存在：${parent}` }
    }
    const error = await shell.openPath(parent)
    return {
      ok: !error,
      path: parent,
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

  // Allowlisted external URL launcher. The renderer asks the main process to
  // open a URL in the user's default browser (used by the chat web-preview
  // drawer's "Open in browser" button). Only http(s) and mailto are honored
  // so a malicious or buggy caller can't pivot into shell:// / file:// etc.
  ipcMain.handle('app-runtime:openExternal', async (_, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { ok: false as const, error: 'invalid url' }
    }
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return { ok: false as const, error: 'invalid url' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      return { ok: false as const, error: 'protocol not allowed' }
    }
    try {
      await shell.openExternal(parsed.toString())
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: String((error as Error)?.message || error) }
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

  ipcMain.handle('db:createProjectSession', (_, input: {
    sessionId: string
    projectId: string
    title?: string
  }) => {
    try {
      const project = getProject(input.projectId)
      if (!project) return { ok: false, error: 'Project not found' }

      upsertSession(input.sessionId, input.title, {
        projectId: project.project_id,
        projectContextJson: JSON.stringify({
          project_id: project.project_id,
          name: project.name,
          description: project.description,
          created_at: project.created_at,
        }),
      })
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

  ipcMain.handle('db:updateSessionProject', (_, sessionId: string, projectId: string | null) => {
    try {
      updateSessionProject(sessionId, projectId)
      broadcastDbSessionsChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('db:listProjects', () => {
    try {
      return dbListProjects()
    } catch (err) {
      console.error('[DB] listProjects error:', err)
      return []
    }
  })

  ipcMain.handle('db:getProject', (_, projectId: string) => {
    try {
      return getProject(projectId)
    } catch (err) {
      console.error('[DB] getProject error:', err)
      return null
    }
  })

  ipcMain.handle('db:createProject', (_, input: { projectId: string; name: string; description?: string }) => {
    try {
      const project = createProject(input)
      return { ok: true, project }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('db:deleteProject', (_, projectId: string) => {
    try {
      const result = softDeleteProjectWithSessions(projectId)
      broadcastDbSessionsChanged()
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('db:listProjectSessions', (_, projectId: string) => {
    try {
      return listProjectSessions(projectId)
    } catch (err) {
      console.error('[DB] listProjectSessions error:', err)
      return []
    }
  })

  ipcMain.handle('console:listAgents', async (_, params?: { agent_type?: string; source?: string; limit?: number; offset?: number }) => {
    try {
      return await consoleListAgents(params)
    } catch (err) {
      return { code: 'INTERNAL_ERROR', message: String(err) }
    }
  })

  ipcMain.handle('console:getAgent', async (_, name: string) => {
    try {
      return await consoleGetAgent(name)
    } catch (err) {
      return { code: 'INTERNAL_ERROR', message: String(err) }
    }
  })

  ipcMain.handle('console:createAgent', async (_, agent: Record<string, unknown>) => {
    try {
      return await consoleCreateAgent(agent as any)
    } catch (err) {
      return { code: 'INTERNAL_ERROR', message: String(err) }
    }
  })

  ipcMain.handle('console:updateAgent', async (_, name: string, fields: Record<string, unknown>) => {
    try {
      return await consoleUpdateAgent(name, fields as any)
    } catch (err) {
      return { code: 'INTERNAL_ERROR', message: String(err) }
    }
  })

  ipcMain.handle('console:deleteAgent', async (_, name: string) => {
    try {
      return await consoleDeleteAgent(name)
    } catch (err) {
      return { code: 'INTERNAL_ERROR', message: String(err) }
    }
  })

  ipcMain.handle('console:probe', async (_, port?: number) => {
    try {
      return await probeConsole(port)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('console:setPort', (_, port: number) => {
    setConsolePort(port)
    return { ok: true, port: getConsolePort() }
  })

  ipcMain.handle('console:getPort', () => {
    return { port: getConsolePort() }
  })

  // Session Metrics — GET /api/v1/sessions/{id}/metrics on the Console
  // port. See harnessclaw-engine/docs/api/session-metrics-api.md. We
  // proxy this through main-process IPC instead of fetching from the
  // renderer directly so we don't have to widen the renderer's CSP to
  // include the Console host:port.
  ipcMain.handle('console:getSessionMetrics', async (_, sessionId: string) => {
    try {
      return await getSessionMetrics(sessionId)
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  // Model Registry — GET /api/v1/models on the Console port.
  // See harnessclaw-engine/docs/api/models-registry-api.md. Proxied
  // through main-process IPC so the renderer doesn't hit CORS / CSP
  // restrictions when talking to the local engine.
  ipcMain.handle('console:listRegistryModels', async () => {
    try {
      return await listRegistryModels()
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:listProviderModels', async (_, payload) => {
    try {
      return await listProviderModels(payload)
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  // Agent capabilities — GET /api/v1/agent/capabilities. Resolved
  // SupportsFlags + derived buckets for the active model, override-aware.
  // The multimodal gate hook reads this instead of normalising /agent
  // + /models in the renderer.
  ipcMain.handle('console:getAgentCapabilities', async () => {
    try {
      return await getAgentCapabilities()
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  // Tools Management — GET/PATCH /api/v1/tools[/{name}] on the Console
  // port. See harnessclaw-engine/docs/api/tools-management-api.md.
  // Currently covers the search backends (web_search / tavily_search).
  // PATCH hot-reloads the registry AND persists back to the yaml, so
  // changes take effect for the next sub-agent spawn without restart.
  ipcMain.handle('console:listTools', async () => {
    try {
      return await listTools()
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:getTool', async (_, name: string) => {
    try {
      return await getTool(name)
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:patchTool', async (_, name: string, patch: ToolPatchPayload) => {
    try {
      return await patchTool(name, patch || {})
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  // Providers Management API — see
  // harnessclaw-engine/docs/api/providers-management-api.md. Hot-edit
  // provider config & the agent block (primary + fallback_chain) at
  // runtime. Engine 2026-05-14+: management API is **always** mounted
  // regardless of chain length, including the degraded-mode case
  // (primary="" && fallback=[]). A 404 here is a genuine "path not
  // found", not "not yet available".
  ipcMain.handle('console:listProviders', async () => {
    try {
      return await listProviders()
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  // POST /api/v1/providers — engine creates a new provider entry
  // (credentials only; endpoints are POSTed separately). Used by the
  // renderer when the user selects a vendor (e.g. deepseek/google) whose
  // key isn't yet present in the engine's `llm.providers.*` map.
  ipcMain.handle('console:createProvider', async (_, payload: ProviderCreatePayload) => {
    try {
      if (!payload || typeof payload.name !== 'string' || !payload.name.trim()) {
        return { ok: false, status: 400, error: 'bad_request', message: 'provider name required' }
      }
      if (payload.name.includes(':') || payload.name.includes('.')) {
        return {
          ok: false,
          status: 400,
          error: 'bad_request',
          message: 'provider name must not contain ":" or "."',
        }
      }
      if (
        payload.type !== 'openai' &&
        payload.type !== 'anthropic' &&
        payload.type !== 'gemini'
      ) {
        return { ok: false, status: 400, error: 'bad_request', message: 'invalid provider type' }
      }
      return await createProvider(payload)
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:getFallbackChain', async () => {
    try {
      return await getFallbackChain()
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:updateFallbackChain', async (_, chain: string[]) => {
    try {
      if (!Array.isArray(chain)) {
        return { ok: false, status: 400, error: 'bad_request', message: 'chain must be an array' }
      }
      return await updateFallbackChain(chain)
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  // Engine 2026-05-14+ /api/v1/agent — direct access to the full agent
  // block. Renderer uses this for the agent-level tuning fields
  // (max_tokens / temperature / context_window) which the flat-chain
  // wrappers above intentionally hide.
  ipcMain.handle('console:getAgentConfig', async () => {
    try {
      return await getAgentConfig()
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:patchAgentConfig', async (_, patch: AgentPatch) => {
    try {
      if (!patch || typeof patch !== 'object') {
        return { ok: false, status: 400, error: 'bad_request', message: 'patch body required' }
      }
      // Engine rejects empty PATCH with 400; pre-check so we don't
      // round-trip just to learn nothing changed.
      const hasField =
        'primary' in patch ||
        'fallback_chain' in patch ||
        'max_tokens' in patch ||
        'temperature' in patch ||
        'context_window' in patch
      if (!hasField) {
        return { ok: false, status: 400, error: 'bad_request', message: 'patch must include at least one field' }
      }
      return await patchAgentConfig(patch)
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:patchProvider', async (_, name: string, patch: ProviderPatch) => {
    try {
      if (!name || typeof name !== 'string') {
        return { ok: false, status: 400, error: 'bad_request', message: 'provider name required' }
      }
      return await patchProvider(name, patch || {})
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle('console:listEndpoints', async (_, providerName: string) => {
    try {
      if (!providerName || typeof providerName !== 'string') {
        return { ok: false, status: 400, error: 'bad_request', message: 'provider name required' }
      }
      return await listEndpoints(providerName)
    } catch (error) {
      return { ok: false, status: 0, error: 'network_error', message: String(error) }
    }
  })

  ipcMain.handle(
    'console:createEndpoint',
    async (_, providerName: string, payload: EndpointCreatePayload) => {
      try {
        if (!providerName || typeof providerName !== 'string') {
          return { ok: false, status: 400, error: 'bad_request', message: 'provider name required' }
        }
        if (!payload || typeof payload.name !== 'string' || typeof payload.model !== 'string') {
          return {
            ok: false,
            status: 400,
            error: 'bad_request',
            message: 'name and model required',
          }
        }
        return await createEndpoint(providerName, payload)
      } catch (error) {
        return { ok: false, status: 0, error: 'network_error', message: String(error) }
      }
    },
  )

  ipcMain.handle(
    'console:patchEndpoint',
    async (_, providerName: string, endpointName: string, patch: EndpointPatch) => {
      try {
        if (!providerName || !endpointName) {
          return {
            ok: false,
            status: 400,
            error: 'bad_request',
            message: 'provider and endpoint name required',
          }
        }
        return await patchEndpoint(providerName, endpointName, patch || {})
      } catch (error) {
        return { ok: false, status: 0, error: 'network_error', message: String(error) }
      }
    },
  )

  ipcMain.handle(
    'console:deleteEndpoint',
    async (_, providerName: string, endpointName: string) => {
      try {
        if (!providerName || !endpointName) {
          return {
            ok: false,
            status: 400,
            error: 'bad_request',
            message: 'provider and endpoint name required',
          }
        }
        return await deleteEndpoint(providerName, endpointName)
      } catch (error) {
        return { ok: false, status: 0, error: 'network_error', message: String(error) }
      }
    },
  )

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

  ipcMain.handle('files:save', async (event, options: { defaultFileName?: string; content?: string; sourcePath?: string } | undefined) => {
    try {
      writeAppLog('info', 'files:save', 'IPC files:save received', {
        hasDefaultFileName: Boolean(options?.defaultFileName),
        contentLength: options?.content?.length ?? 0,
        hasSourcePath: Boolean(options?.sourcePath),
      })
      const fileName = typeof options?.defaultFileName === 'string' && options.defaultFileName.trim()
        ? options.defaultFileName.trim()
        : 'untitled.txt'
      const content = typeof options?.content === 'string' ? options.content : ''
      // Resolve the optional source path: when supplied (e.g. previewing a
      // binary .docx that cannot be safely serialized through a UTF-8 string)
      // we copy the file's raw bytes directly instead of writing a text
      // payload, which would corrupt the content.
      let sourcePath = typeof options?.sourcePath === 'string' ? options.sourcePath.trim() : ''
      if (sourcePath.startsWith('~')) {
        sourcePath = sourcePath.replace(/^~(?=\/|\\|$)/, app.getPath('home'))
      }
      const hasValidSource = sourcePath && existsSync(sourcePath) && statSync(sourcePath).isFile()
      // Anchor the dialog to the parent BrowserWindow so it shows as a sheet
      // on macOS instead of a free-floating window the user can miss.
      const parentWindow = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const dialogOptions = { defaultPath: fileName }
      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (result.canceled || !result.filePath) {
        writeAppLog('info', 'files:save', 'Save dialog cancelled')
        return { ok: false, cancelled: true as const }
      }
      if (hasValidSource) {
        copyFileSync(sourcePath, result.filePath)
        writeAppLog('info', 'files:save', 'File copied from source', { from: sourcePath, to: result.filePath })
      } else {
        writeFileSync(result.filePath, content, 'utf-8')
        writeAppLog('info', 'files:save', 'File saved', { path: result.filePath })
      }
      return { ok: true as const, path: result.filePath }
    } catch (error) {
      writeAppLog('error', 'files:save', 'files:save failed', { error: String(error) })
      return { ok: false as const, error: String((error as Error)?.message || error) }
    }
  })

  // files:saveClipboardImage — persist a pasted-image blob to a
  // per-app temp dir so the renderer can treat it like any other
  // local file (same PickedLocalFile shape, fileURL preview, engine
  // multimodal pipeline). The renderer can't write to disk directly;
  // it hands us the raw bytes + sniffed MIME.
  //
  // Files land in ~/.harnessclaw/clipboard-paste/ — left in place
  // intentionally so the user can re-attach the same image across
  // sessions; the directory is opt-in cleanup territory.
  ipcMain.handle('files:saveClipboardImage', async (
    _,
    payload: { data: Uint8Array | ArrayBuffer; mime?: string } | undefined,
  ) => {
    try {
      if (!payload || !payload.data) {
        return { ok: false as const, error: 'invalid_payload' }
      }
      const buf = Buffer.from(payload.data as Uint8Array)
      if (buf.length === 0) {
        return { ok: false as const, error: 'empty_payload' }
      }
      const MAX_BYTES = 20 * 1024 * 1024
      if (buf.length > MAX_BYTES) {
        return { ok: false as const, error: 'too_large' }
      }
      const mime = (payload.mime || 'image/png').toLowerCase()
      const extByMime: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/bmp': '.bmp',
        'image/svg+xml': '.svg',
      }
      const ext = extByMime[mime] || '.png'
      const dir = join(homedir(), '.harnessclaw', 'clipboard-paste')
      mkdirSync(dir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const rand = Math.random().toString(36).slice(2, 8)
      const fileName = `paste-${ts}-${rand}${ext}`
      const outPath = join(dir, fileName)
      writeFileSync(outPath, buf)
      const [picked] = buildPickedLocalFiles([outPath])
      if (!picked) return { ok: false as const, error: 'resolve_failed' }
      return { ok: true as const, file: picked }
    } catch (error) {
      writeAppLog('error', 'files:saveClipboardImage', 'failed', { error: String(error) })
      return { ok: false as const, error: String((error as Error)?.message || error) }
    }
  })

  ipcMain.handle('files:read', async (_, rawPath: unknown) => {
    try {
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return { ok: false, error: 'Invalid path' }
      }
      let resolved = rawPath.trim()
      if (resolved.startsWith('~')) {
        resolved = resolved.replace(/^~(?=\/|\\|$)/, app.getPath('home'))
      }
      if (!existsSync(resolved)) {
        return { ok: false, error: 'File not found', path: resolved }
      }
      const stat = statSync(resolved)
      if (!stat.isFile()) {
        return { ok: false, error: 'Not a file', path: resolved }
      }
      const MAX_BYTES = 5 * 1024 * 1024
      if (stat.size > MAX_BYTES) {
        return { ok: false, error: 'File too large to preview', path: resolved, size: stat.size }
      }
      // 二进制 Office / PDF 文件的"富预览"：mammoth / SheetJS / 自写
      // pptx 解析器 / pdf-parse 各司其职，在主进程把内容转成 HTML 或
      // 纯文本，再交给渲染端展示。`isBinary: true` 一直保留，确保导出
      // 走 copyFileSync 复制原始字节，而不是把抽出的预览文本写回去
      // 当成假 docx / xlsx。
      const ext = extname(resolved).toLowerCase()
      if (ext === '.docx' || ext === '.xlsx' || ext === '.pptx' || ext === '.pdf') {
        try {
          const rich = await buildRichPreview(ext, resolved)
          return {
            ok: true,
            path: resolved,
            content: rich.content,
            isBinary: true,
            previewKind: rich.kind,
            size: stat.size,
          }
        } catch (richErr) {
          writeAppLog('error', 'files:read', 'rich preview failed', {
            path: resolved,
            ext,
            error: String(richErr),
          })
          // 回退到二进制占位，至少导出仍可用。
          return { ok: true, path: resolved, content: '', isBinary: true, size: stat.size }
        }
      }
      // 其它二进制文件（图片 / 压缩包 / 老 .doc / .ppt / .xls 等）：返回
      // isBinary 占位，预览展示提示文案，导出走原始字节复制。
      if (isBinaryFile(resolved)) {
        return { ok: true, path: resolved, content: '', isBinary: true, size: stat.size }
      }
      const content = readFileSync(resolved, 'utf-8')
      return { ok: true, path: resolved, content, size: stat.size }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message || error) }
    }
  })

  // files:read-base64 — read a file's raw bytes and return them as
  // base64 + sniffed MIME, for multimodal user.message wire content.
  // Mirrors the engine-side caps in internal/engine/multimodal
  // (MaxBase64BlockBytes = 10MB). Whitelisted MIMEs only — SVG and
  // unknown formats are rejected at the IPC boundary so the renderer
  // doesn't need to duplicate the check.
  ipcMain.handle('files:read-base64', async (_, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return { ok: false, error: 'invalid_path', message: 'path required' }
    }
    let resolved = rawPath.trim()
    if (resolved.startsWith('~')) {
      resolved = resolved.replace(/^~(?=\/|\\|$)/, app.getPath('home'))
    }
    try {
      if (!existsSync(resolved)) {
        return { ok: false, error: 'not_found', message: 'file not found' }
      }
      const stat = statSync(resolved)
      if (!stat.isFile()) {
        return { ok: false, error: 'not_a_file', message: 'path is not a regular file' }
      }
      const MAX_BYTES = 10 * 1024 * 1024 // mirror multimodal.MaxBase64BlockBytes
      if (stat.size > MAX_BYTES) {
        return {
          ok: false,
          error: 'too_large',
          message: `file exceeds ${MAX_BYTES / 1024 / 1024}MB inline limit`,
        }
      }
      const mime = sniffMimeForBase64(resolved)
      if (!mime) {
        return {
          ok: false,
          error: 'unsupported_mime',
          message: 'only PNG / JPEG / GIF / WebP / PDF are supported for inline upload',
        }
      }
      const buf = readFileSync(resolved)
      return {
        ok: true,
        data: buf.toString('base64'),
        mime,
        size: stat.size,
      }
    } catch (error) {
      return { ok: false, error: 'read_failed', message: String((error as Error)?.message || error) }
    }
  })

  // workspace:listSession — list files in the per-session workspace dir
  // `~/.harnessclaw/workspace/session/<sessionId>` as a recursive tree.
  // Used by the chat top-bar "files" button so users can browse and
  // preview anything the agent wrote into its working directory, not
  // just declared artifacts.
  //
  // The renderer feeds individual file paths back into `files:read`
  // (existing pipeline) to render a preview in FilePreviewDrawer, so
  // this handler only returns metadata, not contents.
  ipcMain.handle('workspace:listSession', async (_, rawSessionId: unknown) => {
    try {
      if (typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
        return { ok: false, error: 'invalid_session_id' }
      }
      // Be tolerant of the legacy "harnessclaw:session:<uuid>" form even
      // though current sessions are bare UUIDs — older persisted ids may
      // still flow through.
      const sid = rawSessionId.trim().replace(/^(?:harnessclaw[:_])?session[:_]?/i, '')
      const safeSid = sid.replace(/[\\/:*?"<>|]/g, '_')
      if (!safeSid) {
        return { ok: false, error: 'invalid_session_id' }
      }
      const root = join(homedir(), '.harnessclaw', 'workspace', 'session', safeSid)
      if (!existsSync(root)) {
        return { ok: true, root, exists: false, tree: [], fileCount: 0 }
      }
      // Hard caps to keep the popover usable and to bound IPC payload
      // size if the workspace contains a runaway dir (eg. node_modules).
      const MAX_ENTRIES = 2000
      const MAX_DEPTH = 8
      let total = 0
      let fileCount = 0
      type Node = {
        name: string
        path: string
        type: 'file' | 'dir'
        size?: number
        modifiedAt?: number
        children?: Node[]
      }
      const walk = (dir: string, depth: number): Node[] => {
        if (depth > MAX_DEPTH || total >= MAX_ENTRIES) return []
        let entries: import('fs').Dirent[]
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          return []
        }
        // dirs first, then files, both alphabetical (case-insensitive)
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })
        const out: Node[] = []
        for (const entry of entries) {
          if (total >= MAX_ENTRIES) break
          // skip hidden / engine-internal scratch dirs to keep the tree readable
          if (entry.name.startsWith('.')) continue
          total += 1
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            out.push({
              name: entry.name,
              path: full,
              type: 'dir',
              children: walk(full, depth + 1),
            })
          } else if (entry.isFile()) {
            let size: number | undefined
            let modifiedAt: number | undefined
            try {
              const st = statSync(full)
              size = st.size
              modifiedAt = st.mtimeMs
            } catch {
              // ignore stat failures; still surface the entry
            }
            fileCount += 1
            out.push({
              name: entry.name,
              path: full,
              type: 'file',
              size,
              modifiedAt,
            })
          }
        }
        return out
      }
      const tree = walk(root, 0)
      return {
        ok: true,
        root,
        exists: true,
        tree,
        fileCount,
        truncated: total >= MAX_ENTRIES,
      }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message || error) }
    }
  })

  // workspace:openFolder — reveal the per-session workspace root in
  // the OS file manager (Finder / Explorer / xdg). If the directory
  // doesn't exist yet (the agent hasn't written anything), it's
  // created on the fly so the user lands somewhere sensible.
  ipcMain.handle('workspace:openFolder', async (_, rawSessionId: unknown) => {
    try {
      if (typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
        return { ok: false, error: 'invalid_session_id' }
      }
      const sid = rawSessionId.trim().replace(/^(?:harnessclaw[:_])?session[:_]?/i, '')
      const safeSid = sid.replace(/[\\/:*?"<>|]/g, '_')
      if (!safeSid) {
        return { ok: false, error: 'invalid_session_id' }
      }
      const root = join(homedir(), '.harnessclaw', 'workspace', 'session', safeSid)
      if (!existsSync(root)) {
        mkdirSync(root, { recursive: true })
      }
      const result = await shell.openPath(root)
      if (result) {
        // shell.openPath returns an error string on failure, empty string on success.
        return { ok: false, error: result, path: root }
      }
      return { ok: true, path: root }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message || error) }
    }
  })

  // artifacts:fetch — pull raw binary content for an artifact from the
  // engine over Console HTTP, write it to a per-session cache dir under
  // ~/.harnessclaw/, and return the on-disk path so the renderer can
  // reuse files:read (which already handles docx/pdf/xlsx rich preview
  // via mammoth / pdf-parse).
  //
  // Layout: ~/.harnessclaw/artifact-cache/<session_id>/<artifact_id>/<fileName>
  //
  //   - session_id bucket: artifacts from different conversations are
  //     physically isolated; clearing a session is a single rm -rf of
  //     that bucket. Falls back to "_orphan" when the renderer didn't
  //     thread session_id through (legacy / direct-link cases).
  //   - artifact_id sub-bucket: same artifact opened twice reuses the
  //     same path; the fileName preserves the .docx / .pdf extension so
  //     extension-based dispatch in files:read still works.
  //   - Co-located with the server's blob store under ~/.harnessclaw/
  //     because the client and the engine ARE on the same machine (the
  //     engine is an Electron-spawned sidecar). No need for a separate
  //     "client-cache" prefix.
  //
  // Why a fetch+temp-file path instead of streaming bytes to the renderer
  // directly: the existing preview pipeline keys on file paths
  // (FilePreviewData.path) and mammoth wants a file path or Buffer — not
  // a base64 string in IPC. Writing once on fetch keeps the renderer
  // logic untouched.
  ipcMain.handle('artifacts:fetch', async (_, rawId: unknown, rawSessionId: unknown) => {
    try {
      if (typeof rawId !== 'string' || !rawId.trim()) {
        return { ok: false, error: 'Invalid artifact id' }
      }
      const id = rawId.trim()
      // Derive a short, human-readable session bucket from the engine
      // session_id. The engine emits "harnessclaw:session:<uuid>";
      // stripping the well-known prefix yields the bare UUID which is
      // both filesystem-safe (no `:` cross-OS) and short enough that the
      // resulting path stays browsable.
      //
      // Examples:
      //   "harnessclaw:session:0c8e..."   → "0c8e..."
      //   "harnessclaw_session_0c8e..."   → "0c8e..." (legacy already-sanitised form)
      //   "session:foo"                   → "foo"
      //   "freeform-id"                   → "freeform-id"
      //   ""                              → "_orphan"
      const rawSid = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
      const stripped = rawSid.replace(/^(?:harnessclaw[:_])?session[:_]?/i, '')
      const sessionBucket =
        stripped !== ''
          ? stripped.replace(/[\\/:*?"<>|]/g, '_')
          : '_orphan'

      const res = await fetchArtifactContent(id)
      if (!res.ok) {
        return {
          ok: false,
          error: res.message || res.error || `HTTP ${res.status}`,
        }
      }
      // Flat layout: <cacheRoot>/<sessionUuid>/<fileName>
      // Skipping the per-artifact sub-bucket keeps the path browsable.
      // Same-name collisions across artifacts in the same session
      // overwrite each other; we accept that — fetch is on-demand so
      // the next click re-pulls the correct bytes.
      const cacheRoot = join(homedir(), '.harnessclaw', 'artifact-cache')
      const sidDir = join(cacheRoot, sessionBucket)
      mkdirSync(sidDir, { recursive: true })
      const fileName = res.fileName && res.fileName.trim() ? res.fileName : `${id}.bin`
      const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_')
      const outPath = join(sidDir, safeName)
      writeFileSync(outPath, res.buffer)
      return {
        ok: true,
        path: outPath,
        fileName: safeName,
        mimeType: res.mimeType,
        size: res.buffer.length,
      }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message || error) }
    }
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
          // v1.10+: server no longer streams sub-agent LLM text. Only
          // `tool_start` / `tool_end` inner events are forwarded; user-visible
          // text comes exclusively from L1 (emma) `content.delta`. Ignore any
          // legacy `text` event from older servers to avoid persisting
          // duplicated copies of emma's final reply.
          if (eventType !== 'tool_start' && eventType !== 'tool_end') break
          const persistedSubagent = createPersistedSubagent(agentId, agentName, 'running')
          const now = Date.now()

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
        case 'ask_user_question': {
          if (sid) {
            const callId = typeof event.call_id === 'string' ? event.call_id : ''
            if (!callId) break
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              const rawOptions = Array.isArray(event.options) ? event.options : []
              const options = rawOptions.flatMap((option) => {
                if (!option || typeof option !== 'object' || Array.isArray(option)) return []
                const candidate = option as { label?: unknown; description?: unknown }
                const label = typeof candidate.label === 'string' ? candidate.label : ''
                if (!label) return []
                const description = typeof candidate.description === 'string' ? candidate.description : undefined
                return [description ? { label, description } : { label }]
              })
              insertToolActivity(aid, {
                type: 'question',
                name: typeof event.tool_name === 'string' ? event.tool_name : 'AskUserQuestion',
                content: JSON.stringify({
                  question: typeof event.question === 'string' ? event.question : '',
                  options,
                  multi: event.multi === true,
                  allow_custom: event.allow_custom !== false,
                }),
                callId,
                subagent,
              })
              const state = pendingDbSegments[sid]
              if (state) state.lastToolTsByModule[getModuleKey(subagent)] = Date.now()
            }
          }
          break
        }
        case 'ask_user_question_result': {
          if (sid) {
            const callId = typeof event.call_id === 'string' ? event.call_id : ''
            if (!callId) break
            const aid = ensureDbAssistantMessage(sid, Date.now())
            if (aid) {
              const status = event.status === 'cancelled' ? 'cancelled' : 'success'
              const errorObj = isRecord(event.error) ? event.error : null
              const errorMessage = errorObj && typeof errorObj.message === 'string' ? errorObj.message : ''
              insertToolActivity(aid, {
                type: 'question_result',
                name: 'AskUserQuestion',
                content: JSON.stringify({
                  status,
                  output: typeof event.output === 'string' ? event.output : '',
                  error_message: errorMessage,
                }),
                callId,
                isError: status === 'cancelled',
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

  ipcMain.handle('harnessclaw:send', async (
    _,
    content: string,
    sessionId?: string,
    options?: {
      coordinatorMode?: 'react' | 'plan'
      planConfirmation?: 'auto' | 'required'
      images?: Array<{ mime: string; base64: string }>
    },
  ) => {
    const ok = await harnessclawClient.send(content, sessionId, options)
    if (!ok) {
      return { ok: false, error: 'Failed to send message to Harnessclaw' }
    }
    // Write user message to DB
    if (sessionId) {
      try {
        upsertSession(sessionId)
        const msgId = `usr-${Date.now()}`
        const displayContent = stripProjectContextBlock(content)
        insertMessage({ id: msgId, sessionId, role: 'user', content: displayContent, createdAt: Date.now() })
        broadcastDbSessionsChanged()
        // Use first user message as session title
        const msgs = getMessages(sessionId)
        const userMsgs = msgs.filter((m) => m.role === 'user')
        if (userMsgs.length === 1) {
          const title = displayContent.trim().replace(/\n/g, ' ')
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

  ipcMain.handle('harnessclaw:respondAskQuestion', (_, toolUseId: string, status: 'success' | 'cancelled', output?: string, errorMessage?: string) => {
    const normalizedStatus: 'success' | 'cancelled' = status === 'cancelled' ? 'cancelled' : 'success'
    writeAppLog('info', 'harnessclaw-engine.askQuestion', 'IPC respondAskQuestion received', {
      toolUseId,
      status: normalizedStatus,
      outputLength: output?.length ?? 0,
      hasErrorMessage: Boolean(errorMessage),
    })
    const ok = harnessclawClient.respondAskQuestion(toolUseId, normalizedStatus, output, errorMessage)
    if (!ok) {
      writeAppLog('warn', 'harnessclaw-engine.askQuestion', 'respondAskQuestion failed (request lost or socket not open)', {
        toolUseId,
      })
    }
    return ok ? { ok: true } : { ok: false, error: 'AskUserQuestion request not found or socket unavailable' }
  })

  ipcMain.handle('harnessclaw:respondPlan', async (
    _,
    planId: string,
    approved: boolean,
    sessionId?: string,
    options?: { steps?: Array<Record<string, unknown>>; reason?: string },
  ) => {
    const ok = await harnessclawClient.respondPlan(planId, approved, sessionId, options)
    return ok ? { ok: true } : { ok: false, error: 'Failed to send plan response' }
  })

  // v0.5.0 §7.3 — step_decision (continue / retry / cancel) reply.
  ipcMain.handle('harnessclaw:respondStepDecision', (
    _,
    requestId: string,
    decision: 'continue' | 'retry' | 'cancel',
    sessionId?: string,
    note?: string,
  ) => {
    const ok = harnessclawClient.respondStepDecision(requestId, decision, sessionId, note)
    return ok ? { ok: true } : { ok: false, error: 'Failed to send step_decision response' }
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

  // Quick-launcher IPC: renderer (LauncherPage) → main.
  // `submit` carries the typed prompt; we hide the launcher, focus the
  // main window, and forward the prompt to it via webContents.send so
  // the React shell can navigate to /chat with the message pre-filled.
  ipcMain.handle('launcher:submit', (_, prompt: unknown) => {
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.hide()
    }
    if (!text) return { ok: false, error: 'empty' }

    let target = mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null
    if (!target) {
      target = createWindow()
    }
    // Bring the main window forward; on macOS the launcher window's
    // hide() already returned focus to the previous app, so we have to
    // explicitly raise the main window again.
    if (target.isMinimized()) target.restore()
    target.show()
    target.focus()
    app.focus({ steal: true })

    const send = () => {
      if (target && !target.isDestroyed()) {
        target.webContents.send('launcher:question', text)
      }
    }
    if (target.webContents.isLoading()) {
      target.webContents.once('did-finish-load', send)
    } else {
      send()
    }
    return { ok: true }
  })

  ipcMain.handle('launcher:hide', () => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.hide()
    }
    return { ok: true }
  })

  applyLauncherConfig()

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
  globalShortcut.unregisterAll()
  harnessclawClient.disconnect()
  stopHarnessclawEngine()
  closeDb()
})
