// Shared provider config primitives — used by Settings > Models AND
// the first-run WelcomeModal so both write the same shape under
// `appConfig.modelProviders.<key>` and resolve engine `type` the
// same way.

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ProviderModelEntry {
  id: string
  name?: string
  group?: string
  tags?: string[]
  // Whether this model is enabled for the provider. Multi-select: any
  // number of models can be enabled at once. The engine still receives
  // a single "active" model (`ProviderConfig.model`) — typically the
  // first enabled entry — but the renderer keeps the full enabled set
  // so users can pick from a subset.
  enabled?: boolean
  // Per-million-token pricing the user has configured for this model.
  currency?: string
  inputPrice?: number
  outputPrice?: number
}

export interface ProviderConfig {
  displayName?: string
  apiKey: string
  apiBase: string | null
  model: string | null
  models: ProviderModelEntry[]
  protocol: 'openai' | 'anthropic'
  // Engine-side `type` for `POST/PATCH /providers`. Independent from
  // `protocol` (which is renderer-only and only meaningful for
  // `custom`). Defaults to PROVIDER_ENGINE_TYPES[key]; the user can
  // override per-provider via the API-地址 row dropdown. See engine
  // docs (`type` enum: openai | anthropic | gemini).
  engineType?: ProviderType
  extraHeaders: Record<string, string> | null
  raw: Record<string, unknown>
  enabled?: boolean
}

// Managed provider keys MUST match the `provider` field returned by the
// Model Registry API (see harnessclaw-engine/docs/api/models-registry-api.md
// and internal/provider/registry/default-manifest.yaml).
export type ManagedProviderKey =
  | 'xunfei'
  | 'anthropic'
  | 'openai'
  | 'gpt-image'
  | 'google'
  | 'qwen'
  | 'minimax'
  | 'zhipu'
  | 'moonshot'
  | 'doubao'
  | 'deepseek'
  | 'custom'

export type ProtocolProviderKey = 'anthropic' | 'openai'
export type AgentProviderKey = Exclude<ManagedProviderKey, 'gpt-image' | 'doubao'>
export type ProviderType = 'openai' | 'anthropic' | 'gemini'

// ─── Constants ─────────────────────────────────────────────────────────────

export const MANAGED_PROVIDER_KEYS: ManagedProviderKey[] = [
  'xunfei',
  'anthropic',
  'openai',
  'google',
  'qwen',
  'minimax',
  'zhipu',
  'moonshot',
  'doubao',
  'deepseek',
  'custom',
]

export const IMAGE_GENERATION_PROVIDER_KEYS: ReadonlyArray<Extract<ManagedProviderKey, 'gpt-image' | 'doubao'>> = [
  'gpt-image',
  'doubao',
]

export const AGENT_PROVIDER_KEYS: AgentProviderKey[] = MANAGED_PROVIDER_KEYS.filter(
  (key): key is AgentProviderKey => !IMAGE_GENERATION_PROVIDER_KEYS.includes(key as 'gpt-image' | 'doubao')
)

export const PROVIDER_DISPLAY_NAMES: Record<ManagedProviderKey, string> = {
  xunfei: '科大讯飞 Spark',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'gpt-image': 'GPT Image',
  google: 'Google',
  qwen: '通义千问',
  minimax: 'MiniMax',
  zhipu: '智谱 GLM',
  moonshot: 'Kimi',
  deepseek: 'DeepSeek',
  doubao: 'Doubao Seedream',
  custom: 'Custom',
}

export const PROVIDER_DEFAULT_BASES: Record<ManagedProviderKey, string> = {
  xunfei: 'https://spark-api-open.xf-yun.com/agent',
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'gpt-image': 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  minimax: 'https://api.minimax.chat',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  moonshot: 'https://api.moonshot.cn',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  deepseek: 'https://api.deepseek.com',
  custom: '',
}

const PROVIDER_MODEL_PRESETS: Partial<Record<ManagedProviderKey, ProviderModelEntry[]>> = {
  openai: [
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      group: 'GPT Image',
      tags: ['vision', 'image_generation'],
    },
  ],
  // Legacy hidden bucket for previously persisted appConfig/provider rows.
  // New GPT Image configuration is presented under the OpenAI provider.
  'gpt-image': [
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      group: 'gpt-image',
      tags: ['vision', 'image_generation'],
    },
  ],
  doubao: [
    {
      id: 'doubao-seedream-5-0-260128',
      name: 'Doubao Seedream 5.0',
      group: 'seedream-5',
      tags: ['vision', 'image_generation'],
    },
    {
      id: 'doubao-seedream-5-0-lite-260128',
      name: 'Doubao Seedream 5.0 Lite',
      group: 'seedream-5',
      tags: ['vision', 'image_generation'],
    },
    {
      id: 'doubao-seedream-4-5-251128',
      name: 'Doubao Seedream 4.5',
      group: 'seedream-4',
      tags: ['vision', 'image_generation'],
    },
    {
      id: 'doubao-seedream-4-0-250828',
      name: 'Doubao Seedream 4.0',
      group: 'seedream-4',
      tags: ['vision', 'image_generation'],
    },
  ],
}

// Engine `type` to send to `POST/PATCH /providers`. See
// harnessclaw-engine/docs/api/providers-management-api.md (`type` enum:
// openai / anthropic / gemini).
//
// OpenAI-compatible vendors (DeepSeek, Kimi=moonshot, GLM=zhipu, MiniMax,
// 讯飞=xunfei, Doubao image generation) all use `openai` and only differ by
// `base_url`. Google goes to `gemini` — NOT `google`. `gpt-image` remains a
// legacy hidden bucket; new GPT Image models are listed under OpenAI and are
// kept out of Agent chat routing by their `image_generation` capability.
// `custom` is resolved at call time from the user-selected protocol
// (openai | anthropic).
export const PROVIDER_ENGINE_TYPES: Record<
  Exclude<ManagedProviderKey, 'custom'>,
  'openai' | 'anthropic' | 'gemini'
> = {
  xunfei: 'openai',
  anthropic: 'anthropic',
  openai: 'openai',
  'gpt-image': 'openai',
  google: 'gemini',
  qwen: 'openai',
  minimax: 'openai',
  zhipu: 'openai',
  moonshot: 'openai',
  doubao: 'openai',
  deepseek: 'openai',
}

export const ENGINE_TYPE_OPTIONS: ReadonlyArray<'openai' | 'anthropic' | 'gemini'> = [
  'openai',
  'anthropic',
  'gemini',
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function isManagedProviderKey(value: string): value is ManagedProviderKey {
  return MANAGED_PROVIDER_KEYS.includes(value as ManagedProviderKey)
}

export function isAgentProviderKey(value: ManagedProviderKey): value is AgentProviderKey {
  return AGENT_PROVIDER_KEYS.includes(value as AgentProviderKey)
}

export function isImageGenerationProviderKey(value: ManagedProviderKey): boolean {
  return IMAGE_GENERATION_PROVIDER_KEYS.includes(value as 'gpt-image' | 'doubao')
}

export function getProviderDefaultModels(key: ManagedProviderKey): ProviderModelEntry[] {
  return (PROVIDER_MODEL_PRESETS[key] ?? []).map((entry) => ({
    ...entry,
    ...(entry.tags ? { tags: [...entry.tags] } : {}),
  }))
}

// Resolve the effective engine type for a provider:
//   1. explicit cfg.engineType override (user toggled the badge)
//   2. cfg.protocol when key === 'custom' (the legacy "OpenAI 协议 /
//      Anthropic 协议" selector)
//   3. the PROVIDER_ENGINE_TYPES default for that vendor
//   4. fallback 'openai'
export function getEffectiveEngineType(
  key: ManagedProviderKey,
  cfg: ProviderConfig,
): 'openai' | 'anthropic' | 'gemini' {
  if (cfg.engineType) return cfg.engineType
  if (key === 'custom') return cfg.protocol
  return PROVIDER_ENGINE_TYPES[key] ?? 'openai'
}

export function createEmptyProviderConfig(key: ManagedProviderKey): ProviderConfig {
  return {
    apiKey: '',
    apiBase: PROVIDER_DEFAULT_BASES[key] || null,
    model: null,
    models: getProviderDefaultModels(key),
    protocol: key === 'anthropic' ? 'anthropic' : 'openai',
    extraHeaders: null,
    raw: {},
  }
}

export function buildAppProviderRaw(next: ProviderConfig): Record<string, unknown> {
  const apiKey = next.apiKey.trim()
  const apiBase = next.apiBase?.trim() || ''
  const model = next.model?.trim() || ''
  const displayName = next.displayName?.trim() || ''

  return {
    ...(displayName ? { displayName } : {}),
    apiKey,
    apiBase,
    model,
    models: next.models,
    protocol: next.protocol,
    ...(next.engineType ? { engineType: next.engineType } : {}),
    extraHeaders: next.extraHeaders ?? null,
    enabled: next.enabled === true,
  }
}

// Determine the engine-level protocol slot a managed provider maps onto.
// - `anthropic` uses the Anthropic Messages protocol.
// - `custom` uses whatever protocol the user toggled.
// - Everyone else (openai, qwen, minimax, zhipu, moonshot, google) is
//   OpenAI-compatible from the engine's perspective.
export function resolveProviderProtocol(
  key: ManagedProviderKey,
  providers: Record<ManagedProviderKey, ProviderConfig>,
): ProtocolProviderKey {
  if (key === 'anthropic') return 'anthropic'
  if (key === 'custom') return providers.custom.protocol
  return 'openai'
}

export function buildAppModelConfig(
  previous: Record<string, unknown>,
  providers: Record<ManagedProviderKey, ProviderConfig>,
  defaultProvider: ManagedProviderKey,
): Record<string, unknown> {
  const agents = asRecord(previous.agents)
  const defaults = asRecord(agents.defaults)
  const modelProviders = asRecord(previous.modelProviders)
  const resolvedDefaultProvider = resolveProviderProtocol(defaultProvider, providers)
  const activeProvider = providers[defaultProvider]
  const modelId = activeProvider.model?.trim() || ''

  const persistedProviders = MANAGED_PROVIDER_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = buildAppProviderRaw(providers[key])
    return acc
  }, {})

  return {
    ...previous,
    modelProviders: {
      ...modelProviders,
      ...persistedProviders,
      defaultSelection: defaultProvider,
    },
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        provider: resolvedDefaultProvider,
        model: modelId ? `${resolvedDefaultProvider}/${modelId}` : null,
      },
    },
  }
}
