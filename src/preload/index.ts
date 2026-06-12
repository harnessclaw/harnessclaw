import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import os from 'node:os'

// Custom APIs for renderer
const api = {}

const appAPI = {
  isFirstLaunch: () => ipcRenderer.invoke('app:isFirstLaunch'),
  markLaunched: () => ipcRenderer.invoke('app:markLaunched'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getUsername: (): string => {
    try {
      return os.userInfo().username || process.env.USER || process.env.USERNAME || ''
    } catch {
      return process.env.USER || process.env.USERNAME || ''
    }
  },
  checkForUpdates: () => ipcRenderer.invoke('app:update:check'),
  onUpdateEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: Record<string, unknown>): void => callback(event)
    ipcRenderer.on('app:update-event', handler)
    return () => ipcRenderer.removeListener('app:update-event', handler)
  },
  downloadUpdate: () => ipcRenderer.invoke('app:update:download'),
  quitAndInstall: () => ipcRenderer.invoke('app:update:install'),
}

const configAPI = {
  read: () => ipcRenderer.invoke('config:read'),
  save: (data: unknown) => ipcRenderer.invoke('config:save', data),
}

const appConfigAPI = {
  read: () => ipcRenderer.invoke('app-config:read'),
  save: (data: unknown) => ipcRenderer.invoke('app-config:save', data),
}

const appRuntimeAPI = {
  getStatus: () => ipcRenderer.invoke('app-runtime:getStatus'),
  getLogLevel: () => ipcRenderer.invoke('app-runtime:getLogLevel'),
  getLogs: (options?: {
    after?: string
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    query?: string
    file?: 'all' | 'harnessclaw'
    limit?: number
  }) => ipcRenderer.invoke('app-runtime:getLogs', options),
  openLogsDirectory: () => ipcRenderer.invoke('app-runtime:openLogsDirectory'),
  openDatabaseLocation: (path?: string) => ipcRenderer.invoke('app-runtime:openDatabaseLocation', path),
  logRenderer: (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: string, details?: Record<string, unknown>) =>
    ipcRenderer.invoke('app-runtime:logRenderer', level, message, details),
  trackUsage: (entry: {
    category: string
    action: string
    status: string
    details?: Record<string, unknown>
    sessionId?: string
  }) => ipcRenderer.invoke('app-runtime:trackUsage', entry),
  telemetry: {
    track: (input: {
      category: string
      action: string
      properties?: Record<string, unknown>
    }) => ipcRenderer.invoke('telemetry:track', input),
    getConfig: () => ipcRenderer.invoke('telemetry:getConfig'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:setEnabled', enabled),
    setConsented: (consented: boolean) => ipcRenderer.invoke('telemetry:setConsented', consented),
  },
  exportData: (type: 'logs' | 'chat' | 'config') => ipcRenderer.invoke('app-runtime:exportData', type),
  openExternal: (url: string) => ipcRenderer.invoke('app-runtime:openExternal', url),
  onStatus: (callback: (status: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: Record<string, unknown>): void => callback(status)
    ipcRenderer.on('app-runtime:status', handler)
    return () => ipcRenderer.removeListener('app-runtime:status', handler)
  },
}

const harnessclawAPI = {
  connect: () => ipcRenderer.invoke('harnessclaw:connect'),
  disconnect: () => ipcRenderer.invoke('harnessclaw:disconnect'),
  send: (
    content: string,
    sessionId?: string,
    options?: {
      coordinatorMode?: 'react' | 'plan'
      planConfirmation?: 'auto' | 'required'
      images?: Array<{ mime: string; base64: string }>
    },
  ) => ipcRenderer.invoke('harnessclaw:send', content, sessionId, options),
  command: (cmd: string, sessionId?: string) => ipcRenderer.invoke('harnessclaw:command', cmd, sessionId),
  stop: (sessionId?: string) => ipcRenderer.invoke('harnessclaw:stop', sessionId),
  subscribe: (sessionId: string) => ipcRenderer.invoke('harnessclaw:subscribe', sessionId),
  unsubscribe: (sessionId: string) => ipcRenderer.invoke('harnessclaw:unsubscribe', sessionId),
  listSessions: () => ipcRenderer.invoke('harnessclaw:listSessions'),
  probe: () => ipcRenderer.invoke('harnessclaw:probe'),
  respondPermission: (requestId: string, approved: boolean, scope?: 'once' | 'session', message?: string) => ipcRenderer.invoke('harnessclaw:respondPermission', requestId, approved, scope, message),
  respondAskQuestion: (toolUseId: string, status: 'success' | 'cancelled', output?: string, errorMessage?: string) => ipcRenderer.invoke('harnessclaw:respondAskQuestion', toolUseId, status, output, errorMessage),
  respondPlan: (planId: string, approved: boolean, sessionId?: string, options?: { steps?: Array<Record<string, unknown>>; reason?: string }) => ipcRenderer.invoke('harnessclaw:respondPlan', planId, approved, sessionId, options),
  // v0.5.0 §7.3 — step_decision reply (continue / retry / cancel).
  respondStepDecision: (requestId: string, decision: 'continue' | 'retry' | 'cancel', sessionId?: string, note?: string) => ipcRenderer.invoke('harnessclaw:respondStepDecision', requestId, decision, sessionId, note),
  getStatus: () => ipcRenderer.invoke('harnessclaw:status'),
  onStatus: (callback: (status: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: string): void => callback(status)
    ipcRenderer.on('harnessclaw:status', handler)
    return () => ipcRenderer.removeListener('harnessclaw:status', handler)
  },
  onEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: Record<string, unknown>): void => callback(event)
    ipcRenderer.on('harnessclaw:event', handler)
    return () => ipcRenderer.removeListener('harnessclaw:event', handler)
  },
}

const browserAgentAPI = {
  listSessions: () => ipcRenderer.invoke('browser-agent:listSessions'),
  setVisibility: (sessionId: string, visible: boolean) =>
    ipcRenderer.invoke('browser-agent:setVisibility', { session_id: sessionId, visible }),
  closeAll: () => ipcRenderer.invoke('browser-agent:closeAll'),
  closeSessions: (sessionIds: string[]) => ipcRenderer.invoke('browser-agent:closeSessions', { session_ids: sessionIds }),
  onSessionChanged: (callback: (session: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, session: Record<string, unknown>): void => callback(session)
    ipcRenderer.on('browser-agent:session-changed', handler)
    return () => ipcRenderer.removeListener('browser-agent:session-changed', handler)
  },
}

const skillsAPI = {
  list: () => ipcRenderer.invoke('skills:list'),
  read: (id: string) => ipcRenderer.invoke('skills:read', id),
  delete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  listRepositories: () => ipcRenderer.invoke('skills:listRepositories'),
  saveRepository: (input: {
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
  }) => ipcRenderer.invoke('skills:saveRepository', input),
  removeRepository: (id: string) => ipcRenderer.invoke('skills:removeRepository', id),
  discover: (repositoryId?: string) => ipcRenderer.invoke('skills:discover', repositoryId),
  listDiscovered: (repositoryId?: string) => ipcRenderer.invoke('skills:listDiscovered', repositoryId),
  previewDiscovered: (repositoryId: string, skillPath: string) =>
    ipcRenderer.invoke('skills:previewDiscovered', repositoryId, skillPath),
  installDiscovered: (repositoryId: string, skillPath: string) =>
    ipcRenderer.invoke('skills:installDiscovered', repositoryId, skillPath),
  onDiscoveryEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: Record<string, unknown>): void => callback(event)
    ipcRenderer.on('skills:discovery-event', handler)
    return () => ipcRenderer.removeListener('skills:discovery-event', handler)
  },
}

const dbAPI = {
  createSession: (sessionId: string, title?: string) => ipcRenderer.invoke('db:createSession', sessionId, title),
  createProjectSession: (input: { sessionId: string; projectId: string; title?: string }) =>
    ipcRenderer.invoke('db:createProjectSession', input),
  listSessions: () => ipcRenderer.invoke('db:listSessions'),
  getMessages: (sessionId: string) => ipcRenderer.invoke('db:getMessages', sessionId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('db:deleteSession', sessionId),
  updateSessionTitle: (sessionId: string, title: string) => ipcRenderer.invoke('db:updateSessionTitle', sessionId, title),
  updateSessionProject: (sessionId: string, projectId: string | null) => ipcRenderer.invoke('db:updateSessionProject', sessionId, projectId),
  listProjects: () => ipcRenderer.invoke('db:listProjects'),
  getProject: (projectId: string) => ipcRenderer.invoke('db:getProject', projectId),
  createProject: (input: { projectId: string; name: string; description?: string }) =>
    ipcRenderer.invoke('db:createProject', input),
  deleteProject: (projectId: string) => ipcRenderer.invoke('db:deleteProject', projectId),
  listProjectSessions: (projectId: string) => ipcRenderer.invoke('db:listProjectSessions', projectId),
  onSessionsChanged: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('db:sessionsChanged', handler)
    return () => ipcRenderer.removeListener('db:sessionsChanged', handler)
  },
}

const filesAPI = {
  pick: () => ipcRenderer.invoke('files:pick'),
  resolve: (paths: string[]) => ipcRenderer.invoke('files:resolve', paths),
  read: (path: string) => ipcRenderer.invoke('files:read', path),
  // readBase64 returns the file as base64 + sniffed MIME for multimodal
  // user.message wire content. Whitelist enforced in main (PNG/JPEG/
  // GIF/WebP/PDF only); SVG and unknown MIMEs come back as
  // { ok: false, error: 'unsupported_mime' }.
  readBase64: (path: string) => ipcRenderer.invoke('files:read-base64', path),
  save: (options: { defaultFileName?: string; content?: string; sourcePath?: string }) =>
    ipcRenderer.invoke('files:save', options),
  // saveClipboardImage writes a pasted-image blob to a temp dir and
  // returns the resolved PickedLocalFile so the renderer can route it
  // through the same attachment pipeline as drag/drop or file picker.
  saveClipboardImage: (data: ArrayBuffer, mime: string) =>
    ipcRenderer.invoke('files:saveClipboardImage', { data, mime }),
}

// artifactsAPI bridges the renderer to artifacts:fetch, which downloads
// the bytes of a stored artifact from the engine over HTTP and writes
// them to a per-session cache dir under ~/.harnessclaw/artifact-cache/.
// The renderer feeds the returned path into the existing files:read
// pipeline so docx / pdf rich previews work the same as for local files.
//
// sessionId is optional — when omitted, the file lands under the
// "_orphan" bucket. Threading it through is a UX nicety (per-session
// cleanup, easier debugging of "what did this conversation write to
// disk"), not a correctness requirement.
const artifactsAPI = {
  fetch: (artifactId: string, sessionId?: string) =>
    ipcRenderer.invoke('artifacts:fetch', artifactId, sessionId) as Promise<
      | { ok: true; path: string; fileName: string; mimeType?: string; size: number }
      | { ok: false; error: string }
    >,
}

// workspaceAPI lists the on-disk per-session working directory
// (`~/.harnessclaw/workspace/session/<sid>`) as a tree. Used by the
// chat top-bar "files" button so users can browse and preview every
// file the agent produced, not just declared artifacts. The renderer
// keeps using files.read for the actual preview.
export interface WorkspaceFileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  modifiedAt?: number
  children?: WorkspaceFileNode[]
}
const workspaceAPI = {
  listSession: (sessionId: string) =>
    ipcRenderer.invoke('workspace:listSession', sessionId) as Promise<
      | { ok: true; root: string; exists: boolean; tree: WorkspaceFileNode[]; fileCount: number; truncated?: boolean }
      | { ok: false; error: string }
    >,
  // Reveals the session workspace root in the OS file manager.
  // Creates the dir on demand if the agent hasn't written there yet.
  openFolder: (sessionId: string) =>
    ipcRenderer.invoke('workspace:openFolder', sessionId) as Promise<
      | { ok: true; path: string }
      | { ok: false; error: string; path?: string }
    >,
}

// Video Generation Management API types. Mirrors the providers/agent
// IPC: main forwards GET|PATCH /api/v1/videogen and returns the
// `{ ok, data } | { ok:false, status, error, message }` result shape
// used by every other console: provider handler.
export interface VideoEndpoint {
  model: string
}
export interface VideoProviderListing {
  api_key: string
  base_url: string
  endpoints: Record<string, VideoEndpoint>
}
export interface VideoGenListing {
  config_source: string
  providers: Record<string, VideoProviderListing>
}
export interface VideoGenPatch {
  providers: Record<
    string,
    {
      api_key?: string
      base_url?: string
      endpoints?: Record<string, { model: string }>
    }
  >
}
type VideoGenResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message?: string }

// Image Generation Management API types. Mirrors the videogen IPC: main
// forwards GET|PATCH /api/v1/imagegen and returns the same
// `{ ok, data } | { ok:false, status, error, message }` result shape.
// The image provider/patch carry an extra `path` field vs. videogen.
export interface ImageEndpoint {
  model: string
}
export interface ImageProviderListing {
  api_key: string
  base_url: string
  path: string
  endpoints: Record<string, ImageEndpoint>
}
export interface ImageGenListing {
  config_source: string
  providers: Record<string, ImageProviderListing>
}
export interface ImageGenPatch {
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

const agentAPI = {
  listAgents: (params?: { agent_type?: string; source?: string; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('console:listAgents', params),
  getAgent: (name: string) => ipcRenderer.invoke('console:getAgent', name),
  createAgent: (agent: Record<string, unknown>) => ipcRenderer.invoke('console:createAgent', agent),
  updateAgent: (name: string, fields: Record<string, unknown>) => ipcRenderer.invoke('console:updateAgent', name, fields),
  deleteAgent: (name: string) => ipcRenderer.invoke('console:deleteAgent', name),
  probe: (port?: number) => ipcRenderer.invoke('console:probe', port),
  setPort: (port: number) => ipcRenderer.invoke('console:setPort', port),
  getPort: () => ipcRenderer.invoke('console:getPort'),
  /**
   * Session Metrics API — GET /api/v1/sessions/{id}/metrics on the same
   * Console host:port. Proxied through main IPC so the renderer doesn't
   * have to broaden its CSP. Resolves with the engine's `SessionStats`
   * on success or `{ ok: false, error: ... }` on 4xx / 5xx / network
   * failure.
   */
  getSessionMetrics: (sessionId: string) =>
    ipcRenderer.invoke('console:getSessionMetrics', sessionId),
  /**
   * Model Registry API — GET /api/v1/models on the Console port.
   * Proxied through main IPC to avoid CORS/CSP issues. Resolves with
   * `{ ok: true, data }` on success or `{ ok: false, error, ... }`
   * on failure. See harnessclaw-engine/docs/api/models-registry-api.md.
   */
  listRegistryModels: () => ipcRenderer.invoke('console:listRegistryModels'),
  /**
   * Provider-side model list fetch — queries the currently configured
   * provider endpoint directly (e.g. OpenAI-compatible `/models`) and
   * normalizes the response into the registry-like shape used by Settings.
   */
  listProviderModels: (payload: { provider: string; type: 'openai' | 'anthropic' | 'gemini'; baseUrl?: string | null; apiKey?: string }) =>
    ipcRenderer.invoke('console:listProviderModels', payload),
  /**
   * Agent Capabilities API — GET /api/v1/agent/capabilities. Resolved
   * SupportsFlags + derived capability buckets for the active model,
   * taking endpoint.model_type overrides into account so the gate
   * and the UI never disagree.
   */
  getAgentCapabilities: () => ipcRenderer.invoke('console:getAgentCapabilities'),
  /**
   * Tools Management API — GET/PATCH /api/v1/tools[/{name}] on the
   * Console port. Hot-edit `web_search` / `tavily_search` enabled
   * flag + credentials with hot-reload + yaml persistence. See
   * harnessclaw-engine/docs/api/tools-management-api.md.
   */
  listTools: () => ipcRenderer.invoke('console:listTools'),
  getTool: (name: string) => ipcRenderer.invoke('console:getTool', name),
  patchTool: (
    name: string,
    patch: { enabled?: boolean; config?: Record<string, unknown> },
  ) => ipcRenderer.invoke('console:patchTool', name, patch),
  /**
   * Providers Management API — hot-edit providers + the top-level
   * `agent` block (primary + fallback_chain + tuning defaults) at
   * runtime. See harnessclaw-engine/docs/api/providers-management-api.md.
   * Engine 2026-05-14+: management routes are always mounted; a 404
   * means the path is wrong, not "API gated on chain length".
   */
  listProviders: () => ipcRenderer.invoke('console:listProviders'),
  // POST /providers — engine creates a brand-new provider entry. Used
  // when the user picks a vendor that isn't yet in the engine's
  // `llm.providers.*` map (DeepSeek, Google, Kimi, GLM, MiniMax …).
  // Constraints: `name` must NOT contain `:` or `.`;
  // `type` ∈ {openai, anthropic, gemini}.
  createProvider: (payload: {
    name: string
    type: 'openai' | 'anthropic' | 'gemini'
    base_url?: string
    api_key?: string
    disabled?: boolean
  }) => ipcRenderer.invoke('console:createProvider', payload),
  getFallbackChain: () => ipcRenderer.invoke('console:getFallbackChain'),
  updateFallbackChain: (chain: string[]) =>
    ipcRenderer.invoke('console:updateFallbackChain', chain),
  // GET /api/v1/agent — full agent block (primary + fallback_chain
  // + max_tokens / temperature / context_window + entries[] health).
  // Engine 2026-05-14+. Replaces the old /fallback-chain endpoint.
  getAgentConfig: () => ipcRenderer.invoke('console:getAgentConfig'),
  // PATCH /api/v1/agent — partial update. Any subset of
  // {primary, fallback_chain, max_tokens, temperature, context_window}.
  // Omitted fields are left unchanged. `fallback_chain: []` explicitly
  // clears the fallback (distinct from "not passed"). temperature is
  // canonical [0, 1] — engine rescales to provider-native range.
  patchAgentConfig: (patch: {
    primary?: string
    fallback_chain?: string[]
    image_generation?: string
    video_generation?: string
    max_tokens?: number
    temperature?: number
    context_window?: number
  }) => ipcRenderer.invoke('console:patchAgentConfig', patch),
  // GET /api/v1/videogen — list videogen providers (credentials +
  // per-endpoint model bindings) + config_source. Proxied through main.
  listVideoProviders: (): Promise<VideoGenResult<VideoGenListing>> =>
    ipcRenderer.invoke('console:listVideoProviders'),
  // PATCH /api/v1/videogen — partial update of the videogen providers
  // block. Omitted fields left unchanged (mirrors providers PATCH).
  patchVideoConfig: (patch: VideoGenPatch): Promise<VideoGenResult<VideoGenListing>> =>
    ipcRenderer.invoke('console:patchVideoConfig', patch),
  // GET /api/v1/imagegen — list imagegen providers (credentials + path +
  // per-endpoint model bindings) + config_source. Proxied through main.
  listImageProviders: (): Promise<VideoGenResult<ImageGenListing>> =>
    ipcRenderer.invoke('console:listImageProviders'),
  // PATCH /api/v1/imagegen — partial update of the imagegen providers
  // block. Omitted fields left unchanged (mirrors videogen PATCH).
  patchImageConfig: (patch: ImageGenPatch): Promise<VideoGenResult<ImageGenListing>> =>
    ipcRenderer.invoke('console:patchImageConfig', patch),
  // PATCH /providers/{p} — credentials (type / api_key / base_url) or
  // `disabled` flag (engine 2026-05-14+: toggles all endpoints under
  // this provider in one shot).
  patchProvider: (
    name: string,
    patch: {
      type?: 'openai' | 'anthropic' | 'gemini'
      api_key?: string
      base_url?: string
      disabled?: boolean
    },
  ) => ipcRenderer.invoke('console:patchProvider', name, patch),
  listEndpoints: (providerName: string) =>
    ipcRenderer.invoke('console:listEndpoints', providerName),
  createEndpoint: (
    providerName: string,
    payload: {
      name: string
      model: string
      max_tokens?: number
      temperature?: number
      enable_thinking?: boolean | null
      disabled?: boolean
    },
  ) => ipcRenderer.invoke('console:createEndpoint', providerName, payload),
  patchEndpoint: (
    providerName: string,
    endpointName: string,
    patch: {
      model?: string
      max_tokens?: number
      temperature?: number
      enable_thinking?: boolean | null
      disabled?: boolean
    },
  ) => ipcRenderer.invoke('console:patchEndpoint', providerName, endpointName, patch),
  deleteEndpoint: (providerName: string, endpointName: string) =>
    ipcRenderer.invoke('console:deleteEndpoint', providerName, endpointName),
}

// Quick-launcher (Alfred-style) bridge.
//   • `submit` ships the typed prompt to main; main hides the launcher,
//     focuses the main window, and forwards the prompt via
//     `launcher:question` so the React shell can land it in /chat.
//   • `hide` closes the launcher (used on Escape).
//   • `onQuestion` lets the main renderer subscribe to incoming
//     prompts pushed from the launcher window.
//   • `onReset` lets the launcher renderer clear its input each time
//     the window is re-shown via the global shortcut.
const launcherAPI = {
  submit: (prompt: string) => ipcRenderer.invoke('launcher:submit', prompt),
  hide: () => ipcRenderer.invoke('launcher:hide'),
  onQuestion: (callback: (prompt: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, prompt: string): void => callback(prompt)
    ipcRenderer.on('launcher:question', handler)
    return () => ipcRenderer.removeListener('launcher:question', handler)
  },
  onReset: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('launcher:reset', handler)
    return () => ipcRenderer.removeListener('launcher:reset', handler)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('appBridge', appAPI)
    contextBridge.exposeInMainWorld('engineConfig', configAPI)
    contextBridge.exposeInMainWorld('config', configAPI)
    contextBridge.exposeInMainWorld('nanobotConfig', configAPI)
    contextBridge.exposeInMainWorld('appConfig', appConfigAPI)
    contextBridge.exposeInMainWorld('appRuntime', appRuntimeAPI)
    contextBridge.exposeInMainWorld('harnessclaw', harnessclawAPI)
    contextBridge.exposeInMainWorld('browserAgent', browserAgentAPI)
    contextBridge.exposeInMainWorld('skills', skillsAPI)
    contextBridge.exposeInMainWorld('db', dbAPI)
    contextBridge.exposeInMainWorld('files', filesAPI)
    contextBridge.exposeInMainWorld('artifacts', artifactsAPI)
    contextBridge.exposeInMainWorld('workspace', workspaceAPI)
    contextBridge.exposeInMainWorld('agentApi', agentAPI)
    contextBridge.exposeInMainWorld('launcherApi', launcherAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.appBridge = appAPI
  // @ts-ignore (define in dts)
  window.engineConfig = configAPI
  // @ts-ignore (define in dts)
  window.config = configAPI
  // @ts-ignore (define in dts)
  window.nanobotConfig = configAPI
  // @ts-ignore (define in dts)
  window.appConfig = appConfigAPI
  // @ts-ignore (define in dts)
  window.appRuntime = appRuntimeAPI
  // @ts-ignore (define in dts)
  window.harnessclaw = harnessclawAPI
  // @ts-ignore (define in dts)
  window.browserAgent = browserAgentAPI
  // @ts-ignore (define in dts)
  window.skills = skillsAPI
  // @ts-ignore (define in dts)
  window.db = dbAPI
  // @ts-ignore (define in dts)
  window.files = filesAPI
  // @ts-ignore (define in dts)
  window.artifacts = artifactsAPI
  // @ts-ignore (define in dts)
  window.workspace = workspaceAPI
  // @ts-ignore (define in dts)
  window.agentApi = agentAPI
  // @ts-ignore (define in dts)
  window.launcherApi = launcherAPI
}
