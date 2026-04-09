import { ElectronAPI } from '@electron-toolkit/preload'

interface AppBridgeAPI {
  isFirstLaunch: () => Promise<boolean>
  markLaunched: () => Promise<{ ok: boolean; error?: string }>
}

interface ConfigAPI {
  read: () => Promise<Record<string, unknown>>
  save: (data: unknown) => Promise<{ ok: boolean; error?: string }>
}

interface ClawHubAPI {
  getStatus: () => Promise<{ installed: boolean; path: string }>
  install: () => Promise<{ ok: boolean; path: string; error?: string }>
  verifyToken: (token: string) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>
  explore: () => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>
  search: (query: string) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>
  installSkill: (slug: string) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>
}

interface HarnessclawAPI {
  connect: () => Promise<{ ok: boolean }>
  disconnect: () => Promise<{ ok: boolean }>
  send: (content: string, sessionId?: string) => Promise<{ ok: boolean }>
  command: (cmd: string, sessionId?: string) => Promise<{ ok: boolean }>
  stop: (sessionId?: string) => Promise<{ ok: boolean }>
  subscribe: (sessionId: string) => Promise<{ ok: boolean }>
  unsubscribe: (sessionId: string) => Promise<{ ok: boolean }>
  listSessions: () => Promise<{ ok: boolean }>
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
}

interface SkillsAPI {
  list: () => Promise<SkillInfo[]>
  read: (id: string) => Promise<string>
  delete: (id: string) => Promise<{ ok: boolean; error?: string }>
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

type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip'
type DoctorStage = 'environment' | 'config' | 'runtime' | 'flow'

interface DoctorCheckResult {
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

interface DoctorRunResult {
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

interface DoctorFixResult {
  ok: boolean
  message: string
}

interface DoctorAPI {
  run: () => Promise<DoctorRunResult>
  fix: (checkId: string) => Promise<DoctorFixResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: object
    appBridge: AppBridgeAPI
    config: ConfigAPI
    nanobotConfig: ConfigAPI
    appConfig: ConfigAPI
    clawhub: ClawHubAPI
    harnessclaw: HarnessclawAPI
    skills: SkillsAPI
    db: DbAPI
    files: FilesAPI
    doctor: DoctorAPI
  }
}
