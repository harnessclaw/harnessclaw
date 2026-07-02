import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProviderLogo } from '@/components/common/ProviderLogo'
import { WelcomeShaderBackground } from './WelcomeShaderBackground'
import emmaAvatar from '@/assets/emma-avatar.svg'
import emmaText from '@/assets/emma-text.svg'
import welcomeHeading from '@/assets/welcome-heading.svg'
import welcomeFileChip from '@/assets/welcome-file-chip.svg'
import {
  AGENT_PROVIDER_KEYS,
  MANAGED_PROVIDER_KEYS,
  PROVIDER_DEFAULT_BASES,
  PROVIDER_DISPLAY_NAMES,
  buildAppModelConfig,
  createEmptyProviderConfig,
  getEffectiveEngineType,
  type ManagedProviderKey,
  type ProtocolProviderKey,
  type ProviderConfig,
} from '@/lib/providers'

type StartupOverlayState = 'checking' | 'setup' | 'hidden'
type StageKey = 'intro' | 'connection'

interface SetupDraft {
  engineMode: ManagedProviderKey | null
  apiBase: string
  apiKey: string
  modelId: string
  modelGroup: string
  // Only meaningful when engineMode === 'custom' (mirrors Settings'
  // protocol toggle inside the custom-provider editor).
  protocol: ProtocolProviderKey
}

type ConfigRecord = Record<string, unknown>

const WORKSPACE_ROOT = '~/.harnessclaw/workspace'
const FIRST_RUN_DONE_STORAGE_KEY = 'harnessclaw-first-run-complete'

// Provider list shown in the connection dropdown — the full managed
// set minus `custom` (first-run keeps it simple; custom gateways are
// configured later in Settings > Models).
const ONBOARDING_PROVIDER_KEYS: ManagedProviderKey[] = MANAGED_PROVIDER_KEYS.filter(
  (key) => key !== 'custom',
)

// Number of intro feature categories shown in the left nav. Content
// lives under `welcome.intro.categories.<index>` in both locale files.
// Placeholder copy for now — product will supply real data later.
const INTRO_CATEGORY_COUNT = 5

function asRecord(value: unknown): ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ConfigRecord)
    : {}
}

function getDefaultApiBase(key: ManagedProviderKey | null): string {
  if (!key) return ''
  return PROVIDER_DEFAULT_BASES[key] || ''
}

// Build a complete providers map seeded with empty configs, then
// stamp the user's chosen provider with the welcome-flow inputs. The
// shape matches what `Settings > Models` persists, so the entry
// surfaces in Settings immediately after onboarding.
function buildWelcomeProviders(
  draft: SetupDraft,
): Record<ManagedProviderKey, ProviderConfig> {
  const providers = MANAGED_PROVIDER_KEYS.reduce((acc, key) => {
    acc[key] = createEmptyProviderConfig(key)
    return acc
  }, {} as Record<ManagedProviderKey, ProviderConfig>)

  const key = draft.engineMode
  if (!key) return providers

  const apiBase = draft.apiBase.trim() || getDefaultApiBase(key)
  const apiKey = draft.apiKey.trim()
  const modelId = draft.modelId.trim()
  const modelGroup = draft.modelGroup.trim()

  // Save only the user-configured model. Settings page will:
  // 1. Show this model at the top of the list (as a custom/user-added model)
  // 2. Allow user to click "Fetch from Provider" to load the full registry
  // 3. Mark this model as enabled/active since it was the onboarding choice
  //
  // This approach handles both scenarios:
  // - User entered a standard model (e.g. "deepseek-v4-pro") → shows in list, can fetch more
  // - User entered a custom model ID → preserved as user's choice, can fetch more later
  const models = modelId
    ? [{ id: modelId, enabled: true, ...(modelGroup ? { group: modelGroup } : {}) }]
    : []

  providers[key] = {
    ...providers[key],
    apiKey,
    apiBase: apiBase || providers[key].apiBase,
    model: modelId || null,
    models,
    protocol: key === 'anthropic' ? 'anthropic' : key === 'custom' ? draft.protocol : 'openai',
    enabled: true,
  }
  return providers
}

// YAML keywords that would force the serializer to quote a plain
// string key (YAML 1.1 booleans + null tokens). Numeric / hex / inf /
// nan are caught by the regex below.
const YAML_RESERVED_KEYWORDS = new Set([
  'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', 'null', '~',
])

// Build a YAML-safe endpoint identifier. The engine round-trips
// endpoint names through YAML; any name that parses as a number,
// boolean, null, or contains special chars will be wrapped in quotes
// (e.g. `"1":`). To keep the engine yaml visually clean — and to
// match the unquoted style of providers configured via Settings >
// Models (e.g. `xopglm51:`) — we prepend the provider key when the
// raw modelId would trigger quoting. Plain identifier-shaped model
// names pass through unchanged.
//
// We deliberately do NOT validate or reject numeric inputs in the
// UI; user-typed model ids stay verbatim in the `model` field. Only
// the endpoint *key* (which is renderer-controlled) gets normalized.
function safeEndpointName(key: ManagedProviderKey, modelId: string): string {
  const ok = /^[A-Za-z_][A-Za-z0-9_.\-]*$/.test(modelId)
    && !YAML_RESERVED_KEYWORDS.has(modelId.toLowerCase())
  return ok ? modelId : `${key}-${modelId}`
}

// Best-effort engine-side provider + endpoint registration.
//
// Mirrors the `schedulePatchProviderCredentials` / `ensureProviderExists`
// / `hotCreateEndpoint` flow in SettingsPage:
//   1. PATCH /providers/{key} (api_key/base_url). On 404/update_failed,
//      fall back to POST /providers to create it.
//   2. POST /providers/{key}/endpoints with `{name=<yaml-safe>, model=
//      modelId, disabled:false}`. On "already exists" 400, PATCH
//      disabled=false to make sure the endpoint isn't paused.
//   3. PUT /agent — append `${key}:${endpointName}` to the fallback
//      chain so the dispatcher actually routes to the new endpoint.
//
// We swallow 404 (API not mounted because chain<2 entries) and status 0
// (network) silently — the engine picks the values up from app-config
// on next start.
async function registerEngineProvider(
  key: ManagedProviderKey,
  cfg: ProviderConfig,
): Promise<void> {
  const baseUrl = cfg.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key] || ''
  const apiKey = cfg.apiKey.trim()
  const modelId = cfg.model?.trim() || ''
  // Find the matching ProviderModelEntry to pull its group (set via
  // buildWelcomeProviders); fall back to empty if missing.
  const modelEntry = cfg.models?.find((m) => m.id === modelId)
  const group = modelEntry?.group?.trim() || ''
  if (!apiKey && !baseUrl) return

  try {
    // ── 1. Ensure provider exists on the engine ────────────────────
    let providerReady = false
    const patchRes = await window.agentApi.patchProvider(key, {
      api_key: apiKey,
      base_url: baseUrl,
    })
    if (patchRes.ok) {
      providerReady = true
    } else if (patchRes.status === 404 || patchRes.status === 0) {
      return
    } else {
      const engineType = getEffectiveEngineType(key, cfg)
      const createRes = await window.agentApi.createProvider({
        name: key,
        type: engineType,
        ...(baseUrl ? { base_url: baseUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      })
      if (createRes.ok) {
        providerReady = true
      } else if (createRes.status === 404 || createRes.status === 0) {
        return
      } else if (createRes.status === 400 && /exist/i.test(createRes.message || '')) {
        // "already exists" race — retry PATCH and treat as ready.
        await window.agentApi.patchProvider(key, {
          api_key: apiKey,
          base_url: baseUrl,
        })
        providerReady = true
      }
    }
    if (!providerReady || !modelId) return

    // ── 2. Register the model as an endpoint under that provider ───
    // Endpoint NAME is the YAML-safe identifier; MODEL is the raw
    // user input. They're identical for well-shaped ids (matching
    // SettingsPage's `xopglm51` pattern) and differ only when the
    // user-typed model is YAML-ambiguous (e.g. pure digits).
    const endpointName = safeEndpointName(key, modelId)
    const epRes = await window.agentApi.createEndpoint(key, {
      name: endpointName,
      model: modelId,
      disabled: false,
      ...(group ? { group } : {}),
    })
    let endpointReady = epRes.ok
    if (!epRes.ok) {
      if (epRes.status === 404 || epRes.status === 0) return
      // Probably "already exists" — verify via GET, then unpause it.
      const list = await window.agentApi.listEndpoints(key)
      if (list.ok && list.data.endpoints.some((e) => e.name === endpointName)) {
        endpointReady = true
        await window.agentApi.patchEndpoint(key, endpointName, { disabled: false })
      } else {
        return
      }
    }
    if (!endpointReady) return

    // ── 3. Append to fallback chain so the dispatcher routes here ──
    const chain = await window.agentApi.getFallbackChain()
    if (!chain.ok) {
      console.error('[WelcomeModal] getFallbackChain failed:', chain)
      return
    }
    console.log('[WelcomeModal] Current chain:', chain.data.chain)

    const chainRef = `${key}:${endpointName}`
    const legacyRef = `${key}.${endpointName}`

    // Check if this exact reference is already in the chain
    if (chain.data.chain.includes(chainRef) || chain.data.chain.includes(legacyRef)) {
      console.log('[WelcomeModal] Chain already includes', chainRef, '- skipping update')
      return
    }

    // Replace any existing endpoint for this provider (to handle re-onboarding
    // with a different model) and add the new one to the front of the chain.
    // This ensures the onboarding choice becomes the primary/default.
    const providerPrefix = `${key}:`
    const legacyProviderPrefix = `${key}.`
    const filteredChain = chain.data.chain.filter(
      (ref) => !ref.startsWith(providerPrefix) && !ref.startsWith(legacyProviderPrefix)
    )
    console.log('[WelcomeModal] Filtered chain (removed', key, '):', filteredChain)
    console.log('[WelcomeModal] New chain:', [chainRef, ...filteredChain])

    const updateResult = await window.agentApi.updateFallbackChain([chainRef, ...filteredChain])
    console.log('[WelcomeModal] updateFallbackChain result:', updateResult)
  } catch {
    // Best-effort — swallow.
  }
}

function buildAppConfig(previous: ConfigRecord, draft: SetupDraft): ConfigRecord {
  if (!draft.engineMode) return previous
  const providers = buildWelcomeProviders(draft)
  const base = buildAppModelConfig(previous, providers, draft.engineMode)

  // buildAppModelConfig already filled modelProviders + agents.defaults
  // (provider + model). Do not silently overwrite workspace /
  // maxToolIterations / reasoningEffort: the profile step is gone,
  // so preserving existing Agent defaults keeps onboarding from
  // clobbering Settings -> Agents choices.
  const baseAgents = asRecord(base.agents)
  const baseDefaults = asRecord(baseAgents.defaults)
  const onboarding = asRecord(previous.onboarding)

  return {
    ...base,
    agents: {
      ...baseAgents,
      defaults: {
        ...baseDefaults,
      },
    },
    onboarding: {
      ...onboarding,
      version: 1,
      completedAt: new Date().toISOString(),
      engineMode: draft.engineMode,
      profile: null,
    },
  }
}

export function WelcomeModal() {
  const { t } = useTranslation()

  // Intro feature categories shown in stage 1. Each category has its own
  // set of conversation examples.
  const introCategories: Array<{
    key: string
    label: string
    cards: Array<{ title: string; description: string | string[] }>
  }> = useMemo(() => {
    return Array.from({ length: INTRO_CATEGORY_COUNT }, (_, i) => {
      const categoryCards = (t(`welcome.intro.categories.${i}.cards`, { returnObjects: true }) as Array<{
        title: string
        description: string | string[]
      }>) || []
      return {
        key: `cat${i}`,
        label: t(`welcome.intro.categories.${i}.label`),
        cards: Array.isArray(categoryCards) ? categoryCards : [],
      }
    })
  }, [t])

  // Provider dropdown options for the connection stage — managed set
  // minus custom. Display names come from the shared providers module.
  const providerOptions: Array<{ key: ManagedProviderKey; title: string }> = useMemo(
    () => ONBOARDING_PROVIDER_KEYS.map((key) => ({
      key,
      title: PROVIDER_DISPLAY_NAMES[key],
    })),
    [],
  )

  const stages: Array<{ key: StageKey }> = useMemo(
    () => [{ key: 'intro' }, { key: 'connection' }],
    [],
  )

  const [overlayState, setOverlayState] = useState<StartupOverlayState>(() => {
    if (typeof window === 'undefined') return 'checking'
    return window.localStorage.getItem(FIRST_RUN_DONE_STORAGE_KEY) === 'true' ? 'hidden' : 'checking'
  })
  const [stageIndex, setStageIndex] = useState(0)
  const [draft, setDraft] = useState<SetupDraft>({
    engineMode: null,
    apiBase: '',
    apiKey: '',
    modelId: '',
    modelGroup: '',
    protocol: 'openai',
  })
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const runStartupGate = async () => {
      const isFirst = await window.appBridge.isFirstLaunch()
      if (cancelled) return

      if (isFirst) {
        window.localStorage.removeItem(FIRST_RUN_DONE_STORAGE_KEY)
        setOverlayState('setup')
        return
      }

      window.localStorage.setItem(FIRST_RUN_DONE_STORAGE_KEY, 'true')
      setOverlayState('hidden')
    }

    void runStartupGate()
    return () => {
      cancelled = true
    }
  }, [])

  const stageDone = useMemo(() => ({
    intro: true,
    // Connection is "complete" once a provider is chosen along with a
    // key + model id. The provider picker now lives in this same stage.
    connection: Boolean(draft.engineMode && draft.apiKey.trim() && draft.modelId.trim()),
  }), [draft])

  const allStagesDone = stageDone.connection
  const currentStage = stages[stageIndex]
  const currentStageDone = stageDone[currentStage.key]
  const isLastStage = stageIndex === stages.length - 1


  const handleNext = () => {
    if (!currentStageDone) return
    if (!isLastStage) {
      setErrorMessage(null)
      setStageIndex((i) => i + 1)
    }
  }

  const handleBack = () => {
    if (stageIndex === 0) return
    setErrorMessage(null)
    setStageIndex((i) => i - 1)
  }

  const handleFinish = async () => {
    if (!allStagesDone || submitting || !draft.engineMode) return
    const engineMode = draft.engineMode
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const finalDraft: SetupDraft = {
        ...draft,
        apiBase: draft.apiBase.trim() || getDefaultApiBase(engineMode),
        apiKey: draft.apiKey.trim(),
        modelId: draft.modelId.trim(),
        modelGroup: draft.modelGroup.trim(),
      }
      const currentAppConfig = asRecord(await window.appConfig.read())
      // Persist the welcome-flow inputs into appConfig using the same
      // shape Settings > Models reads, so the configured provider
      // surfaces immediately after onboarding. Engine YAML is owned
      // by the Providers Management API and not touched here.
      const appResult = await window.appConfig.save(buildAppConfig(currentAppConfig, finalDraft))
      if (!appResult.ok) {
        throw new Error(appResult.error || t('welcome.saveError'))
      }

      // Best-effort engine-side registration via Providers Management API.
      // Wait for it to complete so Agent settings immediately reflect the
      // onboarding choice when the user navigates there. If the API is
      // unavailable (404/network), registerEngineProvider returns early.
      const providers = buildWelcomeProviders(finalDraft)
      await registerEngineProvider(engineMode, providers[engineMode])

      // Always set the local flag regardless of markLaunched result so a
      // failed markLaunched doesn't leave the user re-seeing onboarding.
      await window.appBridge.markLaunched()
      window.localStorage.setItem(FIRST_RUN_DONE_STORAGE_KEY, 'true')

      setOverlayState('hidden')
    } catch (error) {
      setErrorMessage(String((error as Error)?.message || error))
      setSubmitting(false)
    }
  }

  // Skip onboarding entirely: discard whatever's in the draft, write no
  // provider config, just mark first-run complete and drop into the
  // home screen. Users configure providers later in Settings > Models.
  const handleSkip = async () => {
    if (submitting) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const launched = await window.appBridge.markLaunched()
      if (launched.ok) {
        window.localStorage.setItem(FIRST_RUN_DONE_STORAGE_KEY, 'true')
      }
      setOverlayState('hidden')
    } catch (error) {
      setErrorMessage(String((error as Error)?.message || error))
      setSubmitting(false)
    }
  }

  if (overlayState !== 'setup') return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
    >
      <div className="relative flex h-[440px] max-h-[calc(100vh-3rem)] w-[650px] max-w-full flex-col overflow-hidden rounded-[22px] border border-border bg-white shadow-2xl">
        {/* Orange shader panel — inset with white margins (top/sides); its
            rounded corners clip the shader so the gradient is "framed" in the
            upper part with white around it. The footer below sits on the white
            card, giving the white bottom strip. */}
        <div className="relative mx-1 mt-1 mb-[14px] flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          <WelcomeShaderBackground className="pointer-events-none absolute inset-0 h-full w-full" />

          {/* Title area */}
          <div className="relative z-10 flex h-[56px] shrink-0 items-center justify-center">
            {currentStage.key === 'intro' ? (
              <img
                src={welcomeHeading}
                alt={t('welcome.intro.heading')}
                className="h-9 object-contain"
              />
            ) : (
              <h2
                id="first-run-title"
                className="px-12 text-center text-lg font-semibold leading-snug text-foreground"
              >
                {t('welcome.stages.connection')}
              </h2>
            )}
          </div>

          <div
            className={cn(
              'relative z-10 min-h-0 flex-1 overflow-hidden px-6',
              currentStage.key === 'intro' ? 'pb-3 pt-[43px]' : 'py-3'
            )}
          >
            <div
              className={cn(
                'mx-auto h-full w-full',
                currentStage.key === 'intro' ? 'max-w-full' : 'max-w-full'
              )}
            >
            {currentStage.key === 'intro' && (
              <IntroShowcase categories={introCategories} />
            )}

            {currentStage.key === 'connection' && (
              <div className="grid gap-3">
                <ProviderSelect
                  label={t('welcome.providerLabel')}
                  placeholder={t('welcome.providerPlaceholder')}
                  options={providerOptions}
                  value={draft.engineMode}
                  onChange={(key) =>
                    setDraft((d) => ({
                      ...d,
                      engineMode: key,
                      apiBase: '',
                      protocol: key === 'anthropic' ? 'anthropic' : 'openai',
                    }))
                  }
                />
                <FormField
                  label="API Base URL"
                  value={draft.apiBase}
                  placeholder={getDefaultApiBase(draft.engineMode) || 'https://spark-api-open.xf-yun.com/agent/v1'}
                  onChange={(v) => setDraft((d) => ({ ...d, apiBase: v }))}
                />
                <FormField
                  label="API Key"
                  value={draft.apiKey}
                  placeholder="sk-"
                  type="password"
                  required
                  onChange={(v) => setDraft((d) => ({ ...d, apiKey: v }))}
                />
                <FormField
                  label="Model ID"
                  value={draft.modelId}
                  placeholder="model-id，例：gpt-4o-mini 或 claude-sonnet-4"
                  required
                  onChange={(v) => setDraft((d) => ({ ...d, modelId: v }))}
                />
              </div>
            )}

            {errorMessage && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                {errorMessage}
              </div>
            )}
            </div>
          </div>
        </div>

        <footer className="relative z-10 grid grid-cols-3 items-center px-7 pb-4 pt-2">
          {/* Left: back (plain text link, hidden on first stage) */}
          <div className="flex justify-start">
            {stageIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="text-sm font-medium text-foreground/70 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('welcome.back')}
              </button>
            )}
          </div>

          {/* Center: page dots — 8×8, 10px gap; #DADEE4 inactive, orange active */}
          <div className="flex justify-center gap-2.5">
            {stages.map((stage, index) => (
              <span
                key={stage.key}
                className={cn(
                  'h-2 w-2 rounded-full transition-colors',
                  index === stageIndex ? 'bg-orange-400' : 'bg-[#DADEE4]'
                )}
                aria-hidden="true"
              />
            ))}
          </div>

          {/* Right: primary action. Page 1 → plain-text "下一步"; last page →
              dark filled button. NB: design labels the last-page dark button
              "跳过", but we keep it wired to Finish (saves the entered config).
              Confirm with product whether it should skip instead. */}
          <div className="flex items-center justify-end gap-3">
            {isLastStage ? (
              <>
                {/* Skip (secondary), left of the primary action */}
                <button
                  type="button"
                  onClick={() => void handleSkip()}
                  disabled={submitting}
                  className="text-sm font-medium text-foreground/70 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('welcome.skip')}
                </button>
                {/* Primary: finish + enter app (saves the entered config) */}
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={!allStagesDone || submitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-5 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t('welcome.submitting')}</span>
                    </>
                  ) : (
                    <span>{t('welcome.finish')}</span>
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={!currentStageDone}
                className="text-sm font-medium text-foreground transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('welcome.next')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

// Stage 1 feature showcase: a left category nav + a right chat preview
// (Emma avatar + conversation bubbles). Content is placeholder (all
// categories share one set) until product supplies real per-category copy.
function IntroShowcase({
  categories,
}: {
  categories: Array<{ key: string; label: string; cards: Array<{ title: string; description: string | string[] }> }>
}) {
  const [activeIndex, setActiveIndex] = useState(0)

  // Single fixed sample conversation per the design. Category clicks only
  // highlight the nav; the chat content is placeholder (one fake set).
  const sample = categories[0]?.cards?.[0]
  const sampleReplies = sample
    ? (Array.isArray(sample.description) ? sample.description : [sample.description])
    : []

  return (
    <div className="flex h-full gap-5">
      {/* Left nav */}
      <nav className="flex shrink-0 flex-col gap-3">
        {categories.map((cat, index) => {
          const isActive = index === activeIndex
          const isLast = index === categories.length - 1
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveIndex(index)}
              style={{ fontFamily: 'Source Han Sans CN', fontVariationSettings: '"opsz" auto' }}
              className={cn(
                'flex h-9 flex-col justify-center whitespace-nowrap rounded-md px-3 text-left text-[16px] font-medium leading-normal text-[#4E5969] shadow-[0px_1px_0px_0px_rgba(0,0,0,0.15)] transition-colors',
                isLast ? 'w-[104px]' : 'w-[88px]',
                isActive ? 'bg-[#DADEE4]' : 'bg-white hover:bg-[#EDEFF1]'
              )}
            >
              {cat.label}
            </button>
          )
        })}
      </nav>

      {/* Right: chat preview — one fixed sample conversation */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {sample && (
          <>
            {/* User question bubble (right-aligned) */}
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-[#FDEBDA] px-4 py-2.5 text-[13px] leading-6 text-[#333333]">
                {sample.title}
              </div>
            </div>
            {/* Emma answers: avatar shown once, bubbles + file chip stacked */}
            <div className="flex items-start gap-2">
              <div className="flex shrink-0 flex-col items-center gap-1">
                <img
                  src={emmaAvatar}
                  alt="Emma"
                  className="h-9 w-9 rounded-full object-cover"
                />
                <img src={emmaText} alt="EMMA" className="h-3 object-contain" />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                {sampleReplies.map((reply, i) => (
                  <div
                    key={i}
                    className="w-fit max-w-full rounded-2xl bg-white/90 px-4 py-2.5 text-[13px] leading-6 text-[#333333] shadow-sm"
                  >
                    {reply}
                  </div>
                ))}
                {/* Sample deliverable file chip */}
                <img src={welcomeFileChip} alt="评审文件.doc" className="h-9 w-[218px]" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
// __PROVIDER_SELECT_PLACEHOLDER__
// Provider dropdown for the connection stage. A lightweight custom
// popover (not a native <select>) so it matches the modal's styling and
// shows a check on the active provider.
function ProviderSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  options: Array<{ key: ManagedProviderKey; title: string }>
  value: ManagedProviderKey | null
  onChange: (key: ManagedProviderKey) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const selected = options.find((o) => o.key === value) || null

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="block">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
        <span>{label}</span>
        <span className="text-red-500">*</span>
      </div>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-white/60 bg-white/80 px-3.5 py-2 text-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        >
          <div className="flex items-center gap-2">
            {selected && <ProviderLogo provider={selected.key} size={20} />}
            <span className={cn(selected ? 'text-foreground' : 'text-muted-foreground/60')}>
              {selected ? selected.title : placeholder}
            </span>
          </div>
          <ChevronDown size={15} className="text-muted-foreground" />
        </button>
        {open && (
          <div className="absolute z-10 mt-1 max-h-[240px] w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
            {options.map((option) => {
              const isSelected = option.key === value
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    onChange(option.key)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ProviderLogo provider={option.key} size={20} />
                    <span>{option.title}</span>
                  </div>
                  {isSelected && <Check size={14} strokeWidth={3} />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FormField({
  label,
  hint,
  value,
  placeholder,
  onChange,
  type = 'text',
  required,
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
  required?: boolean
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
        <span>{label}</span>
        {required && <span className="text-red-500">*</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-lg border border-white/60 bg-white/80 px-3.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      {hint && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </label>
  )
}

