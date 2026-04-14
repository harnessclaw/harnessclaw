import { ElectronAPI } from '@electron-toolkit/preload'

interface AppBridgeAPI {
  isFirstLaunch: () => Promise<boolean>
  markLaunched: () => Promise<{ ok: boolean; error?: string }>
  checkForUpdates: () => Promise<{ ok: boolean; version?: string; error?: string }>
  onUpdateEvent: (callback: (event: AppUpdateEvent) => void) => () => void
}

interface AppUpdateEvent {
  type:
    | 'checking'
    | 'available'
    | 'not-available'
    | 'download-started'
    | 'download-deferred'
    | 'download-progress'
    | 'downloaded'
    | 'error'
  version?: string
  releaseNotes?: unknown
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
}

interface ConfigAPI {
  read: () => Promise<Record<string, unknown>>
  save: (data: unknown) => Promise<{ ok: boolean; error?: string }>
}

interface AppRuntimeStatus {
  localService: 'starting' | 'ready' | 'degraded'
  transport: 'disconnected' | 'connecting' | 'connected'
  llmConfigured: boolean
  applyingConfig: boolean
  lastError?: string
}

type LogViewerThreshold = 'error' | 'info' | 'debug'
type LogViewerFile = 'all' | 'app' | 'renderer'
type RuntimeLogFile = 'app' | 'renderer'
type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'

interface RuntimeLogEntry {
  cursor: string
  timestamp: number
  isoTime: string
  level: RuntimeLogLevel
  source: string
  message: string
  metaText: string
  file: RuntimeLogFile
  raw: string
}

interface GetLogsOptions {
  after?: string
  level?: LogViewerThreshold
  query?: string
  file?: LogViewerFile
  limit?: number
}

interface GetLogsResult {
  items: RuntimeLogEntry[]
  cursor: string | null
  logDir: string
}

interface AppRuntimeAPI {
  getStatus: () => Promise<AppRuntimeStatus>
  getLogLevel: () => Promise<LogViewerThreshold>
  getLogs: (options?: GetLogsOptions) => Promise<GetLogsResult>
  openLogsDirectory: () => Promise<{ ok: boolean; path: string; error?: string }>
  logRenderer: (level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>) => Promise<{ ok: boolean }>
  trackUsage: (entry: {
    category: string
    action: string
    status: string
    details?: Record<string, unknown>
    sessionId?: string
  }) => Promise<{ ok: boolean }>
  exportData: (type: 'logs' | 'chat' | 'config') => Promise<{ ok: boolean; path?: string; error?: string }>
  onStatus: (callback: (status: AppRuntimeStatus) => void) => () => void
}

interface HarnessclawAPI {
  connect: () => Promise<{ ok: boolean }>
  disconnect: () => Promise<{ ok: boolean }>
  send: (content: string, sessionId?: string) => Promise<{ ok: boolean; error?: string }>
  command: (cmd: string, sessionId?: string) => Promise<{ ok: boolean }>
  stop: (sessionId?: string) => Promise<{ ok: boolean; error?: string }>
  subscribe: (sessionId: string) => Promise<{ ok: boolean }>
  unsubscribe: (sessionId: string) => Promise<{ ok: boolean }>
  listSessions: () => Promise<{ ok: boolean }>
  probe: () => Promise<{ ok: boolean }>
  respondPermission: (requestId: string, approved: boolean, scope?: 'once' | 'session', message?: string) => Promise<{ ok: boolean; error?: string }>
  getStatus: () => Promise<{ status: string; clientId: string; sessionId: string; subscriptions: string[] }>
  onStatus: (callback: (status: string) => void) => () => void
  onEvent: (callback: (event: Record<string, unknown>) => void) => () => void
}

interface SkillInfo {
  id: string
  name: string
  description: string
  allowedTools: string
  hasReferences: boolean
  hasTemplates: boolean
  source?: SkillSourceInfo
}

interface SkillSourceInfo {
  key: string
  repoId: string
  repoName: string
  repoUrl: string
  branch: string
  path: string
}

interface SkillRepository {
  id: string
  name: string
  provider: 'github'
  repoUrl: string
  owner: string
  repo: string
  branch: string
  basePath: string
  enabled: boolean
  lastDiscoveredAt?: number
  lastError?: string
}

interface DiscoveredSkill {
  key: string
  repoId: string
  repoName: string
  repoUrl: string
  owner: string
  repo: string
  branch: string
  skillPath: string
  directoryName: string
  name: string
  description: string
  allowedTools: string
  hasReferences: boolean
  hasTemplates: boolean
}

interface SkillsAPI {
  list: () => Promise<SkillInfo[]>
  read: (id: string) => Promise<string>
  delete: (id: string) => Promise<{ ok: boolean; error?: string }>
  listRepositories: () => Promise<SkillRepository[]>
  saveRepository: (input: {
    id?: string
    name?: string
    repoUrl: string
    branch?: string
    basePath?: string
    enabled?: boolean
  }) => Promise<{ ok: boolean; repo?: SkillRepository; error?: string }>
  removeRepository: (id: string) => Promise<{ ok: boolean; error?: string }>
  discover: (repositoryId?: string) => Promise<DiscoveredSkill[]>
  listDiscovered: (repositoryId?: string) => Promise<DiscoveredSkill[]>
  previewDiscovered: (repositoryId: string, skillPath: string) => Promise<string>
  installDiscovered: (repositoryId: string, skillPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>
}

interface DbSessionRow {
  session_id: string
  title: string
  created_at: number
  updated_at: number
}

interface DbToolActivityRow {
  id: number
  message_id: string
  type: string
  name: string | null
  content: string
  call_id: string | null
  is_error: number
  subagent_json: string | null
  created_at: number
}

interface DbMessageRow {
  id: string
  session_id: string
  role: string
  content: string
  content_segments: string | null
  thinking: string | null
  tools_used: string | null
  usage_prompt: number | null
  usage_completion: number | null
  usage_total: number | null
  created_at: number
  tools: DbToolActivityRow[]
}

interface DbAPI {
  listSessions: () => Promise<DbSessionRow[]>
  getMessages: (sessionId: string) => Promise<DbMessageRow[]>
  deleteSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>
}

interface PickedLocalFile {
  name: string
  path: string
  url: string
  size: number
  extension: string
  kind: 'image' | 'video' | 'audio' | 'archive' | 'code' | 'document' | 'data' | 'other'
}

interface FilesAPI {
  pick: () => Promise<PickedLocalFile[]>
  resolve: (paths: string[]) => Promise<PickedLocalFile[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: object
    appBridge: AppBridgeAPI
    engineConfig: ConfigAPI
    config: ConfigAPI
    nanobotConfig: ConfigAPI
    appConfig: ConfigAPI
    appRuntime: AppRuntimeAPI
    harnessclaw: HarnessclawAPI
    skills: SkillsAPI
    db: DbAPI
    files: FilesAPI
  }
}
