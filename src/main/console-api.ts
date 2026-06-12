import http from 'node:http'
import { writeAppLog } from './logging'

const DEFAULT_PORT = 8090
const API_PREFIX = '/console/v1'
// Session Metrics API uses a different prefix on the same host:port. See
// harnessclaw-engine/docs/api/session-metrics-api.md — responses are
// **not** wrapped in {code, data}, the body is the raw SessionStats
// object, so it bypasses the `request()` helper below.
const METRICS_PREFIX = '/api/v1/sessions'

let currentPort = DEFAULT_PORT

export function setConsolePort(port: number): void {
  currentPort = port > 0 && port <= 65535 ? port : DEFAULT_PORT
}

export function getConsolePort(): number {
  return currentPort
}

interface ConsoleResponse<T = unknown> {
  code: string
  data?: T
  total?: number
  message?: string
}

interface AgentDefinition {
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

function request<T = unknown>(method: string, path: string, body?: unknown): Promise<ConsoleResponse<T>> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_PREFIX}${path}`, `http://localhost:${currentPort}`)
    const payload = body ? JSON.stringify(body) : undefined

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          Accept: 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode === 204) {
            resolve({ code: 'OK' })
            return
          }
          try {
            resolve(JSON.parse(raw) as ConsoleResponse<T>)
          } catch {
            reject(new Error(`Invalid JSON response: ${raw.slice(0, 200)}`))
          }
        })
      },
    )

    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Console API request timeout'))
    })

    if (payload) req.write(payload)
    req.end()
  })
}

export async function probeConsole(port?: number): Promise<{ ok: boolean; error?: string }> {
  const targetPort = port != null && port > 0 ? port : currentPort
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: targetPort,
        path: `${API_PREFIX}/agents?limit=1`,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve({ ok: true })
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}` })
          }
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: '连接超时' })
    })
    req.end()
  })
}

export async function listAgents(params?: {
  agent_type?: string
  source?: string
  limit?: number
  offset?: number
}): Promise<ConsoleResponse<AgentDefinition[]>> {
  const query = new URLSearchParams()
  if (params?.agent_type) query.set('agent_type', params.agent_type)
  if (params?.source) query.set('source', params.source)
  if (params?.limit != null) query.set('limit', String(params.limit))
  if (params?.offset != null) query.set('offset', String(params.offset))
  const qs = query.toString()
  return request<AgentDefinition[]>('GET', `/agents${qs ? `?${qs}` : ''}`)
}

export async function getAgent(name: string): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('GET', `/agents/${encodeURIComponent(name)}`)
}

export async function createAgent(agent: Omit<AgentDefinition, 'source'>): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('POST', '/agents', agent)
}

export async function updateAgent(name: string, fields: Partial<Omit<AgentDefinition, 'name' | 'source'>>): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('PUT', `/agents/${encodeURIComponent(name)}`, fields)
}

export async function deleteAgent(name: string): Promise<ConsoleResponse> {
  return request('DELETE', `/agents/${encodeURIComponent(name)}`)
}

// ─── Model Registry API ─────────────────────────────────────────────────
// See harnessclaw-engine/docs/api/models-registry-api.md.
//
// GET /api/v1/models — list every model known to the engine, with
// provider/family/supports/limits metadata. Responses are wrapped in
// `{ data: [...] }`. Auth: not required (Console port only).

const MODELS_PREFIX = '/api/v1/models'

export interface RegistryModelSupports {
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

export interface RegistryModelLimits {
  context_window?: number
  max_input_tokens?: number
  max_output_tokens?: number
  max_reasoning_tokens?: number | null
}

export interface RegistryModelDefaults {
  temperature?: number
  top_p?: number
  max_output_tokens_default?: number
  [key: string]: unknown
}

export interface RegistryModel {
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

export type RegistryModelsResult =
  | { ok: true; data: RegistryModel[] }
  | { ok: false; status: number; error: string; message?: string }

export interface ProviderModelsFetchPayload {
  provider: string
  type: ProviderType
  baseUrl?: string | null
  apiKey?: string
}

// ─── Providers Management API ───────────────────────────────────────────
// See harnessclaw-engine/docs/api/providers-management-api.md.
//
// Two-level data model: `providers` (credentials) → `endpoints` (per-model
// bindings). Chain entries use canonical `provider:endpoint` refs
// (2026-05-14+) so endpoint names can contain `.` (e.g. `gpt-5.5`).
// Server still accepts legacy `provider.endpoint` on input for
// back-compat; all yaml / API responses emit `:`.
//
// 2026-05-14 structure rewrite v2: top-level `agent` block replaces
// `llm.fallback_chain`. Routing is now `[primary, ...fallback_chain]`
// (primary always at index 0). `/api/v1/fallback-chain` is gone and
// replaced by `GET|PATCH /api/v1/agent`. Management API is **always**
// mounted regardless of chain length (was previously gated on ≥2).
//
// | Method | Path                                              | Use                  |
// |--------|---------------------------------------------------|----------------------|
// | GET    | /api/v1/providers                                 | list (nested)        |
// | POST   | /api/v1/providers                                 | create provider      |
// | PATCH  | /api/v1/providers/{p}                             | credentials/disabled |
// | GET    | /api/v1/providers/{p}/endpoints                   | list endpoints       |
// | POST   | /api/v1/providers/{p}/endpoints                   | create endpoint      |
// | PATCH  | /api/v1/providers/{p}/endpoints/{e}               | edit endpoint        |
// | DELETE | /api/v1/providers/{p}/endpoints/{e}               | delete endpoint      |
// | GET    | /api/v1/agent                                     | primary + chain      |
// | PATCH  | /api/v1/agent                                     | partial agent update |
//
// All responses wrap data as `{ code, data }`.
const API_V1_PREFIX = '/api/v1'

// Engine `type` enum. See harnessclaw-engine/docs/api/providers-management-api.md
// 2026-05-14 added `gemini`. OpenAI-compatible vendors (DeepSeek, Kimi, GLM,
// MiniMax, 讯飞, 通义) all use `openai` and differ only by `base_url`.
export type ProviderType = 'openai' | 'anthropic' | 'gemini'

export interface ProviderEndpointInfo {
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
  // Engine 2026-05-19+: per-endpoint capability override. Tokens from
  // {vision, pdf, audio, video, reasoning, tools, search,
  // image_generation}; empty / absent means "inherit manifest baseline".
  model_type?: string[]
  // Engine 2026-05-30+: optional display-only tag persisted on the
  // endpoint. Empty/absent = ungrouped (renderer falls back to
  // getModelGroup(id) heuristic).
  group?: string
  // Full image generation target URL resolved by the engine registry.
  image_generation_url?: string
}

export interface ProviderInfo {
  name: string
  type: ProviderType
  base_url: string
  api_key: string
  // Engine 2026-05-14+: true = whole provider paused, dispatcher
  // skips every endpoint under it regardless of per-endpoint state.
  disabled?: boolean
  endpoints: ProviderEndpointInfo[]
}

export interface ProviderChainEntry {
  index: number
  name: string
  provider: string
  endpoint: string
  state: 'healthy' | 'tripped' | 'ready_to_probe'
  // Engine 2026-05-14+: entries returned by GET /agent carry a
  // `disabled` flag (effective = provider.disabled OR endpoint.disabled).
  // Orthogonal to `state` — disabled+any-state means dispatcher skips it.
  disabled?: boolean
  tripped_until?: string
  cooldown_seconds: number
  consecutive_failures: number
}

// Renderer-facing flat chain shape. Kept stable across engine API
// rewrites: when the engine moved from `/fallback-chain` (flat) to
// `/agent` (primary + fallback_chain), `getFallbackChain` /
// `updateFallbackChain` continue to expose a single flat array by
// concatenating `[primary, ...fallback_chain]` so the renderer's
// drag-to-reorder UI doesn't need to know about the primary slot.
export interface ProviderChain {
  chain: string[]
  entries: ProviderChainEntry[]
}

// Engine 2026-05-14+ /api/v1/agent payload. `primary` is the head of
// the effective chain (index 0). `fallback_chain` is everything after.
// `entries[]` covers `[primary, ...fallback_chain]` in order. The
// tuning fields are agent-level defaults (PATCH /agent rebuilds
// adapters to bake them in; see API doc "调用参数生效规则").
export interface AgentConfig {
  primary: string
  fallback_chain: string[]
  image_generation?: string
  max_tokens?: number
  temperature?: number
  context_window?: number
  entries: ProviderChainEntry[]
}

export interface AgentPatch {
  primary?: string
  fallback_chain?: string[]
  image_generation?: string
  // Engine 2026-06+: canonical `provider:endpoint` ref for the video
  // generation tool target (e.g. `doubao:seedance-lite-i2v`). Same
  // omit-means-unchanged semantics as the other fields.
  video_generation?: string
  max_tokens?: number
  temperature?: number
  context_window?: number
}

// POST /providers — create a brand-new provider entry. The renderer falls
// back to this when the user picks a vendor whose key isn't in the
// engine's `llm.providers.*` map yet (DeepSeek / Kimi / GLM / Google /
// MiniMax / 讯飞 etc.). Constraints (engine side):
//   - `name` non-empty, must NOT contain `:` or `.`
//   - `type` ∈ {openai, anthropic, gemini}
//   - `base_url` / `api_key` optional but recommended (without api_key
//     the provider's endpoints will fail at call time).
export interface ProviderCreatePayload {
  name: string
  type: ProviderType
  base_url?: string
  api_key?: string
  // Optional: create the provider already paused.
  disabled?: boolean
}

// PATCH /providers/{p} — credentials AND/OR `disabled` flag (engine
// 2026-05-14+). When `disabled` flips, dispatcher rebuilds and every
// chain entry under this provider has its effective routing toggled
// in one shot — no adapter rebuild, no chain churn.
export interface ProviderPatch {
  type?: ProviderType
  api_key?: string
  base_url?: string
  disabled?: boolean
}

// POST /providers/{p}/endpoints — create a new endpoint.
export interface EndpointCreatePayload {
  name: string
  model: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  // Optional: create the endpoint already paused. Defaults to false on
  // the engine side. See engine docs 2026-05-14 entry.
  disabled?: boolean
  // Engine 2026-05-30+: optional display-only tag. Free text.
  group?: string
}

// PATCH /providers/{p}/endpoints/{e} — update endpoint fields.
export interface EndpointPatch {
  model?: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  // Engine 2026-05-14+: PATCH disabled=true now **auto-removes** the
  // endpoint's entry from the agent fallback_chain (the doc treats
  // disable as the user's explicit "don't route to this" intent).
  // Re-enabling (disabled=false) does NOT auto-restore the chain
  // unless the chain is currently empty, in which case the engine
  // auto-promotes the re-enabled endpoint to primary (2026-05-15).
  // Callers that want it back in the chain at a specific position
  // must PATCH /agent themselves.
  disabled?: boolean
  // Engine 2026-05-19+: capability token override. Sending an empty
  // array explicitly clears the override (reverts to manifest baseline);
  // omitting the key leaves it unchanged. Allowed tokens:
  // vision/pdf/audio/video/reasoning/tools/search/image_generation.
  // Unknown tokens → 400 invalid_model_type.
  model_type?: string[]
  // Engine 2026-05-30+: free-text display tag. Sending `""` explicitly
  // clears it (yaml key removed); omitting leaves it unchanged.
  group?: string
}

export type ProvidersResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message?: string }

// `void` data for endpoints that return no body (DELETE).
function providersRequest<T>(
  method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ProvidersResult<T>> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined
    const fullPath = `${API_V1_PREFIX}${path}`
    const url = `http://localhost:${currentPort}${fullPath}`
    // Debug logging — surface the full URL, method, and request body
    // so users can copy-paste the call into curl / Postman for
    // backend debugging. See `app-runtime:openLogsDirectory` to
    // browse the file.
    writeAppLog('info', 'providers.api.request', `${method} ${url}`, {
      method,
      url,
      body: body ?? null,
    })
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path: fullPath,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          // DELETE often returns 200 with `{code:"OK"}` and no data.
          if (!raw && (status === 200 || status === 204)) {
            writeAppLog('info', 'providers.api.response', `${method} ${url} → ${status}`, {
              method,
              url,
              status,
              body: null,
            })
            resolve({ ok: true, data: undefined as unknown as T })
            return
          }
          try {
            const parsed = JSON.parse(raw) as { code?: string; data?: T; message?: string }
            if (status >= 200 && status < 300 && parsed.code === 'OK') {
              writeAppLog('info', 'providers.api.response', `${method} ${url} → ${status} OK`, {
                method,
                url,
                status,
                code: parsed.code,
              })
              resolve({ ok: true, data: (parsed.data ?? (undefined as unknown as T)) })
              return
            }
            writeAppLog('warn', 'providers.api.response', `${method} ${url} → ${status} ${parsed.code || ''}`, {
              method,
              url,
              status,
              code: parsed.code,
              message: parsed.message,
              raw: raw.slice(0, 500),
            })
            resolve({
              ok: false,
              status,
              error: parsed.code || `http_${status}`,
              message: parsed.message,
            })
          } catch {
            writeAppLog('warn', 'providers.api.response', `${method} ${url} → ${status} (malformed JSON)`, {
              method,
              url,
              status,
              raw: raw.slice(0, 500),
            })
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) => {
      writeAppLog('warn', 'providers.api.error', `${method} ${url} network error`, {
        method,
        url,
        error: err.message,
      })
      resolve({ ok: false, status: 0, error: 'network_error', message: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      writeAppLog('warn', 'providers.api.error', `${method} ${url} timeout`, { method, url })
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

// Engine 2026-05-14+: GET /providers also returns `config_source`
// (absolute path of the yaml viper actually loaded). Useful for the
// UI to surface "writing back to: …" so the user can verify before
// mutating. Kept optional because older engines omit it.
export function listProviders(): Promise<
  ProvidersResult<{ providers: ProviderInfo[]; config_source?: string }>
> {
  return providersRequest<{ providers: ProviderInfo[]; config_source?: string }>(
    'GET',
    '/providers',
  )
}

export function createProvider(
  payload: ProviderCreatePayload,
): Promise<ProvidersResult<{ providers: ProviderInfo[] }>> {
  return providersRequest<{ providers: ProviderInfo[] }>('POST', '/providers', payload)
}

export function patchProvider(
  name: string,
  patch: ProviderPatch,
): Promise<ProvidersResult<{ providers: ProviderInfo[] }>> {
  return providersRequest<{ providers: ProviderInfo[] }>(
    'PATCH',
    `/providers/${encodeURIComponent(name)}`,
    patch,
  )
}

export function listEndpoints(
  providerName: string,
): Promise<ProvidersResult<{ endpoints: ProviderEndpointInfo[] }>> {
  return providersRequest<{ endpoints: ProviderEndpointInfo[] }>(
    'GET',
    `/providers/${encodeURIComponent(providerName)}/endpoints`,
  )
}

export function createEndpoint(
  providerName: string,
  payload: EndpointCreatePayload,
): Promise<ProvidersResult<ProviderEndpointInfo>> {
  return providersRequest<ProviderEndpointInfo>(
    'POST',
    `/providers/${encodeURIComponent(providerName)}/endpoints`,
    payload,
  )
}

export function patchEndpoint(
  providerName: string,
  endpointName: string,
  patch: EndpointPatch,
): Promise<ProvidersResult<ProviderEndpointInfo>> {
  return providersRequest<ProviderEndpointInfo>(
    'PATCH',
    `/providers/${encodeURIComponent(providerName)}/endpoints/${encodeURIComponent(endpointName)}`,
    patch,
  )
}

export function deleteEndpoint(
  providerName: string,
  endpointName: string,
): Promise<ProvidersResult<void>> {
  return providersRequest<void>(
    'DELETE',
    `/providers/${encodeURIComponent(providerName)}/endpoints/${encodeURIComponent(endpointName)}`,
  )
}

// Engine 2026-05-14+ /api/v1/agent — full agent block. Use when the
// renderer needs primary/fallback split or tuning fields. For the
// drag-to-reorder flat chain UI, prefer the back-compat wrappers
// below. (Named `getAgentConfig` instead of `getAgent` to avoid
// colliding with the Console agents-CRUD `getAgent(name)` at the
// top of this file — these are two unrelated APIs that happen to
// share a noun.)
export function getAgentConfig(): Promise<ProvidersResult<AgentConfig>> {
  return providersRequest<AgentConfig>('GET', '/agent')
}

export function patchAgentConfig(patch: AgentPatch): Promise<ProvidersResult<AgentConfig>> {
  return providersRequest<AgentConfig>('PATCH', '/agent', patch)
}

// ─── Video Generation Management API ────────────────────────────────────
//
// GET|PATCH /api/v1/videogen — hot-edit the video generation providers
// block (credentials + per-endpoint model bindings), mirroring the
// providers management API but scoped to the `videogen` config tree.
// Responses wrap data as `{ code, data }` so they go through the same
// `providersRequest` helper.

export interface VideoEndpointInfo {
  model: string
}

export interface VideoProviderInfo {
  api_key: string
  base_url: string
  endpoints: Record<string, VideoEndpointInfo>
}

export interface VideoGenInfo {
  config_source: string
  providers: Record<string, VideoProviderInfo>
}

// PATCH body. Any subset; omitted = unchanged. Mirrors the engine's
// videogen management contract.
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

export function listVideoProviders(): Promise<ProvidersResult<VideoGenInfo>> {
  return providersRequest<VideoGenInfo>('GET', '/videogen')
}

export function patchVideoConfig(patch: VideoGenPatch): Promise<ProvidersResult<VideoGenInfo>> {
  return providersRequest<VideoGenInfo>('PATCH', '/videogen', patch)
}

// ─── Image Generation Management API ────────────────────────────────────
//
// GET|PATCH /api/v1/imagegen — hot-edit the image generation providers
// block (credentials + path + per-endpoint model bindings), mirroring the
// videogen management API but scoped to the `imagegen` config tree.
// Responses wrap data as `{ code, data }` so they go through the same
// `providersRequest` helper.

export interface ImageEndpointInfo {
  model: string
}

export interface ImageProviderInfo {
  api_key: string
  base_url: string
  path: string
  endpoints: Record<string, ImageEndpointInfo>
}

export interface ImageGenInfo {
  config_source: string
  providers: Record<string, ImageProviderInfo>
}

// PATCH body. Any subset; omitted = unchanged. Mirrors the engine's
// imagegen management contract.
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

export function listImageProviders(): Promise<ProvidersResult<ImageGenInfo>> {
  return providersRequest<ImageGenInfo>('GET', '/imagegen')
}

export function patchImageConfig(patch: ImageGenPatch): Promise<ProvidersResult<ImageGenInfo>> {
  return providersRequest<ImageGenInfo>('PATCH', '/imagegen', patch)
}

// Flatten the agent payload into the legacy `{chain, entries}` shape
// the renderer's drag-list still consumes. `entries[]` already covers
// `[primary, ...fallback_chain]` in order, so chain is reconstructable
// without remapping indices. Primary may be empty (degraded mode) —
// in that case the chain is just the fallback (typically also empty).
function flattenAgent(agent: AgentConfig): ProviderChain {
  const fallback = Array.isArray(agent.fallback_chain) ? agent.fallback_chain : []
  const chain = agent.primary ? [agent.primary, ...fallback] : fallback.slice()
  const entries = Array.isArray(agent.entries) ? agent.entries : []
  return { chain, entries }
}

// Back-compat wrapper: the engine no longer has `/fallback-chain`, but
// the renderer's UI still thinks in terms of a flat chain (primary
// implicit at index 0). This adapts GET /agent → flat shape so the
// existing renderer code keeps working.
export async function getFallbackChain(): Promise<ProvidersResult<ProviderChain>> {
  const res = await getAgentConfig()
  if (!res.ok) return res
  return { ok: true, data: flattenAgent(res.data) }
}

// Reverse adapter: split a flat chain into `{primary, fallback_chain}`
// and PATCH /agent. Empty chain → degraded mode (primary='' + empty
// fallback). Per the engine doc, omitting a field means "leave
// unchanged" so we must pass both fields explicitly to fully replace
// the routing.
export async function updateFallbackChain(
  chain: string[],
): Promise<ProvidersResult<ProviderChain>> {
  const primary = chain.length > 0 ? chain[0] : ''
  const fallback = chain.length > 1 ? chain.slice(1) : []
  const res = await patchAgentConfig({ primary, fallback_chain: fallback })
  if (!res.ok) return res
  return { ok: true, data: flattenAgent(res.data) }
}

// ─── Agent Capabilities API ────────────────────────────────────────────
//
// GET /api/v1/agent/capabilities — resolved SupportsFlags + derived
// capability buckets for the active model. Replaces the
// /agent + /models two-step normalize previously needed in the renderer:
// the server now takes endpoint.model_type into account (override-aware)
// so the gate and the UI see the same truth.

export interface AgentCapabilitiesData {
  model_key: string
  supports: RegistryModelSupports
  capabilities: string[]
}

export type AgentCapabilitiesResult =
  | { ok: true; data: AgentCapabilitiesData }
  | { ok: false; status: number; error: string; message?: string }

const AGENT_CAPABILITIES_PATH = '/api/v1/agent/capabilities'

export function getAgentCapabilities(): Promise<AgentCapabilitiesResult> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path: AGENT_CAPABILITIES_PATH,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          if (status === 200) {
            try {
              const body = JSON.parse(raw) as { data?: AgentCapabilitiesData }
              if (body?.data?.model_key !== undefined) {
                resolve({ ok: true, data: body.data })
                return
              }
              resolve({ ok: false, status, error: 'internal', message: 'missing data' })
            } catch {
              resolve({ ok: false, status, error: 'internal', message: 'malformed JSON' })
            }
            return
          }
          try {
            const body = JSON.parse(raw) as { error?: string; message?: string }
            resolve({
              ok: false,
              status,
              error: body.error || `http_${status}`,
              message: body.message,
            })
          } catch {
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) =>
      resolve({ ok: false, status: 0, error: 'network_error', message: err.message }),
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    req.end()
  })
}

export function listRegistryModels(): Promise<RegistryModelsResult> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path: MODELS_PREFIX,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          if (status === 200) {
            try {
              const body = JSON.parse(raw) as { data?: RegistryModel[] }
              if (Array.isArray(body?.data)) {
                resolve({ ok: true, data: body.data })
              } else {
                resolve({ ok: false, status, error: 'internal', message: 'missing data field' })
              }
            } catch {
              resolve({ ok: false, status, error: 'internal', message: 'malformed JSON' })
            }
            return
          }
          try {
            const body = JSON.parse(raw) as { error?: string; message?: string }
            resolve({
              ok: false,
              status,
              error: body.error || `http_${status}`,
              message: body.message,
            })
          } catch {
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, status: 0, error: 'network_error', message: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    req.end()
  })
}

function buildProviderModelUrls(baseUrl: string, type: ProviderType): string[] {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const candidates: string[] = []
  const hasVersionSuffix = /\/v\d+(?:beta\d+)?$/i.test(normalized)

  if (type === 'gemini') {
    if (hasVersionSuffix) candidates.push(`${normalized}/models`)
    candidates.push(`${normalized}/v1beta/models`)
    candidates.push(`${normalized}/models`)
  } else {
    if (hasVersionSuffix) candidates.push(`${normalized}/models`)
    candidates.push(`${normalized}/v1/models`)
    candidates.push(`${normalized}/models`)
  }

  return Array.from(new Set(candidates))
}

function extractProviderModelsMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body
  if (!body || typeof body !== 'object') return fallback
  const rec = body as Record<string, unknown>
  if (typeof rec.message === 'string' && rec.message.trim()) return rec.message
  const err = rec.error
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object') {
    const nested = err as Record<string, unknown>
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message
    if (typeof nested.code === 'string' && nested.code.trim()) return nested.code
  }
  return fallback
}

function normalizeProviderModels(
  provider: string,
  body: unknown,
): RegistryModel[] | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>

  if (Array.isArray(rec.data)) {
    const items = rec.data
      .map((item): RegistryModel | null => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        const rawId = typeof row.id === 'string'
          ? row.id.trim()
          : typeof row.name === 'string'
            ? row.name.trim()
            : ''
        if (!rawId) return null
        const modelId = rawId.replace(/^models\//, '')
        const displayName = typeof row.display_name === 'string'
          ? row.display_name
          : typeof row.displayName === 'string'
            ? row.displayName
            : undefined
        const family = typeof row.family === 'string' ? row.family : undefined
        return {
          id: `${provider}:${modelId}`,
          provider,
          model_id: modelId,
          ...(displayName ? { display_name: displayName } : {}),
          ...(family ? { family } : {}),
        }
      })
      .filter((item): item is RegistryModel => item !== null)
    return items
  }

  if (Array.isArray(rec.models)) {
    const items = rec.models
      .map((item): RegistryModel | null => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        const rawName = typeof row.name === 'string' ? row.name.trim() : ''
        if (!rawName) return null
        const modelId = rawName.replace(/^models\//, '')
        const displayName = typeof row.displayName === 'string'
          ? row.displayName
          : typeof row.display_name === 'string'
            ? row.display_name
            : undefined
        return {
          id: `${provider}:${modelId}`,
          provider,
          model_id: modelId,
          ...(displayName ? { display_name: displayName } : {}),
        }
      })
      .filter((item): item is RegistryModel => item !== null)
    return items
  }

  return null
}

export async function listProviderModels(
  payload: ProviderModelsFetchPayload,
): Promise<RegistryModelsResult> {
  const provider = payload.provider.trim()
  const baseUrl = payload.baseUrl?.trim() || ''
  const apiKey = payload.apiKey?.trim() || ''

  if (!provider) return { ok: false, status: 0, error: 'invalid_provider' }
  if (!baseUrl) return { ok: false, status: 0, error: 'missing_base_url' }
  if (!apiKey) return { ok: false, status: 0, error: 'missing_api_key' }

  const urls = buildProviderModelUrls(baseUrl, payload.type)
  let lastFailure: RegistryModelsResult | null = null

  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (payload.type === 'anthropic') {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else if (payload.type === 'gemini') {
        headers['x-goog-api-key'] = apiKey
      } else {
        headers.Authorization = `Bearer ${apiKey}`
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      const raw = await response.text()
      let parsed: unknown = raw
      try {
        parsed = raw ? JSON.parse(raw) : {}
      } catch {
        parsed = raw
      }

      if (!response.ok) {
        lastFailure = {
          ok: false,
          status: response.status,
          error: `http_${response.status}`,
          message: extractProviderModelsMessage(parsed, raw.slice(0, 200)),
        }
        if (response.status === 404) continue
        return lastFailure
      }

      const models = normalizeProviderModels(provider, parsed)
      if (!models) {
        return {
          ok: false,
          status: response.status,
          error: 'invalid_response',
          message: 'Unsupported models response shape',
        }
      }
      return { ok: true, data: models }
    } catch (error) {
      lastFailure = error instanceof Error && error.name === 'AbortError'
        ? { ok: false, status: 0, error: 'timeout' }
        : { ok: false, status: 0, error: 'network_error', message: String(error) }
      return lastFailure
    } finally {
      clearTimeout(timer)
    }
  }

  return lastFailure || { ok: false, status: 0, error: 'request_failed' }
}

// ─── Tools Management API ─────────────────────────────────────────────
//
// GET /api/v1/tools — list all hot-editable tools (currently only the
// search backends: web_search / tavily_search). See the engine doc
// `docs/api/tools-management-api.md`.
//
// PATCH /api/v1/tools/{name} — partial update of `enabled` and / or
// `config`. Hot-reloads the registry and persists back to the yaml.
//
// We talk to the Console host:port (same as session-metrics / models)
// and surface engine errors verbatim (`invalid_config`,
// `hot_reload_failed`, `persist_failed`, ...) so the renderer can show
// human-readable messages.

const TOOLS_PREFIX = '/api/v1/tools'

export interface ToolEntry {
  name: string
  registered_name: string
  enabled: boolean
  effective: boolean
  config: Record<string, unknown>
  credential_fields: string[]
}

export type ToolsResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message?: string }

export interface ToolPatchPayload {
  enabled?: boolean
  config?: Record<string, unknown>
}

// Redact obvious credential fields before they hit the app log. The
// Tools Management API surfaces credentials in **plaintext** by design
// (per the doc §字段说明: "凭证以明文返回，与 providers-management-api
// 对齐"), but the app log lives on disk and gets pasted into bug
// reports; redacting here is purely defense-in-depth so a stray copy
// doesn't leak a Tavily / iFly key.
function redactToolsBody(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'config' && v && typeof v === 'object' && !Array.isArray(v)) {
      const inner: Record<string, unknown> = {}
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
        if (/(api_key|api_secret|app_id|secret|token|password)/i.test(ck)) {
          inner[ck] = typeof cv === 'string' && cv ? `***(${cv.length})` : cv
        } else {
          inner[ck] = cv
        }
      }
      out[k] = inner
    } else {
      out[k] = v
    }
  }
  return out
}

function consoleHttpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 8000,
): Promise<ToolsResult<T>> {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const url = `http://localhost:${currentPort}${path}`
    // Debug logging — same shape as `providers.api.*` so the app-log
    // tail / "导出诊断包" surfaces both consistently. Body is redacted
    // for credential fields (see redactToolsBody).
    writeAppLog('info', 'tools.api.request', `${method} ${url}`, {
      method,
      url,
      body: body !== undefined ? redactToolsBody(body) : null,
    })
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          if (status >= 200 && status < 300) {
            try {
              const body = JSON.parse(raw) as { code?: string; data?: T; message?: string }
              if (body && body.code === 'OK' && body.data !== undefined) {
                writeAppLog(
                  'info',
                  'tools.api.response',
                  `${method} ${url} → ${status} OK`,
                  { method, url, status, code: body.code },
                )
                resolve({ ok: true, data: body.data })
              } else {
                writeAppLog(
                  'warn',
                  'tools.api.response',
                  `${method} ${url} → ${status} ${body.code || ''} (missing data)`,
                  { method, url, status, code: body.code, raw: raw.slice(0, 500) },
                )
                resolve({
                  ok: false,
                  status,
                  error: body.code || 'internal',
                  message: body.message || 'missing data field',
                })
              }
            } catch {
              writeAppLog(
                'warn',
                'tools.api.response',
                `${method} ${url} → ${status} (malformed JSON)`,
                { method, url, status, raw: raw.slice(0, 500) },
              )
              resolve({ ok: false, status, error: 'internal', message: 'malformed JSON' })
            }
            return
          }
          try {
            const body = JSON.parse(raw) as { code?: string; error?: string; message?: string }
            writeAppLog(
              'warn',
              'tools.api.response',
              `${method} ${url} → ${status} ${body.code || body.error || ''}`,
              {
                method,
                url,
                status,
                code: body.code || body.error,
                message: body.message,
                raw: raw.slice(0, 500),
              },
            )
            resolve({
              ok: false,
              status,
              error: body.code || body.error || `http_${status}`,
              message: body.message,
            })
          } catch {
            writeAppLog(
              'warn',
              'tools.api.response',
              `${method} ${url} → ${status} (non-JSON error body)`,
              { method, url, status, raw: raw.slice(0, 500) },
            )
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) => {
      writeAppLog('warn', 'tools.api.error', `${method} ${url} network error`, {
        method,
        url,
        error: err.message,
      })
      resolve({ ok: false, status: 0, error: 'network_error', message: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      writeAppLog('warn', 'tools.api.error', `${method} ${url} timeout`, { method, url })
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

export function listTools(): Promise<ToolsResult<{ tools: ToolEntry[] }>> {
  return consoleHttpRequest<{ tools: ToolEntry[] }>('GET', TOOLS_PREFIX)
}

export function getTool(name: string): Promise<ToolsResult<ToolEntry>> {
  if (!name || name.includes('/')) {
    return Promise.resolve({
      ok: false,
      status: 400,
      error: 'bad_request',
      message: 'invalid tool name',
    })
  }
  return consoleHttpRequest<ToolEntry>('GET', `${TOOLS_PREFIX}/${encodeURIComponent(name)}`)
}

export function patchTool(
  name: string,
  patch: ToolPatchPayload,
): Promise<ToolsResult<ToolEntry>> {
  if (!name || name.includes('/')) {
    return Promise.resolve({
      ok: false,
      status: 400,
      error: 'bad_request',
      message: 'invalid tool name',
    })
  }
  return consoleHttpRequest<ToolEntry>(
    'PATCH',
    `${TOOLS_PREFIX}/${encodeURIComponent(name)}`,
    patch,
  )
}

export interface SessionMetricsContextWindow {
  used: number
  limit: number
  history: number
  tool_results: number
  system_prompt: number
}

export interface SessionMetricsPerModel {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  thinking_tokens: number
  llm_calls: number
}

export interface SessionMetricsSubAgent {
  agent_run_id: string
  agent_id: string
  agent_type: string // sync | coordinator — runtime execution shape
  /** LLM-facing dispatch label (writer / researcher / freelancer / ...).
   *  Distinct from agent_type which returns "sync" for every leaf and
   *  is useless for dashboard disambiguation. Optional — empty for
   *  legacy rows or coordinator-tier agents. */
  subagent_type?: string
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

export interface SessionMetricsStats {
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

export type SessionMetricsResult =
  | { ok: true; data: SessionMetricsStats }
  | { ok: false; status: number; error: string; message?: string }

/**
 * GET /api/v1/sessions/{session_id}/metrics on the Console port.
 *
 * Returns `{ ok: true, data }` on 200 OK. Otherwise resolves with
 * `{ ok: false, status, error }` — the API doc enumerates
 * `bad_request` / `session_not_found` / `method_not_allowed` /
 * `internal`. `session_not_found` is the common case for sessions
 * that haven't recorded a single LLM call yet (which means the
 * engine never created a Tracker for them). Callers should treat
 * `session_not_found` as "no data yet", not as a hard error.
 */
// ─── Artifact Content API ───────────────────────────────────────────────
//
// GET /api/v1/artifacts/{id}/content — raw bytes. Used by the rich-preview
// pipeline: main process pulls bytes, writes them to a temp file, then
// hands the path to the existing files:read IPC which dispatches to
// mammoth / pdf-parse / etc.
//
// Returns { ok, buffer, mimeType, fileName, error } shaped so callers can
// take the bytes directly without parsing JSON. Empty buffer + ok=false
// surfaces 404 / 5xx from the engine.

export type ArtifactContentResult =
  | { ok: true; buffer: Buffer; mimeType?: string; fileName?: string }
  | { ok: false; status: number; error: string; message?: string }

export function fetchArtifactContent(artifactId: string): Promise<ArtifactContentResult> {
  return new Promise((resolve) => {
    if (!artifactId || artifactId.includes('/')) {
      resolve({ ok: false, status: 400, error: 'bad_request', message: 'invalid artifact_id' })
      return
    }
    const path = `/api/v1/artifacts/${encodeURIComponent(artifactId)}/content`
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path,
        method: 'GET',
        // Accept any content-type — these are binaries.
        headers: { Accept: '*/*' },
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const status = res.statusCode || 0
          if (status !== 200) {
            const raw = Buffer.concat(chunks).toString('utf-8')
            resolve({
              ok: false,
              status,
              error: `http_${status}`,
              message: raw.slice(0, 200),
            })
            return
          }
          const buffer = Buffer.concat(chunks)
          const mimeType = (res.headers['content-type'] as string | undefined) || ''
          // RFC 5987 ext-value filename* — undo the percent-encoding so the
          // renderer / OS gets the original utf-8 name (e.g. 中文.docx).
          let fileName: string | undefined
          const disp = (res.headers['content-disposition'] as string | undefined) || ''
          // filename*=UTF-8''...
          const extMatch = /filename\*=UTF-8''([^;]+)/i.exec(disp)
          if (extMatch) {
            try {
              fileName = decodeURIComponent(extMatch[1])
            } catch {
              fileName = extMatch[1]
            }
          } else {
            const plainMatch = /filename="?([^";]+)"?/i.exec(disp)
            if (plainMatch) fileName = plainMatch[1]
          }
          resolve({ ok: true, buffer, mimeType, fileName })
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, status: 0, error: 'network_error', message: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    req.end()
  })
}

export function getSessionMetrics(sessionId: string): Promise<SessionMetricsResult> {
  return new Promise((resolve) => {
    if (!sessionId || sessionId.includes('/')) {
      resolve({ ok: false, status: 400, error: 'bad_request', message: 'invalid session_id' })
      return
    }
    const path = `${METRICS_PREFIX}/${encodeURIComponent(sessionId)}/metrics`
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          if (status === 200) {
            try {
              const data = JSON.parse(raw) as SessionMetricsStats
              resolve({ ok: true, data })
            } catch {
              resolve({ ok: false, status, error: 'internal', message: 'malformed JSON' })
            }
            return
          }
          try {
            const body = JSON.parse(raw) as { error?: string; message?: string }
            resolve({
              ok: false,
              status,
              error: body.error || `http_${status}`,
              message: body.message,
            })
          } catch {
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, status: 0, error: 'network_error', message: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    req.end()
  })
}
