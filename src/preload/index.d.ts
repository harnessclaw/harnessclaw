import { ElectronAPI } from '@electron-toolkit/preload'

interface AppBridgeAPI {
  isFirstLaunch: () => Promise<boolean>
  markLaunched: () => Promise<{ ok: boolean; error?: string }>
  getVersion: () => Promise<string>
  getUsername: () => string
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

type LogViewerThreshold = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type LogViewerFile = 'all' | 'harnessclaw'
type RuntimeLogFile = 'harnessclaw'
type RuntimeLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

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
  logRenderer: (level: RuntimeLogLevel, message: string, details?: Record<string, unknown>) => Promise<{ ok: boolean }>
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
  proxy: SkillRepositoryProxy
  enabled: boolean
  lastDiscoveredAt?: number
  lastError?: string
}

interface SkillRepositoryProxy {
  enabled: boolean
  protocol: 'http' | 'https' | 'socks5'
  host: string
  port: string
}

interface SkillDiscoveryEvent {
  type: 'started' | 'finished' | 'failed'
  taskId: string
  repositoryId?: string
  repositoryCount?: number
  successCount?: number
  errorCount?: number
  skillCount?: number
  error?: string
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
    proxy?: Partial<SkillRepositoryProxy>
    enabled?: boolean
  }) => Promise<{ ok: boolean; repo?: SkillRepository; error?: string }>
  removeRepository: (id: string) => Promise<{ ok: boolean; error?: string }>
  discover: (repositoryId?: string) => Promise<{ ok: boolean; started: boolean; taskId?: string; error?: string }>
  listDiscovered: (repositoryId?: string) => Promise<DiscoveredSkill[]>
  previewDiscovered: (repositoryId: string, skillPath: string) => Promise<string>
  installDiscovered: (repositoryId: string, skillPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>
  onDiscoveryEvent: (callback: (event: SkillDiscoveryEvent) => void) => () => void
}

interface DbSessionRow {
  session_id: string
  title: string
  project_id: string | null
  project_context_json: string | null
  created_at: number
  updated_at: number
}

interface DbProjectRow {
  project_id: string
  name: string
  description: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

interface DbToolActivityRow {
  id: number
  message_id: string
  type: string
  name: string | null
  content: string
  call_id: string | null
  is_error: number
  duration_ms: number | null
  render_hint: string | null
  language: string | null
  file_path: string | null
  metadata_json: string | null
  subagent_json: string | null
  created_at: number
}

interface DbMessageRow {
  id: string
  session_id: string
  role: string
  content: string
  system_notice_json: string | null
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
  createSession: (sessionId: string, title?: string) => Promise<{ ok: boolean; error?: string }>
  createProjectSession: (input: { sessionId: string; projectId: string; title?: string }) => Promise<{ ok: boolean; error?: string }>
  listSessions: () => Promise<DbSessionRow[]>
  getMessages: (sessionId: string) => Promise<DbMessageRow[]>
  deleteSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>
  updateSessionTitle: (sessionId: string, title: string) => Promise<{ ok: boolean; error?: string }>
  updateSessionProject: (sessionId: string, projectId: string | null) => Promise<{ ok: boolean; error?: string }>
  listProjects: () => Promise<DbProjectRow[]>
  getProject: (projectId: string) => Promise<DbProjectRow | null>
  createProject: (input: { projectId: string; name: string; description?: string }) => Promise<{ ok: boolean; project?: DbProjectRow; error?: string }>
  deleteProject: (projectId: string) => Promise<{ ok: boolean; deletedSessions?: number; error?: string }>
  listProjectSessions: (projectId: string) => Promise<DbSessionRow[]>
  onSessionsChanged: (callback: () => void) => () => void
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
  read: (path: string) => Promise<{ ok: boolean; content?: string; path?: string; size?: number; error?: string }>
}

interface ConsoleAgentDefinition {
  name: string
  display_name?: string
  description?: string
  agent_type?: string
  profile?: string
  system_prompt?: string
  model?: string
  max_turns?: number
  auto_team?: boolean
  tools?: string[]
  allowed_tools?: string[]
  disallowed_tools?: string[]
  skills?: string[]
  sub_agents?: Array<{ name: string; role?: string; agent_type?: string; profile?: string }>
  source?: string
}

interface ConsoleResponse<T = unknown> {
  code: string
  data?: T
  total?: number
  message?: string
}

interface AgentApiInterface {
  listAgents: (params?: { agent_type?: string; source?: string; limit?: number; offset?: number }) => Promise<ConsoleResponse<ConsoleAgentDefinition[]>>
  getAgent: (name: string) => Promise<ConsoleResponse<ConsoleAgentDefinition>>
  createAgent: (agent: Record<string, unknown>) => Promise<ConsoleResponse<ConsoleAgentDefinition>>
  updateAgent: (name: string, fields: Record<string, unknown>) => Promise<ConsoleResponse<ConsoleAgentDefinition>>
  deleteAgent: (name: string) => Promise<ConsoleResponse>
  probe: (port?: number) => Promise<{ ok: boolean; error?: string }>
  setPort: (port: number) => Promise<{ ok: boolean; port: number }>
  getPort: () => Promise<{ port: number }>
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
    agentApi: AgentApiInterface
  }
}
