import { ElectronAPI } from '@electron-toolkit/preload'

interface AppBridgeAPI {
  isFirstLaunch: () => Promise<boolean>
  markLaunched: () => Promise<{ ok: boolean; error?: string }>
  checkForUpdates: () => Promise<{ ok: boolean; version?: string; error?: string }>
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

declare global {
  interface Window {
    electron: ElectronAPI
    api: object
    appBridge: AppBridgeAPI
    engineConfig: ConfigAPI
    config: ConfigAPI
    nanobotConfig: ConfigAPI
    appConfig: ConfigAPI
    clawhub: ClawHubAPI
    harnessclaw: HarnessclawAPI
    skills: SkillsAPI
    db: DbAPI
  }
}
