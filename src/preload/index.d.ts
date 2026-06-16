import { ElectronAPI } from '@electron-toolkit/preload'

interface AppBridgeAPI {
  isFirstLaunch: () => Promise<boolean>
  markLaunched: () => Promise<{ ok: boolean; error?: string }>
  getVersion: () => Promise<string>
  getUsername: () => string
  checkForUpdates: () => Promise<{ ok: boolean; version?: string; error?: string }>
  onUpdateEvent: (callback: (event: AppUpdateEvent) => void) => () => void
  downloadUpdate: () => Promise<{ ok: boolean }>
  quitAndInstall: () => Promise<void>
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
  openDatabaseLocation: (path?: string) => Promise<{ ok: boolean; path: string; error?: string }>
  logRenderer: (level: RuntimeLogLevel, message: string, details?: Record<string, unknown>) => Promise<{ ok: boolean }>
  trackUsage: (entry: {
    category: string
    action: string
    status: string
    details?: Record<string, unknown>
    sessionId?: string
  }) => Promise<{ ok: boolean }>
  telemetry: {
    track: (input: {
      category: string
      action: string
      properties?: Record<string, unknown>
    }) => Promise<{ ok: boolean }>
    getConfig: () => Promise<{
      ok: boolean
      config?: {
        endpoint: string
        enabled: boolean
        consented: boolean
      }
      error?: string
    }>
    setEnabled: (enabled: boolean) => Promise<{
      ok: boolean
      config?: { endpoint: string; enabled: boolean; consented: boolean }
      error?: string
    }>
    setConsented: (consented: boolean) => Promise<{ ok: boolean; error?: string }>
  }
  exportData: (type: 'logs' | 'chat' | 'config') => Promise<{ ok: boolean; path?: string; error?: string }>
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
  onStatus: (callback: (status: AppRuntimeStatus) => void) => () => void
}

interface HarnessclawAPI {
  connect: () => Promise<{ ok: boolean }>
  disconnect: () => Promise<{ ok: boolean }>
  send: (
    content: string,
    sessionId?: string,
    options?: {
      coordinatorMode?: 'react' | 'plan'
      planConfirmation?: 'auto' | 'required'
      // images are forwarded into user.message.content as
      // {type:'image',source:{type:'base64',media_type,data}} blocks.
      // Use window.files.readBase64() to obtain the {mime,base64} pair.
      images?: Array<{ mime: string; base64: string }>
    },
  ) => Promise<{ ok: boolean; error?: string }>
  command: (cmd: string, sessionId?: string) => Promise<{ ok: boolean }>
  stop: (sessionId?: string) => Promise<{ ok: boolean; error?: string }>
  subscribe: (sessionId: string) => Promise<{ ok: boolean }>
  unsubscribe: (sessionId: string) => Promise<{ ok: boolean }>
  listSessions: () => Promise<{ ok: boolean }>
  probe: () => Promise<{ ok: boolean }>
  respondPermission: (requestId: string, approved: boolean, scope?: 'once' | 'session', message?: string) => Promise<{ ok: boolean; error?: string }>
  respondAskQuestion: (toolUseId: string, status: 'success' | 'cancelled', output?: string, errorMessage?: string) => Promise<{ ok: boolean; error?: string }>
  respondPlan: (planId: string, approved: boolean, sessionId?: string, options?: { steps?: Array<Record<string, unknown>>; reason?: string }) => Promise<{ ok: boolean; error?: string }>
  respondStepDecision: (requestId: string, decision: 'continue' | 'retry' | 'cancel', sessionId?: string, note?: string) => Promise<{ ok: boolean; error?: string }>
  getStatus: () => Promise<{ status: string; clientId: string; sessionId: string; subscriptions: string[] }>
  onStatus: (callback: (status: string) => void) => () => void
  onEvent: (callback: (event: Record<string, unknown>) => void) => () => void
}

interface BrowserAgentTabInfo {
  tab_id: string
  title: string
  url: string
  active: boolean
}

interface BrowserAgentSessionInfo {
  session_id: string
  window_id: string
  visible: boolean
  last_used_turn_id?: string
  active_tab?: BrowserAgentTabInfo
  tabs?: BrowserAgentTabInfo[]
  closed?: boolean
}

interface BrowserAgentAPI {
  listSessions: () => Promise<{ ok: boolean; sessions?: BrowserAgentSessionInfo[]; error?: string }>
  setVisibility: (sessionId: string, visible: boolean) => Promise<{ ok: boolean; session?: BrowserAgentSessionInfo; error?: string }>
  closeAll: () => Promise<{ ok: boolean; error?: string }>
  closeSessions: (sessionIds: string[]) => Promise<{
    ok: boolean
    result?: { closed_session_ids: string[]; missing_session_ids: string[] }
    error?: string
  }>
  onSessionChanged: (callback: (session: BrowserAgentSessionInfo) => void) => () => void
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
  read: (path: string) => Promise<{ ok: boolean; content?: string; path?: string; size?: number; isBinary?: boolean; previewKind?: 'html' | 'text'; error?: string }>
  // readBase64 reads a whitelisted media file (PNG/JPEG/GIF/WebP/PDF
  // only) and returns its bytes as base64 + sniffed MIME. Used to
  // build multimodal user.message.content image blocks. Errors:
  //   - 'too_large'        size > 10 MB (mirror of multimodal.MaxBase64BlockBytes)
  //   - 'unsupported_mime' extension outside the whitelist (incl. SVG)
  //   - 'not_found' | 'not_a_file' | 'invalid_path' | 'read_failed'
  readBase64: (path: string) => Promise<
    | { ok: true; data: string; mime: string; size: number }
    | { ok: false; error: string; message: string }
  >
  save: (options: { defaultFileName?: string; content?: string; sourcePath?: string }) =>
    Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
  // saveClipboardImage writes a pasted-image blob to ~/.harnessclaw/
  // clipboard-paste/ and returns the resolved PickedLocalFile so the
  // renderer can attach it like any drag/drop file. Errors:
  //   - 'invalid_payload' | 'empty_payload'
  //   - 'too_large'      size > 20 MB
  //   - 'resolve_failed' written but stat failed
  saveClipboardImage: (data: ArrayBuffer, mime: string) => Promise<
    | { ok: true; file: PickedLocalFile }
    | { ok: false; error: string }
  >
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

// Session Metrics API — see harnessclaw-engine/docs/api/session-metrics-api.md.
interface SessionMetricsContextWindow {
  used: number
  limit: number
  history: number
  tool_results: number
  system_prompt: number
}

interface SessionMetricsPerModel {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  thinking_tokens: number
  llm_calls: number
}

interface SessionMetricsSubAgent {
  agent_run_id: string
  agent_id: string
  agent_type: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  thinking_tokens: number
  total_tokens: number
  llm_calls: number
  duration_ms: number
  status: string
}

interface SessionMetricsStats {
  session_id: string
  updated_at: string
  input_tokens: number
  output_tokens: number
  latency_ms_total: number
  latency_ms_avg: number
  cache_read_tokens: number
  cache_write_tokens: number
  cache_hit_rate: number
  thinking_tokens: number
  thinking_share: number
  context_window: SessionMetricsContextWindow
  per_model: SessionMetricsPerModel[]
  subagents: SessionMetricsSubAgent[]
  llm_calls: number
  tool_calls: number
}

type SessionMetricsResult =
  | { ok: true; data: SessionMetricsStats }
  | { ok: false; status: number; error: string; message?: string }

// Model Registry API — see harnessclaw-engine/docs/api/models-registry-api.md.
interface RegistryModelSupports {
  vision?: boolean
  pdf_input?: boolean
  audio_input?: boolean
  audio_output?: boolean
  video_input?: boolean
  image_generation?: boolean
  streaming?: boolean
  function_calling?: boolean
  parallel_function_calling?: boolean
  tool_choice?: boolean
  computer_use?: boolean
  reasoning?: boolean
  reasoning_can_disable?: boolean
  reasoning_effort_levels?: string[]
  web_search?: boolean
  prompt_caching?: boolean
  explicit_cache_control?: boolean
  [key: string]: unknown
}

interface RegistryModelLimits {
  context_window?: number
  max_input_tokens?: number
  max_output_tokens?: number
  max_reasoning_tokens?: number | null
}

interface RegistryModelDefaults {
  temperature?: number
  top_p?: number
  max_output_tokens_default?: number
  [key: string]: unknown
}

interface RegistryModel {
  id: string
  provider: string
  model_id: string
  display_name?: string
  family?: string
  generation?: string
  knowledge_cutoff?: string
  modalities?: { input?: string[]; output?: string[] }
  supports?: RegistryModelSupports
  limits?: RegistryModelLimits
  defaults?: RegistryModelDefaults
}

type RegistryModelsResult =
  | { ok: true; data: RegistryModel[] }
  | { ok: false; status: number; error: string; message?: string }

interface ProviderModelsFetchPayload {
  provider: string
  type: ProviderType
  baseUrl?: string | null
  apiKey?: string
}

interface AgentCapabilitiesData {
  model_key: string
  supports: RegistryModelSupports
  capabilities: string[]
}

type AgentCapabilitiesResult =
  | { ok: true; data: AgentCapabilitiesData }
  | { ok: false; status: number; error: string; message?: string }

type ProviderType = 'openai' | 'anthropic' | 'gemini'

interface ProviderEndpointInfo {
  name: string
  model: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  // Engine 2026-05-14+: when true the endpoint stays in chain but the
  // dispatcher skips it (no auto-recovery). Used as the canonical
  // enable/disable flag instead of DELETE-then-recreate.
  disabled?: boolean
  in_chain: boolean
  // Engine 2026-05-19+: per-endpoint capability override tokens.
  model_type?: string[]
  // Engine 2026-05-30+: optional display-only tag persisted on the
  // endpoint. Empty/absent = ungrouped (renderer falls back to
  // getModelGroup(id) heuristic).
  group?: string
  // Full image generation target URL resolved by the engine registry.
  image_generation_url?: string
}

interface ProviderInfo {
  name: string
  type: ProviderType
  base_url: string
  api_key: string
  // Engine 2026-05-14+: true = whole provider paused, dispatcher
  // skips every endpoint under it regardless of per-endpoint state.
  disabled?: boolean
  endpoints: ProviderEndpointInfo[]
}

interface ProviderChainEntry {
  index: number
  name: string
  provider: string
  endpoint: string
  state: 'healthy' | 'tripped' | 'ready_to_probe'
  // Engine 2026-05-14+: GET /agent entries include this flag.
  // Effective disabled = provider.disabled OR endpoint.disabled.
  // Orthogonal to `state` — dispatcher skips any disabled entry.
  disabled?: boolean
  tripped_until?: string
  cooldown_seconds: number
  consecutive_failures: number
}

// Flat-chain shape the renderer's drag list still uses. The main
// process adapts it on the fly from /api/v1/agent's
// `{primary, fallback_chain}` split.
interface ProviderChain {
  chain: string[]
  entries: ProviderChainEntry[]
}

interface ProviderCreatePayload {
  name: string
  type: ProviderType
  base_url?: string
  api_key?: string
  disabled?: boolean
}

interface ProviderPatchPayload {
  type?: ProviderType
  api_key?: string
  base_url?: string
  disabled?: boolean
}

interface EndpointCreatePayload {
  name: string
  model: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  disabled?: boolean
  // Engine 2026-05-30+: optional display-only tag. Free text.
  group?: string
}

interface EndpointPatchPayload {
  model?: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  disabled?: boolean
  // Engine 2026-05-19+: per-endpoint capability override. [] clears it.
  // Allowed tokens include image_generation for image tool models.
  model_type?: string[]
  // Engine 2026-05-30+: free-text display tag. Sending `""` explicitly
  // clears it (yaml key removed); omitting leaves it unchanged.
  group?: string
}

// Engine 2026-05-14+ top-level `agent` block. The full payload of
// GET /api/v1/agent. `entries[]` covers `[primary, ...fallback_chain]`
// in order. Tuning fields apply at agent-scope and are baked into
// adapter defaults on PATCH (see API doc "调用参数生效规则").
interface AgentConfigInfo {
  primary: string
  fallback_chain: string[]
  image_generation?: string
  max_tokens?: number
  // Canonical range [0, 1]; engine rescales per provider type
  // (anthropic ×1, openai/gemini ×2). 0 means "fall back to endpoint
  // self-Temperature in native range".
  temperature?: number
  context_window?: number
  entries: ProviderChainEntry[]
}

// PATCH body. Any subset; omitted = unchanged. `fallback_chain: []`
// explicitly clears the chain (≠ omitted).
interface AgentPatchPayload {
  primary?: string
  fallback_chain?: string[]
  image_generation?: string
  // Engine 2026-06+: canonical `provider:endpoint` ref for the video
  // generation tool target (e.g. `doubao:seedance-lite-i2v`). Omitted =
  // unchanged.
  video_generation?: string
  max_tokens?: number
  temperature?: number
  context_window?: number
}

// Video Generation Management API — GET|PATCH /api/v1/videogen. Mirrors
// the providers management types but scoped to the `videogen` config
// tree (credentials + per-endpoint model bindings).
interface VideoEndpointInfo {
  model: string
}
interface VideoProviderListing {
  api_key: string
  base_url: string
  endpoints: Record<string, VideoEndpointInfo>
}
interface VideoGenListing {
  config_source: string
  providers: Record<string, VideoProviderListing>
}
interface VideoGenPatchPayload {
  providers: Record<
    string,
    {
      api_key?: string
      base_url?: string
      endpoints?: Record<string, { model: string }>
    }
  >
}

// Image Generation Management API — GET|PATCH /api/v1/imagegen. Mirrors
// the videogen management types but scoped to the `imagegen` config tree
// (credentials + path + per-endpoint model bindings).
interface ImageEndpoint {
  model: string
}
interface ImageProviderListing {
  api_key: string
  base_url: string
  path: string
  endpoints: Record<string, ImageEndpoint>
}
interface ImageGenListing {
  config_source: string
  providers: Record<string, ImageProviderListing>
}
interface ImageGenPatch {
  providers: Record<
    string,
    {
      api_key?: string
      base_url?: string
      path?: string
      endpoints?: Record<string, { model: string }>
    }
  >
}

type ProvidersResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message?: string }

// Tools Management API — see harnessclaw-engine/docs/api/tools-management-api.md.
//
// The wire response uses `{code,data}` envelopes; main/console-api.ts
// unwraps that and surfaces `{ ok: true, data }` / `{ ok: false, error,
// message }` to the renderer.
//
// These types are intentionally `interface` / `type` without `export`
// so they participate in the global ambient declaration like the rest
// of the `*Result` aliases above (renderer code references them via
// the bare name).
interface ToolEntry {
  name: string
  registered_name: string
  enabled: boolean
  /** True iff yaml `enabled=true` AND every credential field is non-empty. */
  effective: boolean
  config: Record<string, unknown>
  /** Names within `config` that should be rendered as password fields. */
  credential_fields: string[]
}

type ToolsResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message?: string }

interface ToolPatchPayload {
  enabled?: boolean
  /** Partial map keyed by yaml field name (e.g. `api_key`, not `APIKey`). */
  config?: Record<string, unknown>
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
  getSessionMetrics: (sessionId: string) => Promise<SessionMetricsResult>
  listRegistryModels: () => Promise<RegistryModelsResult>
  listProviderModels: (payload: ProviderModelsFetchPayload) => Promise<RegistryModelsResult>
  /** GET /api/v1/agent/capabilities — resolved (override-aware) supports + capability buckets. */
  getAgentCapabilities: () => Promise<AgentCapabilitiesResult>
  /** GET /api/v1/tools — list every hot-editable tool with its current config. */
  listTools: () => Promise<ToolsResult<{ tools: ToolEntry[] }>>
  /** GET /api/v1/tools/{name}. Resolves with `error: 'not_found'` for unknown names. */
  getTool: (name: string) => Promise<ToolsResult<ToolEntry>>
  /**
   * PATCH /api/v1/tools/{name}. Partial update — omitted fields keep
   * their current value. Known errors: `bad_request`, `invalid_config`,
   * `not_found`, `hot_reload_failed`, `persist_failed`, `registry_missing`.
   */
  patchTool: (
    name: string,
    patch: ToolPatchPayload,
  ) => Promise<ToolsResult<ToolEntry>>
  listProviders: () => Promise<ProvidersResult<{ providers: ProviderInfo[] }>>
  createProvider: (
    payload: ProviderCreatePayload,
  ) => Promise<ProvidersResult<{ providers: ProviderInfo[] }>>
  getFallbackChain: () => Promise<ProvidersResult<ProviderChain>>
  updateFallbackChain: (chain: string[]) => Promise<ProvidersResult<ProviderChain>>
  getAgentConfig: () => Promise<ProvidersResult<AgentConfigInfo>>
  patchAgentConfig: (
    patch: AgentPatchPayload,
  ) => Promise<ProvidersResult<AgentConfigInfo>>
  /** GET /api/v1/videogen — videogen providers + per-endpoint model bindings. */
  listVideoProviders: () => Promise<ProvidersResult<VideoGenListing>>
  /** PATCH /api/v1/videogen — partial update; omitted fields unchanged. */
  patchVideoConfig: (
    patch: VideoGenPatchPayload,
  ) => Promise<ProvidersResult<VideoGenListing>>
  /** GET /api/v1/imagegen — imagegen providers + per-endpoint model bindings. */
  listImageProviders: () => Promise<ProvidersResult<ImageGenListing>>
  /** PATCH /api/v1/imagegen — partial update; omitted fields unchanged. */
  patchImageConfig: (
    patch: ImageGenPatch,
  ) => Promise<ProvidersResult<ImageGenListing>>
  patchProvider: (
    name: string,
    patch: ProviderPatchPayload,
  ) => Promise<ProvidersResult<{ providers: ProviderInfo[] }>>
  listEndpoints: (
    providerName: string,
  ) => Promise<ProvidersResult<{ endpoints: ProviderEndpointInfo[] }>>
  createEndpoint: (
    providerName: string,
    payload: EndpointCreatePayload,
  ) => Promise<ProvidersResult<ProviderEndpointInfo>>
  patchEndpoint: (
    providerName: string,
    endpointName: string,
    patch: EndpointPatchPayload,
  ) => Promise<ProvidersResult<ProviderEndpointInfo>>
  deleteEndpoint: (
    providerName: string,
    endpointName: string,
  ) => Promise<ProvidersResult<void>>
}

// Quick-launcher (Alfred-style) bridge — see `launcherAPI` in preload/index.ts.
export interface LauncherAPI {
  /** Ship the typed prompt to main; main hides the launcher, focuses
   *  the main window, and forwards the prompt to the React shell. */
  submit: (prompt: string) => Promise<{ ok: boolean; error?: string }>
  /** Hide the launcher (used on Escape). */
  hide: () => Promise<{ ok: boolean }>
  /** Subscribe to prompts pushed from the launcher window. Returns
   *  an unsubscribe function. Used by the main renderer's <App />. */
  onQuestion: (callback: (prompt: string) => void) => () => void
  /** Subscribe to "launcher re-shown" pings so the launcher renderer
   *  can clear its previous input. Returns an unsubscribe function. */
  onReset: (callback: () => void) => () => void
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
    browserAgent: BrowserAgentAPI
    skills: SkillsAPI
    db: DbAPI
    files: FilesAPI
    artifacts: ArtifactsAPI
    workspace: WorkspaceAPI
    agentApi: AgentApiInterface
    launcherApi: LauncherAPI
  }
}

// WorkspaceAPI lists the on-disk per-session working directory
// (`~/.harnessclaw/workspace/session/<sid>`) as a recursive tree.
// The renderer feeds returned file paths back into window.files.read
// to render previews in FilePreviewDrawer.
interface WorkspaceFileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  modifiedAt?: number
  children?: WorkspaceFileNode[]
}
interface WorkspaceAPI {
  listSession: (sessionId: string) => Promise<
    | { ok: true; root: string; exists: boolean; tree: WorkspaceFileNode[]; fileCount: number; truncated?: boolean }
    | { ok: false; error: string }
  >
  openFolder: (sessionId: string) => Promise<
    | { ok: true; path: string }
    | { ok: false; error: string; path?: string }
  >
}

// ArtifactsAPI bridges the renderer to artifacts:fetch (main process
// downloads bytes via Console HTTP and writes them to a per-session
// cache dir under ~/.harnessclaw/artifact-cache/<session>/<id>/<name>
// so the existing files:read pipeline can rich-preview them).
//
// sessionId is optional — omit it for direct-link / cross-session
// opens; the file lands under the "_orphan" bucket in that case.
interface ArtifactsAPI {
  fetch: (
    artifactId: string,
    sessionId?: string,
  ) => Promise<
    | { ok: true; path: string; fileName: string; mimeType?: string; size: number }
    | { ok: false; error: string }
  >
}
