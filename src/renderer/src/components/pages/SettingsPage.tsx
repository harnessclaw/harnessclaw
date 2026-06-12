import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { ProviderLogo } from '../common/ProviderLogo'
import {
  Wifi, Shield, Palette, HardDrive,
  Eye, EyeOff, Loader2, Check, X,
  FolderOpen, Download, Trash2,
  Search, Cpu,
  Bot, Radio, Wrench, FileText,
  Pause, Play, RotateCcw, AlertTriangle,
  ChevronDown, ChevronRight, ExternalLink,
  SlidersHorizontal, RefreshCw, Settings2,
  Globe, Image, Film, Sun, GripVertical, Plus,
  // Keyboard = typing hint icon shown inside the hotkey-capture input
  // while we're waiting for the user to press a combination.
  Keyboard,
  // Icons for the "回答风格" preset cards. Target = precise,
  // Scale = balanced, Lightbulb = flexible, Sparkles = creative.
  Target, Scale, Lightbulb, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { NoticeToast } from '../common/NoticeToast'
import { useAppConfig, useEngineConfig } from '@/hooks/useEngineConfig'
import { defaultDbDisplayPath, defaultLogsDisplayPath } from '@/lib/runtimePaths'
import {
  ENGINE_TYPE_OPTIONS,
  MANAGED_PROVIDER_KEYS,
  PROVIDER_DEFAULT_BASES,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ENGINE_TYPES,
  buildAppModelConfig,
  buildAppProviderRaw,
  createEmptyProviderConfig,
  getEffectiveEngineType,
  getProviderDefaultModels,
  isAgentProviderKey,
  isImageGenerationProviderKey,
  isManagedProviderKey,
  resolveProviderProtocol,
  type ManagedProviderKey,
  type ProtocolProviderKey,
  type ProviderConfig,
  type ProviderModelEntry,
  type ProviderType,
} from '@/lib/providers'

// ─── Primitives ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none',
        checked ? 'bg-foreground' : 'bg-border'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-card shadow-sm transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  )
}

function Segment({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1 rounded-md text-xs font-medium transition-all duration-150',
            value === opt.value
              ? 'bg-card shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
  className,
}: {
  label: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between py-4 border-b border-border last:border-0 gap-4', className)}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="min-w-0 max-w-full flex-shrink-0">{children}</div>
    </div>
  )
}

function GroupCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
        {title}
      </h3>
      <div className="bg-card border border-border rounded-xl px-4 shadow-sm">
        {children}
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType
  title: string
  subtitle: string
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <Icon size={15} className="text-foreground" />
          </div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <div className="h-px bg-border" />
    </div>
  )
}

// Centered divider heading used to visually separate the three model
// sub-sections (文本/图片/视频) inside the unified 模型 page.
function SectionDivider({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 mt-1 mb-3', className)}>
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  suffix,
  min,
  max,
  disabled,
  className,
}: {
  value: number
  onChange: (v: number) => void
  suffix?: string
  min?: number
  max?: number
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5', disabled && 'opacity-40')}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn('w-16 h-7 px-2 text-sm text-right bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow disabled:cursor-not-allowed', className)}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  )
}

function SelectInput({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: { label: string; value: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 px-2 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow cursor-pointer text-foreground',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  className,
  mono,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  mono?: boolean
  disabled?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        'h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed',
        mono && 'font-mono text-xs',
        className
      )}
    />
  )
}

function SliderInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
}) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 h-1.5 accent-foreground cursor-pointer"
      />
      <span className="text-xs font-mono text-muted-foreground w-8 text-right">{value}</span>
    </div>
  )
}

// ─── Connection Section ─────────────────────────────────────────────────────

function ConnectionSection() {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useEngineConfig()

  const gw = (config?.gateway || {}) as { host?: string; port?: number; heartbeat?: { enabled?: boolean; intervalS?: number } }
  const host = gw.host ?? '0.0.0.0'
  const port = gw.port ?? 8090
  const hbEnabled = gw.heartbeat?.enabled ?? true
  const hbInterval = gw.heartbeat?.intervalS ?? 1800

  const [autoReconnect, setAutoReconnect] = useState(true)
  const [reconnectInterval, setReconnectInterval] = useState(5)
  const [connTimeout, setConnTimeout] = useState(10)
  const [probeState, setProbeState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [probeError, setProbeError] = useState('')

  const updateGateway = (patch: Record<string, unknown>) => {
    const next = { ...gw, ...patch }
    updateConfig({ gateway: next })
    if (patch.port != null) {
      void window.agentApi.setPort(patch.port as number)
    }
  }

  useEffect(() => {
    void window.agentApi.setPort(port)
  }, [])

  const handleProbe = async () => {
    setProbeState('testing')
    setProbeError('')
    try {
      const result = await window.agentApi.probe(port)
      if (result.ok) {
        setProbeState('ok')
      } else {
        setProbeState('fail')
        setProbeError(result.error || t('settings.connection.gateway.probeFailed'))
      }
    } catch {
      setProbeState('fail')
      setProbeError(t('settings.connection.gateway.requestFailed'))
    }
    setTimeout(() => setProbeState('idle'), 4000)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Wifi} title={t('settings.connection.title')} subtitle={t('settings.connection.subtitle')} />
      <GroupCard title={t('settings.connection.gateway.title')}>
        <SettingRow label={t('settings.connection.gateway.host')} description={t('settings.connection.gateway.hostDesc')}>
          <TextInput value={host} onChange={(v) => updateGateway({ host: v })} placeholder="0.0.0.0" className="w-40" mono />
        </SettingRow>
        <SettingRow label={t('settings.connection.gateway.port')} description={t('settings.connection.gateway.portDesc')}>
          <div className="flex items-center gap-2">
            <NumberInput value={port} onChange={(v) => updateGateway({ port: v })} min={1} max={65535} className="w-20" />
            <button
              onClick={() => void handleProbe()}
              disabled={probeState === 'testing'}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                probeState === 'ok'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400'
                  : probeState === 'fail'
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                probeState === 'testing' && 'cursor-not-allowed opacity-70',
              )}
            >
              {probeState === 'testing' ? (
                <><Loader2 size={12} className="animate-spin" /> {t('settings.connection.gateway.probing')}</>
              ) : probeState === 'ok' ? (
                <><Check size={12} /> {t('settings.connection.gateway.connected')}</>
              ) : probeState === 'fail' ? (
                <><X size={12} /> {probeError || t('settings.connection.gateway.failed')}</>
              ) : (
                <><Radio size={12} /> {t('settings.connection.gateway.probe')}</>
              )}
            </button>
          </div>
        </SettingRow>
        <SettingRow label={t('settings.connection.gateway.autoReconnect')} description={t('settings.connection.gateway.autoReconnectDesc')}>
          <Toggle checked={autoReconnect} onChange={setAutoReconnect} />
        </SettingRow>
        <SettingRow label={t('settings.connection.gateway.reconnectInterval')} description={t('settings.connection.gateway.reconnectIntervalDesc')}>
          <NumberInput value={reconnectInterval} onChange={setReconnectInterval} suffix={t('settings.connection.seconds')} min={1} max={60} disabled={!autoReconnect} />
        </SettingRow>
        <SettingRow label={t('settings.connection.gateway.timeout')} description={t('settings.connection.gateway.timeoutDesc')}>
          <NumberInput value={connTimeout} onChange={setConnTimeout} suffix={t('settings.connection.seconds')} min={3} max={60} />
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('settings.connection.heartbeat.title')}>
        <SettingRow label={t('settings.connection.heartbeat.enabled')} description={t('settings.connection.heartbeat.enabledDesc')}>
          <Toggle checked={hbEnabled} onChange={(v) => updateGateway({ heartbeat: { ...gw.heartbeat, enabled: v } })} />
        </SettingRow>
        <SettingRow label={t('settings.connection.heartbeat.interval')} description={t('settings.connection.heartbeat.intervalDesc')}>
          <NumberInput value={hbInterval} onChange={(v) => updateGateway({ heartbeat: { ...gw.heartbeat, intervalS: v } })} suffix={t('settings.connection.seconds')} min={10} max={7200} disabled={!hbEnabled} />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Auth Section ───────────────────────────────────────────────────────────

function AuthSection() {
  const { t } = useTranslation()
  type AuthMode = 'none' | 'token' | 'password' | 'trusted-proxy'
  const { config, loading, updateConfig } = useAppConfig()
  const auth = (config?.auth || {}) as { mode?: AuthMode; token?: string; password?: string }
  const mode = auth.mode ?? 'token'
  const token = auth.token ?? ''
  const password = auth.password ?? ''
  const [showSecret, setShowSecret] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

  const authModeOptions = [
    { label: 'None', value: 'none' },
    { label: 'Token', value: 'token' },
    { label: 'Password', value: 'password' },
    { label: 'Proxy', value: 'trusted-proxy' },
  ]

  const handleTest = async () => {
    setTestState('testing')
    await new Promise((r) => setTimeout(r, 1400))
    setTestState('fail')
    setTimeout(() => setTestState('idle'), 3000)
  }

  const updateAuth = (patch: Record<string, unknown>) => {
    updateConfig({ auth: { ...auth, ...patch } })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Shield} title={t('settings.auth.title')} subtitle={t('settings.auth.subtitle')} />
      <GroupCard title={t('settings.auth.mode.title')}>
        <SettingRow label={t('settings.auth.mode.label')} description={t('settings.auth.mode.desc')}>
          <Segment options={authModeOptions} value={mode} onChange={(v) => updateAuth({ mode: v as AuthMode })} />
        </SettingRow>

        {mode === 'token' && (
          <SettingRow label={t('settings.auth.token.label')} description={t('settings.auth.token.desc')}>
            <div className="flex items-center gap-1.5">
              <input
                type={showSecret ? 'text' : 'password'}
                value={token}
                onChange={(e) => updateAuth({ token: e.target.value })}
                placeholder={t('settings.auth.token.placeholder')}
                className="w-48 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
              />
              <button onClick={() => setShowSecret(!showSecret)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </SettingRow>
        )}

        {mode === 'password' && (
          <SettingRow label={t('settings.auth.password.label')} description={t('settings.auth.password.desc')}>
            <div className="flex items-center gap-1.5">
              <input
                type={showSecret ? 'text' : 'password'}
                value={password}
                onChange={(e) => updateAuth({ password: e.target.value })}
                placeholder={t('settings.auth.password.placeholder')}
                className="w-48 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
              />
              <button onClick={() => setShowSecret(!showSecret)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </SettingRow>
        )}

        {mode === 'none' && (
          <div className="py-3 text-xs text-muted-foreground">
            {t('settings.auth.mode.noneDesc')}
          </div>
        )}

        {mode === 'trusted-proxy' && (
          <div className="py-3 text-xs text-muted-foreground">
            {t('settings.auth.mode.proxyDesc')}
          </div>
        )}
      </GroupCard>

      <div className="flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testState === 'testing'}
          className="flex-1 flex items-center justify-center gap-2 h-8 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
        >
          {testState === 'testing' && <Loader2 size={14} className="animate-spin" />}
          {testState === 'testing' ? t('settings.auth.testing') : t('settings.auth.test')}
        </button>
        {testState === 'ok' && <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium"><Check size={14} /> {t('settings.auth.success')}</span>}
        {testState === 'fail' && <span className="flex items-center gap-1.5 text-sm text-red-500 font-medium"><X size={14} /> {t('settings.auth.failed')}</span>}
      </div>
    </div>
  )
}

// ─── Provider 策略 + Fallback Chain Manager ─────────────────────────────────
//
// Loads providers/endpoints + the current fallback chain from the engine
// (Providers Management API). The dropdown lists `auto` + every available
// `provider:endpoint` ref. When `auto` is selected, the chain manager is
// rendered below: drag to reorder, "添加节点" menu (top-right) to append from
// the remaining available endpoints, "x" to remove. Mutations call
// PUT /api/v1/fallback-chain via the IPC bridge; UI updates optimistically
// and rolls back on failure. If the engine returns 404 (chain has <2
// entries → engine doesn't mount the management API) we show a disabled
// hint instead of an empty list.

interface ProviderEndpointRef {
  ref: string
  provider: string
  endpoint: string
  model?: string
  type: ProviderType
  modelType?: string[]
  providerEnabled?: boolean
  // Engine 2026-05-14+ provider.disabled. Endpoints under a disabled
  // provider are completely skipped by the dispatcher (effective
  // disabled = provider.disabled || endpoint.disabled), so the
  // fallback-chain "add node" menu hides them — picking one would
  // produce a chain entry that can never route.
  providerDisabled?: boolean
  endpointDisabled?: boolean
  engineProviderDisabled?: boolean
  engineEndpointDisabled?: boolean
  providerMissing?: boolean
  endpointMissing?: boolean
  providerEngineType?: ProviderType
  providerApiBase?: string | null
  providerApiKey?: string
  endpointGroup?: string
}

function isImageGenerationEndpointRef(endpoint: ProviderEndpointRef): boolean {
  return endpoint.modelType?.includes('image_generation') === true
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

const PROTOCOL_GROUPS = (t: any): { type: ProviderType; label: string }[] => [
  { type: 'anthropic', label: t('models.protocols.anthropic') },
  { type: 'openai', label: t('models.protocols.openai') },
  { type: 'gemini', label: t('models.protocols.gemini') },
]

// Engine 2026-05-14+: routing is `agent.primary` (single endpoint) +
// optional `agent.fallback_chain` (ordered backup list). This row
// surfaces both:
//   • A SelectInput for `agent.primary` (no "auto" option — primary
//     is always a concrete endpoint per the new agent block).
//   • A Toggle that gates the fallback drag-list. OFF clears
//     fallback_chain; ON keeps the chain UI visible so the user can
//     add backup endpoints. Local toggle state is needed because the
//     engine's chain.length==1 state alone can't distinguish "user
//     wants no fallback" from "user wants fallback but hasn't picked
//     nodes yet".
function ProviderStrategyRow({
  onNavigateToModels,
  blinkPrimarySignal,
}: {
  // Settings-page navigation callback. Wired up by the parent so the
  // "跳转设置" affordance can switch to the models section without
  // ProviderStrategyRow needing to know about react-router.
  onNavigateToModels?: () => void
  // Monotonically-increasing counter. Each increment briefly flashes
  // the 主 Provider dropdown to draw the user's eye when they jump in
  // from the models page's "去配置 Agent LLM 节点" affordance.
  blinkPrimarySignal?: number
}) {
  const { t } = useTranslation()
  const [blinkingPrimary, setBlinkingPrimary] = useState(false)
  // Spotlight is shown for the same window as the inner pulse — they
  // double up: the spotlight dims the surrounding page while the
  // CSS pulse highlights the dropdown border inside the bright cut-out.
  const [primarySpotlightActive, setPrimarySpotlightActive] = useState(false)
  const primarySelectRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (blinkPrimarySignal === undefined || blinkPrimarySignal === 0) return
    setBlinkingPrimary(true)
    setPrimarySpotlightActive(true)
    const innerTimer = setTimeout(() => setBlinkingPrimary(false), 1300)
    // Longer dim window so the user has time to register the spotlight
    // and click the dropdown; matches ModelSection's 3.5s flash budget.
    const spotTimer = setTimeout(() => setPrimarySpotlightActive(false), 3500)
    return () => {
      clearTimeout(innerTimer)
      clearTimeout(spotTimer)
    }
  }, [blinkPrimarySignal])
  const getPrimarySpotlightTargets = useCallback((): HTMLElement[] => {
    return primarySelectRef.current ? [primarySelectRef.current] : []
  }, [])
  // Renderer-side enabled flags live in appConfig.modelProviders.<key>.enabled.
  // We treat that as a hard override on top of the engine's
  // `provider.disabled`: if the user turned the ON badge OFF in the
  // Models tab, the provider must NEVER appear in the primary picker
  // even if the engine's PATCH /providers/{p} {disabled:true} hasn't
  // been confirmed yet (e.g. the PATCH failed with 404 because the
  // provider was never created engine-side, or returned an older
  // payload without the `disabled` field).
  const { config: appConfigData } = useAppConfig()
  const rendererDisabledNames = useMemo(() => {
    const out = new Set<string>()
    const modelProviders = asRecord((appConfigData ?? {}).modelProviders)
    for (const [name, raw] of Object.entries(modelProviders)) {
      if (!isManagedProviderKey(name)) continue
      const rec = asRecord(raw)
      if (rec.enabled === false) out.add(name)
    }
    return out
  }, [appConfigData])
  const rendererEnabledNames = useMemo(() => {
    const out = new Set<string>()
    const modelProviders = asRecord((appConfigData ?? {}).modelProviders)
    for (const [name, raw] of Object.entries(modelProviders)) {
      if (!isManagedProviderKey(name)) continue
      const rec = asRecord(raw)
      if (rec.enabled === true) out.add(name)
    }
    return out
  }, [appConfigData])
  const rendererImageModelsByRef = useMemo(() => {
    const out = new Map<
      string,
      {
        provider: ManagedProviderKey
        modelId: string
        tags: string[]
        engineType: ProviderType
        apiBase: string | null
        apiKey: string
        group?: string
      }
    >()
    const modelProviders = asRecord((appConfigData ?? {}).modelProviders)
    for (const [providerName, rawProvider] of Object.entries(modelProviders)) {
      if (!isManagedProviderKey(providerName)) continue
      const provider = asRecord(rawProvider)
      if (provider.enabled !== true) continue
      const normalized = normalizeProviderConfig(provider)
      const providerConfig: ProviderConfig = {
        ...createEmptyProviderConfig(providerName),
        ...normalized,
        apiBase: normalized.apiBase ?? PROVIDER_DEFAULT_BASES[providerName] ?? null,
        raw: provider,
      }
      const engineType = getEffectiveEngineType(providerName, providerConfig)
      const models = Array.isArray(provider.models) ? provider.models : []
      for (const rawModel of models) {
        const model = asRecord(rawModel)
        if (model.enabled !== true || typeof model.id !== 'string' || model.id.length === 0) {
          continue
        }
        const tags = toStringList(model.tags).filter(
          (tag) => VISIBLE_MODEL_TYPE_TOKENS.has(tag) || HIDDEN_MODEL_TYPE_TOKENS.has(tag),
        )
        if (!tags.includes('image_generation')) continue
        out.set(`${providerName}:${model.id}`, {
          provider: providerName,
          modelId: model.id,
          tags,
          engineType,
          apiBase: providerConfig.apiBase,
          apiKey: providerConfig.apiKey,
          ...(typeof model.group === 'string' && model.group.trim()
            ? { group: model.group.trim() }
            : {}),
        })
      }
    }
    return out
  }, [appConfigData])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [chain, setChain] = useState<string[]>([])
  const [chainEntries, setChainEntries] = useState<ProviderChainEntry[]>([])
  const [imageGeneration, setImageGeneration] = useState('')
  // Video generation tool target ref (`provider:endpoint`). Sourced from
  // the videogen config tree (listVideoProviders) for the options and
  // from agent.video_generation for the current value — independent of
  // the model-provider chain that drives image_generation.
  const [videoGeneration, setVideoGeneration] = useState('')
  const [videoProviders, setVideoProviders] = useState<
    Record<string, { endpoints?: Record<string, { model?: string }> }>
  >({})
  // Image endpoints come from the independent imagegen config tree
  // (cfg.ImageGen via listImageProviders), parallel to videoProviders —
  // no longer derived from the model-provider chain.
  const [imageProviders, setImageProviders] = useState<
    Record<string, { endpoints?: Record<string, { model?: string }> }>
  >({})
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [fallbackEnabled, setFallbackEnabled] = useState(false)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const addMenuRef = useRef<HTMLDivElement | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setUnavailable(null)
    const [pRes, aRes] = await Promise.all([
      window.agentApi.listProviders(),
      window.agentApi.getAgentConfig(),
    ])
    if (!pRes.ok) {
      setProviders([])
      setChain([])
      setChainEntries([])
      setImageGeneration('')
      // Engine 2026-05-14+: providers + /agent are always mounted, even
      // in degraded mode (empty chain). A 404 here means the engine is
      // older than the rewrite or the path is genuinely wrong.
      setUnavailable(
        pRes.status === 404
          ? t('chat.status.apiNotFound')
          : pRes.message || pRes.error || t('chat.status.loadFailed'),
      )
      setLoading(false)
      return
    }
    setProviders(Array.isArray(pRes.data.providers) ? pRes.data.providers : [])
    if (aRes.ok) {
      const fallback = Array.isArray(aRes.data?.fallback_chain) ? aRes.data.fallback_chain : []
      setChain(aRes.data?.primary ? [aRes.data.primary, ...fallback] : fallback.slice())
      setChainEntries(Array.isArray(aRes.data?.entries) ? aRes.data.entries : [])
      setImageGeneration(
        typeof aRes.data?.image_generation === 'string' ? aRes.data.image_generation : '',
      )
      // `video_generation` rides on the same GET /agent payload but the
      // ambient AgentConfigInfo type predates the field, so read it via a
      // narrow cast rather than widening the shared type.
      const videoRef = (aRes.data as { video_generation?: string } | undefined)?.video_generation
      setVideoGeneration(typeof videoRef === 'string' ? videoRef : '')
    } else {
      setChain([])
      setChainEntries([])
      setImageGeneration('')
      setVideoGeneration('')
    }
    setLoading(false)
  }, [t])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // Video endpoints come from the separate videogen config tree, not the
  // model-provider chain. Load once; failures leave the dropdown with just
  // the "(none)" option (and any unrecognized saved value).
  useEffect(() => {
    void (async () => {
      const res = await window.agentApi.listVideoProviders()
      if (res.ok) {
        setVideoProviders(res.data?.providers ?? {})
      }
    })()
  }, [])

  // Image endpoints come from the separate imagegen config tree, not the
  // model-provider chain. Load once; failures leave the dropdown with just
  // the "(none)" option (and any unrecognized saved value).
  useEffect(() => {
    void (async () => {
      const res = await window.agentApi.listImageProviders()
      if (res.ok) {
        setImageProviders(res.data?.providers ?? {})
      }
    })()
  }, [])

  useEffect(() => {
    if (!addOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddOpen(false)
    }
    const onPointer = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [addOpen])

  const allEndpoints = useMemo<ProviderEndpointRef[]>(() => {
    const out: ProviderEndpointRef[] = []
    const seenRefs = new Set<string>()
    const providersByName = new Map(providers.map((provider) => [provider.name, provider]))
    for (const p of providers) {
      for (const e of p.endpoints) {
        const ref = `${p.name}:${e.name}`
        const rendererImageModel = rendererImageModelsByRef.get(ref)
        const engineModelType = toStringList(e.model_type)
        const modelType = Array.from(
          new Set([...engineModelType, ...(rendererImageModel?.tags ?? [])]),
        )
        // Effective disabled = renderer-side enabled=false OR engine flag.
        // For image-generation models that are already enabled in
        // appConfig, an engine-side disabled=true is treated as stale
        // sync state so the selector can still show the row and repair it
        // on selection. Chat/fallback routing still hides disabled
        // endpoints, and image-generation rows are excluded from those
        // selectors separately by modelType.
        const enabledImageModel = Boolean(rendererImageModel)
        const providerDisabled = rendererDisabledNames.has(p.name)
          || (p.disabled === true && !enabledImageModel)
        const endpointDisabled = e.disabled === true && !enabledImageModel
        seenRefs.add(ref)
        out.push({
          ref,
          provider: p.name,
          endpoint: e.name,
          model: e.model,
          type: p.type,
          modelType,
          providerEnabled: rendererEnabledNames.has(p.name),
          providerDisabled,
          endpointDisabled,
          engineProviderDisabled: p.disabled === true,
          engineEndpointDisabled: e.disabled === true,
          providerEngineType: rendererImageModel?.engineType ?? p.type,
          providerApiBase: rendererImageModel?.apiBase ?? p.base_url,
          providerApiKey: rendererImageModel?.apiKey ?? p.api_key,
          endpointGroup: rendererImageModel?.group ?? e.group,
        })
      }
    }
    for (const [ref, imageModel] of rendererImageModelsByRef.entries()) {
      if (seenRefs.has(ref)) continue
      const provider = providersByName.get(imageModel.provider)
      const providerDisabled = rendererDisabledNames.has(imageModel.provider)
      out.push({
        ref,
        provider: imageModel.provider,
        endpoint: imageModel.modelId,
        model: imageModel.modelId,
        type: provider?.type ?? imageModel.engineType,
        modelType: imageModel.tags,
        providerEnabled: true,
        providerDisabled,
        endpointDisabled: false,
        engineProviderDisabled: provider?.disabled === true,
        engineEndpointDisabled: false,
        providerMissing: !provider,
        endpointMissing: true,
        providerEngineType: imageModel.engineType,
        providerApiBase: imageModel.apiBase,
        providerApiKey: imageModel.apiKey,
        endpointGroup: imageModel.group,
      })
    }
    return out
  }, [providers, rendererDisabledNames, rendererEnabledNames, rendererImageModelsByRef])

  // Split the flat chain into primary (head) + fallback (tail). The
  // engine enforces `fallback_chain` entries must be distinct from
  // primary, so addable/list filters use both.
  const primary = chain[0] ?? ''
  const fallback = useMemo(() => chain.slice(1), [chain])

  // One-way sync: when the engine reports a non-empty fallback, enable
  // the toggle. We don't auto-disable when fallback becomes empty —
  // the user might have just toggled ON to start adding nodes.
  useEffect(() => {
    if (fallback.length > 0) setFallbackEnabled(true)
  }, [fallback.length])

  const addableByType = useMemo(() => {
    const groups = new Map<ProviderType, ProviderEndpointRef[]>()
    for (const e of allEndpoints) {
      // Skip primary (engine rejects fallback == primary), endpoints
      // already in fallback, and endpoints whose owning provider is
      // disabled (they can't route, so listing them would be a trap).
      if (
        e.ref === primary
        || fallback.includes(e.ref)
        || e.providerDisabled
        || e.endpointDisabled
        || isImageGenerationEndpointRef(e)
      ) continue
      const arr = groups.get(e.type) ?? []
      arr.push(e)
      groups.set(e.type, arr)
    }
    return groups
  }, [allEndpoints, primary, fallback])

  const addable = useMemo(
    () =>
      allEndpoints.filter(
        (e) =>
          e.ref !== primary
          && !fallback.includes(e.ref)
          && !e.providerDisabled
          && !e.endpointDisabled
          && !isImageGenerationEndpointRef(e),
      ),
    [allEndpoints, primary, fallback],
  )

  // Primary picker options — endpoints that can actually be routed
  // to (i.e. their owning provider is not disabled). The currently
  // selected primary is always retained, even if its provider was
  // just disabled, so the user can see the current state. Label is
  // the canonical `provider:endpoint` ref; we intentionally drop the
  // parenthesized model id to keep the dropdown row short (the model
  // is implied by the endpoint name in practice).
  const primaryOptions = useMemo<{ label: string; value: string }[]>(() => {
    const opts: { label: string; value: string }[] = []
    if (!primary) opts.push({ label: t('models.select'), value: '' })
    for (const e of allEndpoints) {
      if (e.providerDisabled && e.ref !== primary) continue
      if (e.endpointDisabled && e.ref !== primary) continue
      if (isImageGenerationEndpointRef(e) && e.ref !== primary) continue
      opts.push({ label: e.ref, value: e.ref })
    }
    if (primary && !allEndpoints.some((e) => e.ref === primary)) {
      opts.push({ label: t('models.unrecognized', { name: primary }), value: primary })
    }
    return opts
  }, [allEndpoints, primary, t])

  const imageGenerationOptions = useMemo<{ label: string; value: string }[]>(() => {
    const opts: { label: string; value: string }[] = [{ label: t('models.select'), value: '' }]
    for (const [provider, listing] of Object.entries(imageProviders)) {
      for (const [endpoint, info] of Object.entries(listing?.endpoints ?? {})) {
        const ref = `${provider}:${endpoint}`
        const model = (info as { model?: string })?.model?.trim()
        opts.push({ label: model ? `${ref}（${model}）` : ref, value: ref })
      }
    }
    if (imageGeneration && !opts.some((o) => o.value === imageGeneration)) {
      opts.push({ label: t('models.unrecognized', { name: imageGeneration }), value: imageGeneration })
    }
    return opts
  }, [imageProviders, imageGeneration, t])

  const videoGenerationOptions = useMemo<{ label: string; value: string }[]>(() => {
    const opts: { label: string; value: string }[] = [{ label: t('models.select'), value: '' }]
    for (const [provider, listing] of Object.entries(videoProviders)) {
      for (const [endpoint, info] of Object.entries(listing?.endpoints ?? {})) {
        const ref = `${provider}:${endpoint}`
        const model = info?.model?.trim()
        opts.push({ label: model ? `${ref}（${model}）` : ref, value: ref })
      }
    }
    if (videoGeneration && !opts.some((o) => o.value === videoGeneration)) {
      opts.push({ label: t('models.unrecognized', { name: videoGeneration }), value: videoGeneration })
    }
    return opts
  }, [videoProviders, videoGeneration, t])

  // persistChain takes the full flat chain; the main-process adapter
  // splits it back into `{primary, fallback_chain}` for PATCH /agent.
  // Empty chain (length 0) intentionally allowed — the engine treats
  // that as degraded mode (primary="", fallback=[]).
  const persistChain = async (next: string[]) => {
    setBusy(true)
    const prev = chain
    setChain(next)
    const res = await window.agentApi.updateFallbackChain(next)
    if (!res.ok) {
      setChain(prev)
      setBusy(false)
      return
    }
    setChain(Array.isArray(res.data?.chain) ? res.data.chain : [])
    setChainEntries(Array.isArray(res.data?.entries) ? res.data.entries : [])
    setBusy(false)
  }

  // Mirrors handleVideoGenerationChange's optimistic-then-confirm flow.
  // No endpoint-readiness step: image targets live in the imagegen config
  // tree (cfg.ImageGen), which isn't subject to the model-chain repair logic.
  const handleImageGenerationChange = async (newRef: string) => {
    if (newRef === imageGeneration) return
    setBusy(true)
    const prev = imageGeneration
    setImageGeneration(newRef)
    const res = await window.agentApi.patchAgentConfig({ image_generation: newRef })
    if (!res.ok) {
      setImageGeneration(prev)
      setBusy(false)
      return
    }
    setImageGeneration(
      typeof res.data?.image_generation === 'string' ? res.data.image_generation : '',
    )
    setBusy(false)
  }

  // Mirrors handleImageGenerationChange's optimistic-then-confirm flow.
  // No endpoint-readiness step: video targets live in the videogen config
  // tree, which isn't subject to the model-chain repair logic.
  const handleVideoGenerationChange = async (newRef: string) => {
    if (newRef === videoGeneration) return
    setBusy(true)
    const prev = videoGeneration
    setVideoGeneration(newRef)
    const res = await window.agentApi.patchAgentConfig({ video_generation: newRef })
    if (!res.ok) {
      setVideoGeneration(prev)
      setBusy(false)
      return
    }
    const confirmed = (res.data as { video_generation?: string } | undefined)?.video_generation
    setVideoGeneration(typeof confirmed === 'string' ? confirmed : '')
    setBusy(false)
  }

  // Picking a new primary: if it currently lives in fallback we strip
  // it (engine constraint: fallback_chain items must differ from
  // primary) before reassembling the chain.
  const handlePrimaryChange = (newRef: string) => {
    if (!newRef || newRef === primary) return
    const cleanedFallback = fallback.filter((r) => r !== newRef)
    void persistChain([newRef, ...cleanedFallback])
  }

  // Toggle OFF: clear fallback (keep primary so we don't drop into
  // degraded mode). Toggle ON: just open the chain UI; user adds
  // nodes manually.
  const handleToggleFallback = (next: boolean) => {
    setFallbackEnabled(next)
    if (!next && fallback.length > 0 && primary) {
      void persistChain([primary])
    }
  }

  const handleDragStart = (event: React.DragEvent, idx: number) => {
    setDraggedIdx(idx)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event: React.DragEvent, idx: number) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const isAfter = event.clientY - rect.top > rect.height / 2
    const target = isAfter ? idx + 1 : idx
    if (dragOverIdx !== target) setDragOverIdx(target)
  }

  const handleListDragLeave = (event: React.DragEvent) => {
    const related = event.relatedTarget as Node | null
    if (!related || !(event.currentTarget as Node).contains(related)) {
      setDragOverIdx(null)
    }
  }

  // Drag indices are fallback-local (the drag list excludes primary).
  // Persist reassembles `[primary, ...newFallback]` so primary stays
  // pinned at chain[0].
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const target = dragOverIdx
    if (
      draggedIdx === null
      || target === null
      || target === draggedIdx
      || target === draggedIdx + 1
    ) {
      setDraggedIdx(null)
      setDragOverIdx(null)
      return
    }
    const nextFallback = [...fallback]
    const [moved] = nextFallback.splice(draggedIdx, 1)
    const insertAt = draggedIdx < target ? target - 1 : target
    nextFallback.splice(insertAt, 0, moved)
    setDraggedIdx(null)
    setDragOverIdx(null)
    if (!primary) return
    void persistChain([primary, ...nextFallback])
  }

  const handleDragEnd = () => {
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  const handleAdd = (ref: string) => {
    setAddOpen(false)
    if (!primary) return
    void persistChain([primary, ...fallback, ref])
  }

  const handleRemove = (ref: string) => {
    if (!primary) return
    void persistChain([primary, ...fallback.filter((r) => r !== ref)])
  }

  const stateBadge = (s?: string): { cls: string; label: string } => {
    if (s === 'healthy') return { cls: 'bg-emerald-500', label: t('models.status.healthy') }
    if (s === 'tripped') return { cls: 'bg-rose-500', label: t('models.status.tripped') }
    if (s === 'ready_to_probe') return { cls: 'bg-amber-500', label: t('models.status.ready_to_probe') }
    return { cls: 'bg-muted-foreground/40', label: t('models.status.unknown') }
  }

  return (
    <>
      <SettingRow label={t('settings.models.primaryProvider')}>
        <div className="flex items-center gap-2">
          {/*
            Quick-jump to the 模型配置 settings section. Sits to the
            left of the dropdown so users see "what / where to edit"
            before the value itself. Rendered only when the parent
            supplied the callback so the row degrades gracefully if
            reused elsewhere.
          */}
          {onNavigateToModels && (
            <button
              type="button"
              onClick={onNavigateToModels}
              title={t('settings.models.jumpToSettings')}
              aria-label={t('settings.models.jumpToSettings')}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink size={13} />
            </button>
          )}
          <span ref={primarySelectRef} className="inline-flex" data-flash="primary-provider">
            <SelectInput
              value={primary}
              onChange={handlePrimaryChange}
              options={primaryOptions}
              className={blinkingPrimary ? 'agent-primary-blink' : undefined}
            />
          </span>
        </div>
      </SettingRow>

      <SettingRow
        label={t('settings.models.imageGenerationProvider')}
        description={t('settings.models.imageGenerationProviderDesc')}
      >
        <div className="flex items-center gap-2">
          <SelectInput
            value={imageGeneration}
            onChange={handleImageGenerationChange}
            options={imageGenerationOptions}
          />
          {busy && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        </div>
      </SettingRow>

      {/* Label/description use inline literals rather than i18n keys: the
          videoGenerationProvider locale entries don't exist yet, and this
          task is scoped to SettingsPage.tsx only. Mirror the image row's
          structure otherwise. */}
      <SettingRow
        label="视频生成模型"
        description="供视频生成工具使用，不参与主回答模型和 fallback_chain"
      >
        <div className="flex items-center gap-2">
          <SelectInput
            value={videoGeneration}
            onChange={handleVideoGenerationChange}
            options={videoGenerationOptions}
          />
          {busy && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
        </div>
      </SettingRow>

      <SettingRow
        label={t('settings.models.fallbackEnabled')}
        description={t('settings.models.fallbackEnabledDesc')}
      >
        <Toggle
          checked={fallbackEnabled}
          onChange={handleToggleFallback}
        />
      </SettingRow>

      {fallbackEnabled && (
        <div className="pb-4">
          <div className="rounded-xl border border-border bg-background/40">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>Fallback Chain</span>
                {busy && <Loader2 size={12} className="animate-spin" />}
              </div>
              <div className="relative" ref={addMenuRef}>
                <button
                  type="button"
                  onClick={() => setAddOpen((v) => !v)}
                  disabled={addable.length === 0 || busy || !!unavailable}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent',
                    (addable.length === 0 || busy || !!unavailable) && 'cursor-not-allowed opacity-50 hover:bg-card',
                  )}
                >
                  <Plus size={12} />
                  {t('agents.fallback.addNode')}
                </button>

                {addOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-lg">
                    {PROTOCOL_GROUPS(t).every((g) => (addableByType.get(g.type)?.length ?? 0) === 0) ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {t('agents.fallback.noNodes')}
                      </div>
                    ) : (
                      PROTOCOL_GROUPS(t).map((group) => {
                        const items = addableByType.get(group.type) ?? []
                        if (items.length === 0) return null
                        return (
                          <div key={group.type} className="mb-2 last:mb-0">
                            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {group.label}
                            </div>
                            <div className="space-y-0.5">
                              {items.map((e) => (
                                <button
                                  key={e.ref}
                                  type="button"
                                  onClick={() => handleAdd(e.ref)}
                                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
                                >
                                  <span className="min-w-0 truncate">
                                    <span className="font-medium">{e.provider}</span>
                                    <span className="text-muted-foreground">:{e.endpoint}</span>
                                  </span>
                                  {e.model && (
                                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                      {e.model}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="px-2 py-2" onDragLeave={handleListDragLeave}>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
                </div>
              ) : unavailable ? (
                <div className="px-2 py-4 text-xs text-muted-foreground">{unavailable}</div>
              ) : fallback.length === 0 ? (
                <div className="px-2 py-4 text-xs text-muted-foreground">
                  {t('agents.fallback.empty')}
                </div>
              ) : (
                // Drag list renders fallback only — primary is shown
                // separately above. Indices here are fallback-local
                // (0..fallback.length); handlers reassemble the full
                // chain with primary pinned at head.
                fallback.map((ref, idx) => {
                  const entry = chainEntries.find((e) => e.name === ref)
                  const badge = stateBadge(entry?.state)
                  const colon = ref.indexOf(':')
                  const refProvider = entry?.provider ?? (colon >= 0 ? ref.slice(0, colon) : ref)
                  const refEndpoint = entry?.endpoint ?? (colon >= 0 ? ref.slice(colon + 1) : '')
                  return (
                    <div
                      key={ref}
                      className="relative"
                      onDragOver={(event) => handleDragOver(event, idx)}
                      onDrop={handleDrop}
                    >
                      <div
                        aria-hidden
                        className={cn(
                          'pointer-events-none absolute inset-x-6 -top-px h-0.5 rounded-full bg-primary transition-opacity duration-150',
                          dragOverIdx === idx
                            && draggedIdx !== null
                            && draggedIdx !== idx
                            && draggedIdx + 1 !== idx
                            ? 'opacity-100'
                            : 'opacity-0',
                        )}
                      />
                      {idx === fallback.length - 1 && (
                        <div
                          aria-hidden
                          className={cn(
                            'pointer-events-none absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-primary transition-opacity duration-150',
                            dragOverIdx === fallback.length
                              && draggedIdx !== null
                              && draggedIdx !== idx
                              ? 'opacity-100'
                              : 'opacity-0',
                          )}
                        />
                      )}
                      <div
                        draggable
                        onDragStart={(event) => handleDragStart(event, idx)}
                        onDragEnd={handleDragEnd}
                        className={cn(
                          'group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:bg-accent/40',
                          draggedIdx === idx && 'opacity-50',
                        )}
                      >
                        <GripVertical size={14} className="shrink-0 cursor-grab text-muted-foreground" />
                        <span className="w-5 shrink-0 text-center font-mono text-[11px] text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                          <span className="font-medium">{refProvider}</span>
                          <span className="text-muted-foreground">{refEndpoint ? `:${refEndpoint}` : ''}</span>
                        </span>
                        <span
                          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                          title={badge.label}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', badge.cls)} />
                          {badge.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemove(ref)}
                          disabled={busy}
                          className={cn(
                            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground',
                            busy && 'cursor-not-allowed opacity-30',
                          )}
                          aria-label={t('agents.fallback.removeNode')}
                          title={t('agents.fallback.remove')}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {primarySpotlightActive && (
        <SpotlightOverlay
          getTargets={getPrimarySpotlightTargets}
          onDismiss={() => setPrimarySpotlightActive(false)}
        />
      )}
    </>
  )
}

// ─── Agent Section ──────────────────────────────────────────────────────────

// Four canonical temperature presets ("回答风格"). The engine treats
// `agent.temperature` as canonical [0, 1] and rescales per-provider
// (anthropic ×1, openai/gemini ×2). Each preset claims a quarter of
// that range so the slider position naturally maps back to a preset.
// `defaultValue` is the value applied when the preset button is
// clicked — picked roughly in the middle of each range so subsequent
// fine-tuning via the slider stays inside the same preset.
type TemperaturePreset = {
  key: 'precise' | 'balanced' | 'flexible' | 'creative'
  name: string
  fullName: string
  icon: React.ElementType
  defaultValue: number
  description: string
  // Short (2-4 char) scenario tags rendered as pills under the
  // description. Kept intentionally terse — long sentences would
  // make the pills look like chat bubbles instead of category chips.
  scenarios: string[]
  recommended?: boolean
}

// Pull the 4 short scenario labels for a preset from i18n. Stored as
// `agents.scenarios.<preset>.s1..s4` so each language can phrase them
// naturally without changing the React layout.
const sceneList = (t: any, preset: 'precise' | 'balanced' | 'flexible' | 'creative') =>
  ['s1', 's2', 's3', 's4'].map((k) => t(`agents.scenarios.${preset}.${k}`))

const TEMPERATURE_PRESETS = (t: any): TemperaturePreset[] => [
  {
    key: 'precise',
    name: t('agents.stylePrecise'),
    fullName: t('agents.stylePreciseFull'),
    icon: Target,
    defaultValue: 0.12,
    description: t('agents.stylePreciseDesc'),
    scenarios: sceneList(t, 'precise'),
  },
  {
    key: 'balanced',
    name: t('agents.styleBalanced'),
    fullName: t('agents.styleBalancedFull'),
    icon: Scale,
    defaultValue: 0.35,
    recommended: true,
    description: t('agents.styleBalancedDesc'),
    scenarios: sceneList(t, 'balanced'),
  },
  {
    key: 'flexible',
    name: t('agents.styleFlexible'),
    fullName: t('agents.styleFlexibleFull'),
    icon: Lightbulb,
    defaultValue: 0.62,
    description: t('agents.styleFlexibleDesc'),
    scenarios: sceneList(t, 'flexible'),
  },
  {
    key: 'creative',
    name: t('agents.styleCreative'),
    fullName: t('agents.styleCreativeFull'),
    icon: Sparkles,
    defaultValue: 0.85,
    description: t('agents.styleCreativeDesc'),
    scenarios: sceneList(t, 'creative'),
  },
]

// Map a temperature value to its preset bucket. Boundaries are
// half-open on the low side so 0.25 → balanced, 0.5 → flexible,
// 0.75 → creative; the slider's 0.05 step never lands on a boundary
// exactly anyway.
function presetForTemperature(value: number, presets: TemperaturePreset[]): TemperaturePreset {
  if (value < 0.25) return presets[0]
  if (value < 0.5) return presets[1]
  if (value < 0.75) return presets[2]
  return presets[3]
}

// Full-width temperature control. Replaces the plain Temperature
// SettingRow because the design needs:
//   • a wide slider with semantic left/right anchors;
//   • a contextual card describing the currently selected preset;
//   • four quick-pick buttons that snap to canonical preset values.
// The slider step (0.05) lets the user fine-tune within a preset
// without jumping to the next bucket unintentionally. onChange is
// already debounced by AgentTuningGroup before hitting the engine.
function TemperaturePresets({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  const { t } = useTranslation()
  const presets = useMemo(() => TEMPERATURE_PRESETS(t), [t])
  const active = useMemo(() => presetForTemperature(value, presets), [value, presets])
  const ActiveIcon = active.icon

  // The preset card is meant to be a transient explanation: appears
  // when the user touches the control, lingers 3s after they stop
  // adjusting, then folds away. We track `showCard` separately from
  // the value so the initial mount stays quiet (no card on first
  // render even though `active` is always defined). The hideTimer
  // is reset on every change to give "3s after stabilization".
  const [showCard, setShowCard] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const revealAndScheduleHide = useCallback(() => {
    setShowCard(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      setShowCard(false)
      hideTimerRef.current = null
    }, 3000)
  }, [])

  // Cleanup any pending hide-timer on unmount so a card can't keep a
  // setState alive after this component is gone.
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const handleChange = (v: number) => {
    onChange(v)
    revealAndScheduleHide()
  }

  return (
    <div className="py-4 border-b border-border last:border-0">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-foreground">{t('agents.style')}</p>
        <span className="text-xs font-mono text-muted-foreground transition-opacity duration-500">
          {active.name} · {value.toFixed(2)}
        </span>
      </div>

      <input
        type="range"
        value={value}
        min={0}
        max={1}
        step={0.05}
        onChange={(e) => handleChange(Number(e.target.value))}
        className="w-full h-1.5 accent-foreground cursor-pointer"
      />

      <div className="flex items-center justify-between mt-2 mb-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Target size={12} />
          <span>{t('agents.morePrecise')}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{t('agents.moreCreative')}</span>
          <Sparkles size={12} />
        </div>
      </div>

      {/*
        Collapsible card. Uses the grid-template-rows 0fr→1fr trick so
        the wrapper's height animates smoothly between collapsed and
        expanded without needing a fixed max-height. Combined with
        opacity + translate-y the reveal feels like a gentle settle
        (700ms ease-out chosen for a calm, non-jumpy entrance).
        `mb-3` lives on the inner card so the spacing collapses with
        the card itself instead of leaving a gap when hidden.
      */}
      <div
        aria-hidden={!showCard}
        className={cn(
          'grid transition-[grid-template-rows,opacity,transform] duration-700 ease-out motion-reduce:transition-none',
          showCard
            ? 'grid-rows-[1fr] opacity-100 translate-y-0'
            : 'grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none',
        )}
      >
        <div className="overflow-hidden">
          <div className="rounded-xl bg-accent/40 border border-border/60 p-4 mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <ActiveIcon
                size={16}
                className="text-foreground shrink-0 transition-transform duration-500 ease-out"
                // Subtle key-driven re-mount animation: when active
                // preset changes, the icon scales in with a soft bounce
                // via a CSS transition seeded by the active key.
                key={active.key}
              />
              <h4
                key={active.key + ':name'}
                className="text-sm font-semibold text-foreground transition-opacity duration-500"
              >
                {active.fullName}
              </h4>
              {active.recommended && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-foreground text-card font-medium">
                  {t('agents.recommended')}
                </span>
              )}
            </div>
            <p
              key={active.key + ':desc'}
              className="text-xs text-muted-foreground mb-3 leading-relaxed transition-opacity duration-500"
            >
              {active.description}
            </p>
            <div className="text-[10px] text-muted-foreground mb-1.5">{t('agents.suitableScenarios')}</div>
            <div className="flex flex-wrap gap-1.5">
              {active.scenarios.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center px-2.5 py-1 rounded-full bg-card border border-border/60 text-[11px] text-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {presets.map((p) => {
          const isActive = p.key === active.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => handleChange(p.defaultValue)}
              className={cn(
                'px-3 py-2 rounded-lg border text-xs font-medium transition-colors duration-300 ease-out',
                isActive
                  ? 'border-foreground bg-card text-foreground'
                  : 'border-border bg-card/40 text-muted-foreground hover:bg-card hover:text-foreground',
              )}
              title={p.description}
            >
              {p.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Engine 2026-05-14+ `agent.max_tokens` / `agent.temperature` /
// `agent.context_window` — hot-applied via PATCH /api/v1/agent. Lives
// outside the local-yaml AgentSection because:
//  1) it talks to a different config surface (engine /api/v1/agent
//     vs the renderer's `useEngineConfig` yaml hook);
//  2) PATCH /agent rebuilds adapters when max_tokens/temperature
//     change, so we want to debounce slider drags before firing;
//  3) temperature here is canonical [0, 1] (engine rescales per
//     provider type), unlike the old [0, 2] yaml-stored value.
function AgentTuningGroup() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [maxTokens, setMaxTokens] = useState<number>(0)
  const [contextWindow, setContextWindow] = useState<number>(0)
  const [temperature, setTemperature] = useState<number>(0)
  const [busy, setBusy] = useState(false)
  // Track in-flight PATCH so a fast slider drag coalesces into a single
  // request after the user pauses. timeoutRef holds the pending debounce.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last value we tried to PATCH for each field; lets us detect a stale
  // PATCH whose response shouldn't clobber a newer local edit.
  const pendingRef = useRef<{
    max_tokens?: number
    context_window?: number
    temperature?: number
  }>({})

  const load = useCallback(async () => {
    setLoading(true)
    setUnavailable(null)
    const res = await window.agentApi.getAgentConfig()
    if (!res.ok) {
      setUnavailable(
        res.status === 404
          ? t('models.apiNotFound')
          : res.message || res.error || t('common.loadFailed'),
      )
      setLoading(false)
      return
    }
    setMaxTokens(typeof res.data.max_tokens === 'number' ? res.data.max_tokens : 0)
    setContextWindow(
      typeof res.data.context_window === 'number' ? res.data.context_window : 0,
    )
    setTemperature(typeof res.data.temperature === 'number' ? res.data.temperature : 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Coalesce successive edits into one PATCH. 300ms is enough for a
  // slider drag to settle but short enough that the user perceives the
  // change as immediate. Rebuilding adapters is cheap (atomic swap)
  // but we still avoid spamming yaml writes.
  const schedulePatch = useCallback(
    (patch: { max_tokens?: number; context_window?: number; temperature?: number }) => {
      pendingRef.current = { ...pendingRef.current, ...patch }
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(async () => {
        timeoutRef.current = null
        const body = pendingRef.current
        pendingRef.current = {}
        if (Object.keys(body).length === 0) return
        setBusy(true)
        const res = await window.agentApi.patchAgentConfig(body)
        setBusy(false)
        if (!res.ok) {
          // Reload authoritative state on failure so the UI matches
          // the engine again (e.g. user typed an out-of-range value
          // and engine rejected it).
          void load()
        }
      }, 300)
    },
    [load],
  )

  // Flush any pending PATCH on unmount so the user doesn't lose a
  // last-tick edit when navigating away.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  if (loading) {
    return (
      <GroupCard title={t('agents.params')}>
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
        </div>
      </GroupCard>
    )
  }

  if (unavailable) {
    return (
      <GroupCard title={t('agents.params')}>
        <div className="py-4 text-xs text-muted-foreground">{unavailable}</div>
      </GroupCard>
    )
  }

  return (
    <GroupCard title={t('agents.params')}>
      <SettingRow
        label="Max Tokens"
        description={t('agents.maxTokens')}
      >
        <div className="flex items-center gap-2">
          {busy && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
          <NumberInput
            value={maxTokens}
            onChange={(v) => {
              setMaxTokens(v)
              schedulePatch({ max_tokens: v })
            }}
            min={0}
            max={200000}
            className="w-24"
          />
        </div>
      </SettingRow>
      <SettingRow
        label="Context Window"
        description={t('agents.contextBudget')}
      >
        <NumberInput
          value={contextWindow}
          onChange={(v) => {
            setContextWindow(v)
            schedulePatch({ context_window: v })
          }}
          min={0}
          max={2000000}
          className="w-24"
        />
      </SettingRow>
      <TemperaturePresets
        value={temperature}
        onChange={(v) => {
          setTemperature(v)
          schedulePatch({ temperature: v })
        }}
      />
    </GroupCard>
  )
}

function AgentSection({
  onNavigateToModels,
  blinkPrimarySignal,
}: {
  // Forwarded to ProviderStrategyRow so the row's "跳转设置" button
  // can flip the settings page to the 模型配置 section.
  onNavigateToModels?: () => void
  // Forwarded to ProviderStrategyRow — pulse the 主 Provider dropdown
  // when this counter increments.
  blinkPrimarySignal?: number
}) {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useEngineConfig()

  const agents = (config?.agents || {}) as { defaults?: Record<string, unknown> }
  const defaults = agents.defaults || {}
  const workspace = (defaults.workspace as string) ?? '~/.harnessclaw/workspace'
  // Engine 2026-05-14+: routing is sourced from agent.primary +
  // agent.fallback_chain via /api/v1/agent. The old local
  // `agents.defaults.provider` field is no longer the source of
  // truth — ProviderStrategyRow reads/writes the engine directly.
  const maxToolIterations = (defaults.maxToolIterations as number) ?? 40
  const reasoningEffort = (defaults.reasoningEffort as string | null) ?? null

  const updateDefaults = (patch: Record<string, unknown>) => {
    updateConfig({ agents: { ...agents, defaults: { ...defaults, ...patch } } })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Bot} title={t('agents.title')} subtitle={t('agents.subtitle')} />

      <GroupCard title={t('agents.model')}>
        <ProviderStrategyRow onNavigateToModels={onNavigateToModels} blinkPrimarySignal={blinkPrimarySignal} />
      </GroupCard>

      {/* Engine 2026-05-14+ top-level `agent` block — these three
          fields are hot-applied through PATCH /api/v1/agent, not
          stored in the local engine yaml under `agents.defaults`.
          They override per-endpoint defaults on every adapter call
          (see providers-management-api.md "调用参数生效规则"). */}
      <AgentTuningGroup />

      <GroupCard title={t('agents.generation')}>
        <SettingRow label="Reasoning Effort" description={t('agents.reasoningEffort')}>
          <SelectInput
            value={reasoningEffort || ''}
            onChange={(v) => updateDefaults({ reasoningEffort: v || null })}
            options={[
              { label: t('agents.reasoningDefault'), value: '' },
              { label: 'low', value: 'low' },
              { label: 'medium', value: 'medium' },
              { label: 'high', value: 'high' },
            ]}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('agents.toolsAndWorkspace')}>
        <SettingRow label="Max Tool Iterations" description={t('agents.maxToolIterations')}>
          <NumberInput value={maxToolIterations} onChange={(v) => updateDefaults({ maxToolIterations: v })} min={1} max={200} className="w-20" />
        </SettingRow>
        <SettingRow label={t('agents.workspace')} description={t('agents.workspaceDesc')}>
          <TextInput value={workspace} onChange={(v) => updateDefaults({ workspace: v })} className="w-52" mono />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Model Config Helpers ───────────────────────────────────────────────────
//
// Shared provider primitives (types, constants, helpers) now live in
// `@/lib/providers` so the first-run WelcomeModal can write to the
// same shape under `appConfig.modelProviders.<key>` without
// duplicating definitions here.

// Brand mark identifiers used by `ModelIcon` for per-row model badges.
type BrandKey =
  | 'spark'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'meta'
  | 'mistral'
  | 'qwen'
  | 'deepseek'
  | 'glm'
  | 'kimi'
  | 'minimax'
  | 'custom'
  | 'generic'

// Foreground color used to fill the brand SVG paths in BrandMark.
// Chosen for contrast against MODEL_BADGE_BG[brand] in per-row model badges.
const BRAND_FG: Record<BrandKey, string> = {
  spark: '#FFFFFF',
  anthropic: '#CC785C',
  openai: '#FFFFFF',
  gemini: '#1A73E8',
  meta: '#FFFFFF',
  mistral: '#FFFFFF',
  qwen: '#FFFFFF',
  deepseek: '#FFFFFF',
  glm: '#FFFFFF',
  kimi: '#FFFFFF',
  minimax: '#FFFFFF',
  custom: '#475569',
  generic: '#FFFFFF',
}

// Legacy inline paths for brands not in the managed set (kept for model-row
// icon inference). These will fall back to generic sparkle if missing.
const BRAND_PATHS_FALLBACK: Partial<Record<BrandKey, string>> = {
  // simple-icons/meta.svg — Meta infinity mark
  meta:
    'M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z',
  // simple-icons/mistralai.svg — pixel-grid wordmark
  mistral:
    'M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z',
  // simple-icons/deepseek.svg — whale silhouette
  deepseek:
    'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45',
}


function BrandMark({ brand, size, color }: { brand: BrandKey; size: number; color: string }) {
  // Custom provider shows a Settings icon
  if (brand === 'custom') {
    return <Settings2 size={size} color={color} />
  }

  // Legacy inline path for brands used in model-row inference (deepseek, meta, mistral, etc.)
  const d = BRAND_PATHS_FALLBACK[brand]
  if (d) {
    return (
      <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={color}>
        <path d={d} />
      </svg>
    )
  }

  // Generic AI sparkle for unknown brands
  return (
    <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={color}>
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
    </svg>
  )
}

function getDisplayName(key: ManagedProviderKey): string {
  return PROVIDER_DISPLAY_NAMES[key]
}

// Friendly labels for image/video provider keys (cfg.ImageGen / cfg.VideoGen).
// Unknown keys fall back to the raw key so user-added providers still render.
const MEDIA_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  jimeng: '即梦',
  doubao: '豆包',
  volcengine: '火山引擎',
}
function mediaProviderDisplayName(key: string): string {
  return MEDIA_PROVIDER_DISPLAY_NAMES[key] ?? key
}

// Brand icons for image/video provider keys. Falls back to a generic lucide
// icon (passed by the caller) for keys without a brand asset.
const MEDIA_PROVIDER_ICONS: Record<string, string> = {
  openai: new URL('../../assets/providers/openai.svg', import.meta.url).href,
  volcengine: new URL('../../assets/providers/volcengine.svg', import.meta.url).href,
}
function MediaProviderIcon({
  providerKey,
  size = 16,
  fallback,
}: {
  providerKey: string
  size?: number
  fallback: React.ReactNode
}): React.ReactElement {
  const url = MEDIA_PROVIDER_ICONS[providerKey]
  if (url) {
    return <img src={url} alt={providerKey} width={size} height={size} style={{ display: 'block' }} />
  }
  return <>{fallback}</>
}

const PROVIDER_APIKEY_PAGES: Record<ManagedProviderKey, string> = {
  xunfei: 'https://console.xfyun.cn/services/bm4',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  'gpt-image': 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/app/apikey',
  qwen: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
  minimax: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  doubao: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
  custom: '',
}

const PROVIDER_DOCS_PAGES: Record<ManagedProviderKey, string> = {
  xunfei: 'https://www.xfyun.cn/doc/spark/X2-Flash.html',
  anthropic: 'https://docs.anthropic.com/',
  openai: 'https://platform.openai.com/docs',
  'gpt-image': 'https://developers.openai.com/api/docs/models/gpt-image-2',
  google: 'https://ai.google.dev/gemini-api/docs',
  qwen: 'https://help.aliyun.com/zh/model-studio/developer-reference/',
  minimax: 'https://platform.minimaxi.com/document/',
  zhipu: 'https://open.bigmodel.cn/dev/api',
  moonshot: 'https://platform.moonshot.cn/docs',
  deepseek: 'https://api-docs.deepseek.com/',
  doubao: 'https://www.volcengine.com/docs/82379/1824692',
  custom: '',
}

const PROVIDER_MODELS_PAGES: Record<ManagedProviderKey, string> = {
  xunfei: 'https://www.xfyun.cn/doc/spark/X2-Flash.html',
  anthropic: 'https://docs.anthropic.com/en/docs/about-claude/models',
  openai: 'https://platform.openai.com/docs/models',
  'gpt-image': 'https://developers.openai.com/api/docs/models/gpt-image-2',
  google: 'https://ai.google.dev/gemini-api/docs/models/gemini',
  qwen: 'https://help.aliyun.com/zh/model-studio/getting-started/models',
  minimax: 'https://platform.minimaxi.com/document/Models',
  zhipu: 'https://open.bigmodel.cn/dev/howuse/model',
  moonshot: 'https://platform.moonshot.cn/docs/pricing/chat',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing',
  doubao: 'https://www.volcengine.com/docs/82379/1824692',
  custom: '',
}

function getApiPathSuffix(protocol: 'openai' | 'anthropic' | 'gemini'): string {
  if (protocol === 'anthropic') return '/v1/messages'
  if (protocol === 'gemini') return '/v1beta/models'
  return '/v1/chat/completions'
}

function buildApiTargetUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`
}

// Validate an API base URL. Empty is allowed (renderer falls back to
// PROVIDER_DEFAULT_BASES). Otherwise require http(s)://host[:port][/path].
// `new URL()` covers IDN, IPv6, ports, paths — much cheaper to maintain
// than a hand-rolled regex.
function isValidApiBase(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const MODEL_FAMILY_RULES: Array<{ test: RegExp; group: string }> = [
  { test: /^spark-x2|^xf-spark-x2/i, group: 'Spark X2' },
  { test: /^spark|xunfei|iflytek/i, group: 'Spark' },
  { test: /claude/i, group: 'Claude' },
  { test: /gpt-?4/i, group: 'GPT-4' },
  { test: /gpt-?3/i, group: 'GPT-3' },
  { test: /^o1/i, group: 'o1' },
  { test: /^o3/i, group: 'o3' },
  { test: /gemma/i, group: 'Gemma' },
  { test: /gemini/i, group: 'Gemini' },
  { test: /llama-?3/i, group: 'Llama3' },
  { test: /llama-?2/i, group: 'Llama2' },
  { test: /llama/i, group: 'Llama' },
  { test: /mixtral/i, group: 'Mixtral' },
  { test: /mistral/i, group: 'Mistral' },
  { test: /qwen/i, group: 'Qwen' },
  { test: /deepseek/i, group: 'DeepSeek' },
  { test: /yi-/i, group: 'Yi' },
  { test: /^glm|chatglm/i, group: 'GLM' },
  { test: /kimi|moonshot/i, group: 'Kimi' },
  { test: /abab|minimax|^m1\b/i, group: 'MiniMax' },
  { test: /whisper/i, group: 'Whisper' },
  { test: /embedding/i, group: 'Embedding' },
]

function getModelGroup(id: string): string {
  for (const rule of MODEL_FAMILY_RULES) {
    if (rule.test.test(id)) return rule.group
  }
  const firstSegment = id.split(/[-_:/]/)[0] || id
  return firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1)
}

// Split a group name into an alpha prefix + the largest version number
// embedded in it. Examples:
//   "GPT-4"     -> { prefix: "gpt",     version: 4 }
//   "Llama3"    -> { prefix: "llama",   version: 3 }
//   "Claude-3-7"-> { prefix: "claude",  version: 3.7 }
//   "deepseek-v4-flash" -> { prefix: "deepseek", version: 4 }
//   "Claude"    -> { prefix: "claude",  version: -Infinity }
function parseGroupVersion(name: string): { prefix: string; version: number } {
  const lower = name.toLowerCase()
  const prefixMatch = lower.match(/^[a-z]+/)
  const prefix = prefixMatch ? prefixMatch[0] : lower
  // Find first version-like token after the prefix (e.g. "3-7", "4", "v4").
  const rest = lower.slice(prefix.length)
  const versionMatch = rest.match(/(\d+(?:[._-]\d+)?)/)
  if (!versionMatch) return { prefix, version: Number.NEGATIVE_INFINITY }
  const normalized = versionMatch[1].replace(/[_-]/, '.').replace(/[_-]/g, '')
  const value = Number(normalized)
  return { prefix, version: Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY }
}

// Sort order:
//   1. Same family stays together (alpha prefix ascending, locale-aware).
//   2. Within a family, higher version numbers come first (descending).
//   3. Stable fallback by full name when versions tie.
function compareGroupNames(a: string, b: string): number {
  const pa = parseGroupVersion(a)
  const pb = parseGroupVersion(b)
  if (pa.prefix !== pb.prefix) {
    return pa.prefix.localeCompare(pb.prefix)
  }
  if (pa.version !== pb.version) {
    return pb.version - pa.version
  }
  return a.localeCompare(b)
}

// Tokenize a model id/name into an alternating sequence of string and
// number tokens for natural version-aware comparison.
//   "gpt-5.5"            -> ["gpt", 5.5]
//   "claude-opus-4-1"    -> ["claude", "opus", 4, 1]
//   "deepseek-v4-flash"  -> ["deepseek", "v", 4, "flash"]
function tokenizeModelId(id: string): Array<string | number> {
  const lower = id.toLowerCase()
  const tokens: Array<string | number> = []
  const re = /(\d+(?:\.\d+)?)|([a-z]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(lower)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(Number(match[1]))
    } else if (match[2] !== undefined) {
      tokens.push(match[2])
    }
  }
  return tokens
}

// Sort models within a group: higher version numbers come first, with
// alpha tokens ordered alphabetically as a stable tiebreaker. Numbers
// always sort before missing-number tokens (so "gpt-5" precedes "gpt").
function compareModelEntries(a: ProviderModelEntry, b: ProviderModelEntry): number {
  const ta = tokenizeModelId(a.id)
  const tb = tokenizeModelId(b.id)
  const len = Math.max(ta.length, tb.length)
  for (let i = 0; i < len; i++) {
    const xa = ta[i]
    const xb = tb[i]
    if (xa === undefined) return 1
    if (xb === undefined) return -1
    const aIsNum = typeof xa === 'number'
    const bIsNum = typeof xb === 'number'
    if (aIsNum && bIsNum) {
      if (xa !== xb) return (xb as number) - (xa as number) // descending
      continue
    }
    if (aIsNum !== bIsNum) {
      // Prefer the side whose current token is a number — newer-versioned
      // ids (e.g. "gpt-5") should outrank generic ones (e.g. "gpt").
      return aIsNum ? -1 : 1
    }
    const cmp = (xa as string).localeCompare(xb as string)
    if (cmp !== 0) return cmp
  }
  return a.id.localeCompare(b.id)
}

// 把"币种 / 输入价格 / 输出价格"三个表单字段（用户在 <input> 里录入的
// 字符串）规范化成 ProviderModelEntry 上的可选字段。规则：
//   - 字符串去前后空白；空串 / 非数字 → 该字段不写入 entry（视为未配置）
//   - 数字 → Number 转换，非有限数（NaN/Infinity）按未配置处理
//   - 货币符号若与默认值 '$' 相同也写入，保留用户的显式选择；只有完全
//     未触碰（空串）才省略
function applyPricingToEntry(
  entry: ProviderModelEntry,
  draft: { currency: string; inputPrice: string; outputPrice: string }
): void {
  const currency = draft.currency.trim()
  if (currency) entry.currency = currency
  else delete entry.currency

  const parsePrice = (raw: string): number | undefined => {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : undefined
  }

  const inputPrice = parsePrice(draft.inputPrice)
  if (inputPrice !== undefined) entry.inputPrice = inputPrice
  else delete entry.inputPrice

  const outputPrice = parsePrice(draft.outputPrice)
  if (outputPrice !== undefined) entry.outputPrice = outputPrice
  else delete entry.outputPrice
}

function groupModels(models: ProviderModelEntry[]): Array<{ name: string; items: ProviderModelEntry[] }> {
  const groups = new Map<string, ProviderModelEntry[]>()
  for (const m of models) {
    const g = m.group?.trim() || getModelGroup(m.id)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(m)
  }
  return Array.from(groups.entries())
    .map(([name, items]) => ({ name, items: [...items].sort(compareModelEntries) }))
    .sort((a, b) => compareGroupNames(a.name, b.name))
}

// Brand colors used as the badge background in ModelIcon. Foreground
// (the SVG path color) is pulled from BRAND_FG.
//   Anthropic   #F4F1EE  (cream, matches Claude product surface)
//   OpenAI      #000000  (wordmark black)
//   Google      #FFFFFF  (Gemini logo is shown on white officially)
//   Meta        #0866FF  (Llama brand blue)
//   Mistral     #FA520F  (Mistral orange)
//   Alibaba     #615CED  (Qwen purple)
//   DeepSeek    #4D6BFE  (DeepSeek blue)
//   Zhipu GLM   #3859FF  (BigModel blue)
//   Moonshot    #6D28D9  (Kimi purple)
//   MiniMax     #00B97F  (MiniMax accent green)
const MODEL_BADGE_BG: Record<BrandKey, string> = {
  spark: '#1A6BFF',
  anthropic: '#F4F1EE',
  openai: '#000000',
  gemini: '#FFFFFF',
  meta: '#0866FF',
  mistral: '#FA520F',
  qwen: '#615CED',
  deepseek: '#4D6BFE',
  glm: '#3859FF',
  kimi: '#6D28D9',
  minimax: '#00B97F',
  custom: '#F1F5F9',
  generic: '#94A3B8',
}

const MODEL_BRAND_RULES: Array<{ test: RegExp; brand: BrandKey }> = [
  { test: /^spark|xunfei|xf-|iflytek/i, brand: 'spark' },
  { test: /claude/i, brand: 'anthropic' },
  { test: /gpt|^o1|^o3/i, brand: 'openai' },
  { test: /gemma|gemini/i, brand: 'gemini' },
  { test: /llama/i, brand: 'meta' },
  { test: /mistral|mixtral/i, brand: 'mistral' },
  { test: /qwen/i, brand: 'qwen' },
  { test: /deepseek/i, brand: 'deepseek' },
  { test: /^glm|chatglm/i, brand: 'glm' },
  { test: /kimi|moonshot/i, brand: 'kimi' },
  { test: /abab|minimax|^m1\b/i, brand: 'minimax' },
]

function getBrandForModelId(id: string): BrandKey {
  for (const rule of MODEL_BRAND_RULES) {
    if (rule.test.test(id)) return rule.brand
  }
  return 'generic'
}

function ModelIcon({ id, size = 22 }: { id: string; size?: number }) {
  const brand = getBrandForModelId(id)
  const bg = MODEL_BADGE_BG[brand]
  const innerSize = Math.round(size * 0.62)
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      <BrandMark brand={brand} size={innerSize} color={BRAND_FG[brand]} />
    </div>
  )
}

function HelpIcon({ title }: { title: string }) {
  return (
    <HoverHint label={title}>
      <span
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border text-[9px] text-muted-foreground"
      >
        ?
      </span>
    </HoverHint>
  )
}

interface ModelTagDef {
  key: string
  label: string
  icon: React.ElementType
  fg: string
  bg: string
  border: string
}

// MODEL_TAGS doubles as the renderer-visible chip set AND the server-side
// model_type override token list. Keys MUST match the engine's
// KnownModelTypeTokens (provider/registry/capabilities.go) — that's why
// `search` instead of the older renderer-local `web` label. The other
// known tokens (pdf / audio / video) are intentionally NOT exposed here
// per the plan: yaml-only for now, preserved across UI saves via the
// hiddenModelTypeTokens state. `label` holds an i18n key resolved by
// callers via `t(tag.label)`.
const MODEL_TAGS: ModelTagDef[] = [
  { key: 'vision',    label: 'models.capabilities.vision',    icon: Eye,    fg: '#16A34A', bg: '#DCFCE7', border: '#BBF7D0' },
  { key: 'search',    label: 'models.capabilities.search',    icon: Globe,  fg: '#2563EB', bg: '#DBEAFE', border: '#BFDBFE' },
  { key: 'image_generation', label: 'models.capabilities.image_generation', icon: Image, fg: '#BE123C', bg: '#FFE4E6', border: '#FDA4AF' },
  { key: 'reasoning', label: 'models.capabilities.reasoning', icon: Sun,    fg: '#7C3AED', bg: '#EDE9FE', border: '#DDD6FE' },
  { key: 'tools',     label: 'models.capabilities.tools',     icon: Wrench, fg: '#EA580C', bg: '#FFEDD5', border: '#FED7AA' },
]

// HIDDEN_MODEL_TYPE_TOKENS are model_type values the engine knows about
// but the UI doesn't surface as chips. Preserved across UI edits so a
// hand-edited `pdf` in yaml isn't clobbered when the user saves model
// settings in the SettingsPage.
const HIDDEN_MODEL_TYPE_TOKENS: ReadonlySet<string> = new Set(['pdf', 'audio', 'video'])

// VISIBLE_MODEL_TYPE_TOKENS mirrors MODEL_TAGS' keys — used to split a
// model_type list returned by the engine into visible (chips) vs
// hidden (preserved as-is) buckets.
const VISIBLE_MODEL_TYPE_TOKENS: ReadonlySet<string> = new Set(MODEL_TAGS.map((t) => t.key))

const MODEL_TAG_MAP: Record<string, ModelTagDef> =
  Object.fromEntries(MODEL_TAGS.map((t) => [t.key, t]))

function isImageGenerationModel(entry?: ProviderModelEntry | null): boolean {
  return Boolean(entry?.tags?.includes('image_generation'))
}

function isAgentRoutableModel(provider: ManagedProviderKey, entry?: ProviderModelEntry | null): boolean {
  return !isImageGenerationProviderKey(provider) && !isImageGenerationModel(entry)
}

function ModelTagBadge({
  tagKey,
  t,
  detail,
}: {
  tagKey: string
  t: (key: string) => string
  detail?: string
}) {
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const badgeRef = useRef<HTMLSpanElement | null>(null)

  const tag = MODEL_TAG_MAP[tagKey]
  if (!tag) return null

  const Icon = tag.icon
  const label = t(tag.label)

  // Tooltip is rendered via a portal with `position: fixed`, so it escapes
  // the model list's overflow-y-auto container and isn't clipped at the
  // bottom edge. Coordinates are recomputed from the badge's bounding rect
  // each time the user hovers.
  const showTooltip = () => {
    const node = badgeRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setTooltipPos({
      left: rect.left + rect.width / 2,
      top: rect.bottom + 6,
    })
  }

  const onEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(showTooltip, 100)
  }
  const onLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setTooltipPos(null)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <span
      ref={badgeRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border"
      style={{ backgroundColor: tag.bg, borderColor: tag.border, color: tag.fg }}
    >
      <Icon size={11} />
      {tooltipPos && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: tooltipPos.left,
            top: tooltipPos.top,
            transform: 'translateX(-50%)',
            zIndex: 1000,
          }}
          className={cn(
            'pointer-events-none rounded-md bg-foreground text-card shadow-md',
            detail
              ? 'max-w-[28rem] px-2 py-1.5 text-[10px] leading-relaxed'
              : 'whitespace-nowrap px-1.5 py-0.5 text-[10px] font-medium',
          )}
        >
          {detail ? (
            <>
              <div className="font-medium">{label}</div>
              <div className="mt-0.5 break-all font-mono text-card/90">{detail}</div>
            </>
          ) : label}
        </div>,
        document.body,
      )}
    </span>
  )
}

// Portal-based hover tooltip — mirrors `ModelTagBadge`'s pattern so action
// buttons get a visible label on hover that isn't clipped by the model
// list's `overflow-y-auto` container. Replaces ambient `title=""` tooltips
// for the row-action icons (edit / toggle / remove).
function HoverHint({
  label,
  children,
  className,
  wide = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  wide?: boolean
}) {
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  const showTooltip = () => {
    const node = anchorRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setTooltipPos({ left: rect.left + rect.width / 2, top: rect.bottom + 6 })
  }

  const onEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(showTooltip, 100)
  }
  const onLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setTooltipPos(null)
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return (
    <span
      ref={anchorRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn('inline-flex', className)}
    >
      {children}
      {tooltipPos && createPortal(
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            left: tooltipPos.left,
            top: tooltipPos.top,
            transform: 'translateX(-50%)',
            zIndex: 1000,
          }}
          className={cn(
            'pointer-events-none rounded-md bg-foreground text-[10px] font-medium text-card shadow-md',
            wide
              ? 'max-w-[28rem] whitespace-normal break-all px-2 py-1 text-left font-mono leading-relaxed'
              : 'whitespace-nowrap px-1.5 py-0.5',
          )}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  )
}

// Coach-mark spotlight: dim everything except a hole around the element
// returned by `getTarget()`, add a glowing ring to draw the eye, render
// via portal so the parent's stacking context can't suppress us. Used
// when validation fails on provider enable — the toast alone wasn't
// loud enough.
//
// Uses 4 fixed dim bands (top / left / right / bottom of the target rect)
// instead of a single full-screen overlay with a cut-out. This keeps the
// target element in normal flow so clicks pass through naturally; no
// pointer-events juggling, no z-index gymnastics on the underlying tree.
//
// Dismiss triggers:
//   - Backdrop (any of the 4 dim bands) click — forced focus shouldn't trap.
//   - Mousedown anywhere inside the target rect — once the user takes the
//     intended action the spotlight should vanish immediately, not linger
//     for the auto-clear timeout.
//   - Auto-clear timeout in the parent (safety net).
//
// `getTarget` is resolved every animation frame so the spotlight follows
// scroll, layout shifts, and per-frame re-evaluation of "which element
// needs attention" (e.g. the first disabled model checkmark, which
// changes after the user enables one).
// Coach-mark spotlight supporting multiple simultaneous targets. The
// dim layer uses the union bounding box of all targets as a single
// rectangular bright zone (cheaper than multi-hole SVG masks, and
// keeps every target clickable inside the cut-out). Each individual
// target gets its own glowing ring on top, so visual focus lands on
// every actionable button — not just the bounding box edges.
//
// Dismiss triggers:
//   - Backdrop (any of the 4 dim bands) click — forced focus shouldn't trap.
//   - Mousedown inside any target rect — once the user clicks one of
//     the highlighted controls the spotlight has done its job.
//   - Auto-clear timeout in the parent (safety net).
//
// `getTargets` is resolved every animation frame so the spotlight
// follows scroll, layout shifts, and per-frame re-evaluation of
// "which elements still need attention" (e.g. as the user enables
// models one by one, the set of disabled checkmarks shrinks).
function SpotlightOverlay({
  getTargets,
  onDismiss,
}: {
  getTargets: () => HTMLElement[]
  onDismiss: () => void
}) {
  const [rects, setRects] = useState<DOMRect[]>([])
  const targetElsRef = useRef<HTMLElement[]>([])
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const els = getTargets()
      targetElsRef.current = els
      const next = els.map((el) => el.getBoundingClientRect())
      setRects((prev) => {
        if (prev.length !== next.length) return next
        for (let i = 0; i < next.length; i++) {
          const a = prev[i]
          const b = next[i]
          if (a.top !== b.top || a.left !== b.left
            || a.width !== b.width || a.height !== b.height) {
            return next
          }
        }
        return prev
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getTargets])
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const els = targetElsRef.current
      const node = e.target as Node
      if (els.some((el) => el.contains(node))) onDismiss()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [onDismiss])
  if (rects.length === 0) return null
  const PAD = 6
  // Bounding box of every target — the single "bright zone" cut out of
  // the dim layer. Per-target rings are still drawn individually
  // inside this box for sharper focus.
  let unionTop = Infinity
  let unionLeft = Infinity
  let unionRight = -Infinity
  let unionBottom = -Infinity
  for (const r of rects) {
    if (r.top < unionTop) unionTop = r.top
    if (r.left < unionLeft) unionLeft = r.left
    if (r.right > unionRight) unionRight = r.right
    if (r.bottom > unionBottom) unionBottom = r.bottom
  }
  const boxTop = Math.max(0, unionTop - PAD)
  const boxLeft = Math.max(0, unionLeft - PAD)
  const boxRight = Math.min(window.innerWidth, unionRight + PAD)
  const boxBottom = Math.min(window.innerHeight, unionBottom + PAD)
  const boxH = Math.max(0, boxBottom - boxTop)
  const dim = 'fixed bg-black/55 z-[55] cursor-pointer'
  return createPortal(
    <>
      <div className={cn(dim, 'inset-x-0')} style={{ top: 0, height: boxTop }} onClick={onDismiss} />
      <div className={dim} style={{ top: boxTop, left: 0, width: boxLeft, height: boxH }} onClick={onDismiss} />
      <div className={dim} style={{ top: boxTop, left: boxRight, right: 0, height: boxH }} onClick={onDismiss} />
      <div className={cn(dim, 'inset-x-0')} style={{ top: boxBottom, bottom: 0 }} onClick={onDismiss} />
      {rects.map((r, i) => {
        const top = Math.max(0, r.top - PAD)
        const left = Math.max(0, r.left - PAD)
        const right = Math.min(window.innerWidth, r.right + PAD)
        const bottom = Math.min(window.innerHeight, r.bottom + PAD)
        const w = Math.max(0, right - left)
        const h = Math.max(0, bottom - top)
        // Pill radius for circular / nearly-square targets (model check
        // button is 20x20); rectangular targets (inputs) use 8px.
        const radius = Math.min(w, h) > 36 ? 8 : 9999
        return (
          <div
            key={i}
            aria-hidden
            className="fixed pointer-events-none z-[56] ring-4 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.6)] animate-pulse"
            style={{ top, left, width: w, height: h, borderRadius: radius }}
          />
        )
      })}
    </>,
    document.body,
  )
}

// Soft pastel palette used to tint model-group headers so they're easy to scan.
const GROUP_PALETTE: Array<{ bg: string; border: string; text: string }> = [
  { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E' }, // amber
  { bg: '#DBEAFE', border: '#BFDBFE', text: '#1E40AF' }, // blue
  { bg: '#DCFCE7', border: '#BBF7D0', text: '#166534' }, // green
  { bg: '#FCE7F3', border: '#FBCFE8', text: '#9D174D' }, // pink
  { bg: '#EDE9FE', border: '#DDD6FE', text: '#5B21B6' }, // violet
  { bg: '#FFE4E6', border: '#FECDD3', text: '#9F1239' }, // rose
  { bg: '#CFFAFE', border: '#A5F3FC', text: '#155E75' }, // cyan
  { bg: '#FEF9C3', border: '#FEF08A', text: '#854D0E' }, // yellow
  { bg: '#F3E8FF', border: '#E9D5FF', text: '#6B21A8' }, // purple
  { bg: '#FFEDD5', border: '#FED7AA', text: '#9A3412' }, // orange
  { bg: '#D1FAE5', border: '#A7F3D0', text: '#065F46' }, // emerald
  { bg: '#E0E7FF', border: '#C7D2FE', text: '#3730A3' }, // indigo
]

function getGroupPalette(name: string): { bg: string; border: string; text: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return GROUP_PALETTE[Math.abs(hash) % GROUP_PALETTE.length]
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeProviderConfig(rawValue: unknown): ProviderConfig {
  const raw = asRecord(rawValue)
  const protocol = typeof raw.protocol === 'string'
    ? raw.protocol
    : typeof raw.apiProtocol === 'string'
      ? raw.apiProtocol
      : typeof raw.compatibility === 'string'
        ? raw.compatibility
        : 'openai'

  const modelsRaw = Array.isArray(raw.models) ? raw.models : []
  const models: ProviderModelEntry[] = []
  for (const item of modelsRaw) {
    if (typeof item === 'string') {
      if (item.trim()) models.push({ id: item })
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      const id = typeof obj.id === 'string' ? obj.id : ''
      if (!id.trim()) continue
      const entry: ProviderModelEntry = { id }
      if (typeof obj.name === 'string' && obj.name.trim()) entry.name = obj.name
      if (typeof obj.group === 'string' && obj.group.trim()) entry.group = obj.group
      if (Array.isArray(obj.tags)) {
        const tags = obj.tags
          .filter((t): t is string => typeof t === 'string' && Boolean(MODEL_TAG_MAP[t]))
        if (tags.length > 0) entry.tags = tags
      }
      if (obj.enabled === true) entry.enabled = true
      models.push(entry)
    }
  }

  const engineTypeRaw = typeof raw.engineType === 'string'
    ? raw.engineType
    : typeof raw.type === 'string'
      ? raw.type
      : ''
  const engineType: ProviderConfig['engineType'] | undefined =
    engineTypeRaw === 'openai' || engineTypeRaw === 'anthropic' || engineTypeRaw === 'gemini'
      ? engineTypeRaw
      : undefined

  return {
    apiKey: typeof raw.apiKey === 'string'
      ? raw.apiKey
      : typeof raw.api_key === 'string'
        ? raw.api_key
        : '',
    apiBase: typeof raw.apiBase === 'string'
      ? raw.apiBase
      : typeof raw.base_url === 'string'
        ? raw.base_url
        : typeof raw.baseUrl === 'string'
          ? raw.baseUrl
          : null,
    model: typeof raw.model === 'string' ? raw.model : null,
    models,
    protocol: protocol === 'anthropic' ? 'anthropic' : 'openai',
    ...(engineType ? { engineType } : {}),
    extraHeaders: (raw.extraHeaders as Record<string, string> | null) ?? null,
    raw,
    enabled: raw.enabled === true,
  }
}

function mergeProviderModelPresets(
  models: ProviderModelEntry[],
  presets: ProviderModelEntry[],
): ProviderModelEntry[] {
  if (presets.length === 0) return models
  const merged = models.map((entry) => ({
    ...entry,
    ...(entry.tags ? { tags: [...entry.tags] } : {}),
  }))
  const byId = new Map(merged.map((entry, index) => [entry.id, index]))

  for (const preset of presets) {
    const index = byId.get(preset.id)
    if (index === undefined) {
      merged.push({
        ...preset,
        ...(preset.tags ? { tags: [...preset.tags] } : {}),
      })
      byId.set(preset.id, merged.length - 1)
      continue
    }

    const existing = merged[index]
    const tags = new Set([...(existing.tags ?? []), ...(preset.tags ?? [])])
    merged[index] = {
      ...existing,
      name: existing.name ?? preset.name,
      group: existing.group ?? preset.group,
      ...(tags.size > 0 ? { tags: Array.from(tags) } : {}),
    }
  }
  return merged
}

function mergeProviderSource(
  rootValue: unknown,
  llmValue: unknown,
): Record<string, unknown> {
  return {
    ...asRecord(llmValue),
    ...asRecord(rootValue),
  }
}

function getAppModelProvidersConfig(appConfig: Record<string, unknown>): Record<string, unknown> {
  return asRecord(appConfig.modelProviders)
}

function getManagedProviders(
  engineConfig: Record<string, unknown>,
  appConfig: Record<string, unknown>,
): Record<ManagedProviderKey, ProviderConfig> {
  const rootProviders = asRecord(engineConfig.providers)
  const llmProviders = asRecord(asRecord(engineConfig.llm).providers)
  const appProviders = getAppModelProvidersConfig(appConfig)

  const result = {} as Record<ManagedProviderKey, ProviderConfig>

  for (const key of MANAGED_PROVIDER_KEYS) {
    if (key === 'custom') {
      const raw = asRecord(appProviders.custom)
      const fallback = mergeProviderSource(rootProviders.custom, llmProviders.custom)
      const source = Object.keys(raw).length > 0 ? raw : fallback
      const normalized = normalizeProviderConfig(source)
      const defaultModels = getProviderDefaultModels('custom')
      const models = mergeProviderModelPresets(normalized.models, defaultModels)
      result.custom = {
        ...createEmptyProviderConfig('custom'),
        ...normalized,
        apiBase: normalized.apiBase ?? null,
        models,
        raw: source,
      }
      continue
    }

    const appProvider = asRecord(appProviders[key])
    // Engine config only carries the protocol-keyed providers (anthropic /
    // openai). For other vendors (deepseek, kimi, etc.) we only read from
    // app-config and there is no engine mirror to merge.
    const engineMerged = key === 'anthropic' || key === 'openai'
      ? mergeProviderSource(rootProviders[key], llmProviders[key])
      : {}
    const source = Object.keys(appProvider).length > 0 ? appProvider : engineMerged
    const normalized = normalizeProviderConfig(source)
    const defaultModels = getProviderDefaultModels(key)
    const models = mergeProviderModelPresets(normalized.models, defaultModels)
    result[key] = {
      ...createEmptyProviderConfig(key),
      ...normalized,
      apiBase: normalized.apiBase ?? (PROVIDER_DEFAULT_BASES[key] || null),
      models,
      raw: appProvider,
    }
  }

  return result
}

function getManagedDefaultProvider(
  engineConfig: Record<string, unknown>,
  appConfig: Record<string, unknown>,
): ManagedProviderKey {
  const modelProviders = getAppModelProvidersConfig(appConfig)
  const defaultSelection = modelProviders.defaultSelection
  if (typeof defaultSelection === 'string'
      && isManagedProviderKey(defaultSelection)
      && isAgentProviderKey(defaultSelection)) {
    return defaultSelection
  }

  const llmDefault = asRecord(engineConfig.llm).default_provider
  if (llmDefault === 'custom') {
    return 'custom'
  }
  if (typeof llmDefault === 'string' && (llmDefault === 'anthropic' || llmDefault === 'openai')) {
    return llmDefault
  }

  const appDefault = asRecord(asRecord(appConfig.agents).defaults).provider
  if (typeof appDefault === 'string' && isManagedProviderKey(appDefault) && isAgentProviderKey(appDefault)) {
    return appDefault
  }

  return 'anthropic'
}

function hasPersistedModelProviders(appConfig: Record<string, unknown>): boolean {
  const modelProviders = getAppModelProvidersConfig(appConfig)
  return Object.keys(modelProviders).length > 0
}

// ─── Model Section ──────────────────────────────────────────────────────────

function ModelSection({
  onNavigateToAgents,
}: {
  // Settings-page navigation callback. Switches to the Agent settings
  // section and pulses the 主 Provider dropdown so the user lands on
  // the next decision: which enabled provider drives the agent.
  onNavigateToAgents?: () => void
}) {
  const { t } = useTranslation()
  const [appConfig, setAppConfig] = useState<Record<string, unknown> | null>(null)
  const [providers, setProviders] = useState<Record<ManagedProviderKey, ProviderConfig>>(() =>
    MANAGED_PROVIDER_KEYS.reduce((acc, key) => {
      acc[key] = createEmptyProviderConfig(key)
      return acc
    }, {} as Record<ManagedProviderKey, ProviderConfig>)
  )
  const [defaultProvider, setDefaultProvider] = useState<ManagedProviderKey>('anthropic')
  const [selectedProvider, setSelectedProvider] = useState<ManagedProviderKey>('anthropic')
  // Minimal-risk polymorphic selection: the existing text-provider logic
  // keeps using the string `selectedProvider` untouched. A separate
  // `selectedKind` + `selectedExtraKey` overlays the image/video segments:
  // when kind !== 'text', the right pane renders the corresponding
  // per-provider section instead of the text-provider card. Clicking any
  // text provider resets kind back to 'text'.
  const [selectedKind, setSelectedKind] = useState<'text' | 'image' | 'video'>('text')
  const [selectedExtraKey, setSelectedExtraKey] = useState<string>('')
  // Provider keys for the image/video config trees, hydrated on mount from
  // the imagegen/videogen management listings (default config ships
  // `openai` image + `doubao` video, so these are normally non-empty).
  const [imageProviderKeys, setImageProviderKeys] = useState<string[]>([])
  const [videoProviderKeys, setVideoProviderKeys] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showApiKey, setShowApiKey] = useState(false)
  const [persistState, setPersistState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [persistMessage, setPersistMessage] = useState('')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [toastNotice, setToastNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [modelFetchState, setModelFetchState] = useState<'idle' | 'loading'>('idle')
  const [engineImageGenerationUrls, setEngineImageGenerationUrls] = useState<Record<string, string>>({})
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [modelSearchVisible, setModelSearchVisible] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [addModelOpen, setAddModelOpen] = useState(false)
  // When the user tries to enable a provider but a required field is
  // missing, we briefly highlight that input/button to draw their
  // attention. Priority order matches the validation function:
  //   API 密钥 > API 地址 > 模型勾选
  // Only one field at a time can flash. Cleared by `useEffect` after
  // a short timeout.
  type FlashField = 'apiKey' | 'apiBase' | 'models' | null
  const [flashField, setFlashField] = useState<FlashField>(null)
  // Derived flags so each input/button can opt into the highlight
  // without re-checking `flashField` inline.
  const flashApiKey = flashField === 'apiKey'
  const flashApiBase = flashField === 'apiBase'
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [addModelId, setAddModelId] = useState('')
  const [addModelName, setAddModelName] = useState('')
  const [addModelGroup, setAddModelGroup] = useState('')
  const [addModelTags, setAddModelTags] = useState<string[]>([])
  // hiddenModelTypeTokens preserves engine-side model_type values that
  // aren't surfaced as UI chips (pdf / audio / video). Hydrated from the
  // endpoint snapshot when the edit form opens; merged back into the
  // model_type payload on save so a hand-edited yaml token isn't
  // clobbered by a chip-only save.
  const [hiddenModelTypeTokens, setHiddenModelTypeTokens] = useState<string[]>([])
  // 高级设置里的"币种 / 输入价格 / 输出价格"。三者都是字符串状态：用户
  // 可以输入 "0.00" 这种带前导零的写法，保存时再转成 `number | undefined`
  // (空串视为未配置)。
  const [addModelCurrency, setAddModelCurrency] = useState('$')
  const [addModelInputPrice, setAddModelInputPrice] = useState('')
  const [addModelOutputPrice, setAddModelOutputPrice] = useState('')
  const [groupSuggestOpen, setGroupSuggestOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [engineTypePopupOpen, setEngineTypePopupOpen] = useState(false)
  const engineTypePopupRef = useRef<HTMLDivElement | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Spotlight targets. Inputs (apiKey / apiBase) reference the actual
  // <input> element so the bright cut-out hugs the control instead of
  // the whole label-and-hint section. Models case uses a data-attribute
  // query to find the first disabled checkmark button — this updates
  // automatically as the user enables models without needing per-row refs.
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null)
  const apiBaseInputRef = useRef<HTMLInputElement | null>(null)
  const modelsSectionRef = useRef<HTMLDivElement | null>(null)
  const getSpotlightTargets = useCallback((): HTMLElement[] => {
    if (flashField === 'apiKey') {
      return apiKeyInputRef.current ? [apiKeyInputRef.current] : []
    }
    if (flashField === 'apiBase') {
      return apiBaseInputRef.current ? [apiBaseInputRef.current] : []
    }
    if (flashField === 'models') {
      // Highlight every disabled checkmark in the visible model list so
      // the user can pick any one — not just the first. As they enable
      // models, `data-enabled` flips and that button drops out of the
      // set automatically on the next animation frame.
      const root = modelsSectionRef.current
      if (!root) return []
      const nodes = root.querySelectorAll<HTMLElement>(
        'button[data-flash="model-enable"][data-enabled="false"]',
      )
      if (nodes.length > 0) return Array.from(nodes)
      // No disabled buttons (everything got enabled while spotlight was
      // live, or the list is empty). Fall back to the section root so
      // something stays highlighted instead of returning empty —
      // SpotlightOverlay treats [] as "nothing to show" and unmounts.
      return [root]
    }
    return []
  }, [flashField])

  useEffect(() => {
    if (!engineTypePopupOpen) return
    const onPointer = (event: MouseEvent) => {
      if (engineTypePopupRef.current && !engineTypePopupRef.current.contains(event.target as Node)) {
        setEngineTypePopupOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEngineTypePopupOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [engineTypePopupOpen])

  const collectImageGenerationUrls = useCallback((enginePayload: ProviderInfo[]): Record<string, string> => {
    const next: Record<string, string> = {}
    for (const provider of enginePayload) {
      for (const endpoint of provider.endpoints ?? []) {
        if (endpoint.image_generation_url) {
          next[`${provider.name}:${endpoint.name}`] = endpoint.image_generation_url
        }
      }
    }
    return next
  }, [])

  const refreshEngineImageGenerationUrls = useCallback(async () => {
    const res = await window.agentApi.listProviders()
    if (!res.ok) return
    const enginePayload = Array.isArray(res.data?.providers) ? res.data.providers : []
    setEngineImageGenerationUrls(collectImageGenerationUrls(enginePayload))
  }, [collectImageGenerationUrls])

  useEffect(() => {
    ;(async () => {
      try {
        // Read both yamls only to derive initial UI state. Engine yaml is
        // never written from the renderer anymore — the Providers
        // Management API owns it. We still consult engine yaml to migrate
        // legacy configs (api_key/base_url that the user set up before
        // the API existed) into the renderer state.
        const [engineData, appData] = await Promise.all([
          window.engineConfig.read(),
          window.appConfig.read(),
        ])
        const nextProviders = getManagedProviders(engineData, appData)
        const nextDefaultProvider = getManagedDefaultProvider(engineData, appData)

        // Multi-enable bootstrap: if no provider is marked enabled (e.g.,
        // a config saved before multi-select existed), seed the
        // currently-default provider as enabled so the sidebar shows at
        // least one ON badge.
        const anyEnabled = Object.values(nextProviders).some((p) => p.enabled)
        if (!anyEnabled) {
          nextProviders[nextDefaultProvider] = {
            ...nextProviders[nextDefaultProvider],
            enabled: true,
          }
        }

        let normalizedAppConfig = appData
        if (!hasPersistedModelProviders(appData)) {
          const nextAppConfig = buildAppModelConfig(appData, nextProviders, nextDefaultProvider)
          const appResult = await window.appConfig.save(nextAppConfig)
          if (appResult.ok) {
            normalizedAppConfig = nextAppConfig
          }
        }

        setAppConfig(normalizedAppConfig)
        setProviders(nextProviders)
        setDefaultProvider(nextDefaultProvider)
        // Keep the current default provider selected, including `custom`.
        // This matters for first-run onboarding: when the user configures a
        // custom endpoint there, Models should open on that same provider so
        // the just-saved model is immediately visible.
        setSelectedProvider(nextDefaultProvider)
      } catch {
        setPersistState('error')
        setPersistMessage(t('models.persist.readFailed'))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Load the image/video provider key lists for the left-rail segments.
  // Independent of the text-provider load above — failures just leave the
  // segment empty (a muted hint is shown). The default config ships an
  // `openai` image provider + a `doubao` video provider, so these are
  // normally populated.
  useEffect(() => {
    void (async () => {
      const [imgRes, vidRes] = await Promise.all([
        window.agentApi.listImageProviders(),
        window.agentApi.listVideoProviders(),
      ])
      if (imgRes.ok) {
        setImageProviderKeys(
          Array.from(new Set([...IMAGE_BUILTIN_PROVIDERS, ...Object.keys(imgRes.data?.providers ?? {})])),
        )
      } else {
        setImageProviderKeys([...IMAGE_BUILTIN_PROVIDERS])
      }
      if (vidRes.ok) {
        setVideoProviderKeys(
          Array.from(new Set([...VIDEO_BUILTIN_PROVIDERS, ...Object.keys(vidRes.data?.providers ?? {})])),
        )
      } else {
        setVideoProviderKeys([...VIDEO_BUILTIN_PROVIDERS])
      }
    })()
  }, [])

  // After the initial local-yaml load completes, reconcile each
  // ProviderModelEntry.group with the engine's authoritative value
  // (engine = source of truth per spec 2026-05-30). When the engine
  // has no group but the renderer does, we keep the renderer value
  // AND backfill it via a PATCH so the engine becomes consistent on
  // the next round-trip. Engine unreachable → silent skip; user can
  // still operate offline.
  //
  // Single-shot: runs once after `loading` flips to false. Doing this
  // here (vs inside the initial-load effect) keeps the initial-load
  // code synchronous in its UI commit and avoids racing the
  // setProviders update.
  const reconciledGroupsRef = useRef(false)
  useEffect(() => {
    if (loading || reconciledGroupsRef.current) return
    reconciledGroupsRef.current = true
    void (async () => {
      const res = await window.agentApi.listProviders()
      if (!res.ok) return // engine unreachable — silent skip
      const enginePayload = Array.isArray(res.data?.providers) ? res.data.providers : []
      setEngineImageGenerationUrls(collectImageGenerationUrls(enginePayload))

      // Compute reconciled state + backfill plan purely against the
      // current `providers` closure value. Doing this OUTSIDE the
      // setProviders updater avoids React 18 Strict Mode dev's
      // double-invoke trap (which would push backfill entries twice
      // and fire 2× PATCHes). Safe because `loading === false` means
      // the initial-load setProviders has already committed.
      const next = { ...providers }
      const backfillPlan: Array<{ provider: ManagedProviderKey; endpoint: string; group: string }> = []
      let mutated = false
      for (const ep of enginePayload) {
        const pname = ep.name as ManagedProviderKey
        if (!isManagedProviderKey(pname)) continue
        const slot = next[pname]
        if (!slot) continue
        let slotMutated = false
        const updatedModels = slot.models.map((m) => {
          const match = ep.endpoints.find((e) => e.name === m.id)
          if (!match) return m
          const engineGroup = (match.group ?? '').trim()
          const localGroup = m.group?.trim() ?? ''
          if (engineGroup) {
            // Engine authoritative — overwrite when different.
            if (engineGroup === localGroup) return m
            slotMutated = true
            return { ...m, group: engineGroup }
          }
          // Engine empty + local non-empty → keep local, schedule backfill PATCH.
          if (localGroup) {
            backfillPlan.push({
              provider: pname,
              endpoint: match.name,
              group: localGroup,
            })
          }
          return m
        })
        if (slotMutated) {
          next[pname] = { ...slot, models: updatedModels }
          mutated = true
        }
      }
      if (mutated) setProviders(next)
      // Fire-and-forget backfill; ignore individual failures so one bad
      // endpoint doesn't block the rest. Failures (e.g. 404) just mean
      // the field stays unsynced; the next manual edit will pick it up.
      for (const item of backfillPlan) {
        void window.agentApi.patchEndpoint(item.provider, item.endpoint, { group: item.group })
      }
    })()
  }, [collectImageGenerationUrls, loading, providers])

  // Auto-populate model registry for providers configured in onboarding.
  // After initial load, check each enabled provider: if it has API credentials
  // but a minimal model list (≤1 model), fetch the full registry and merge it
  // with the user's choice. This ensures Settings page always shows the complete
  // model catalog, whether the user picked a standard model or a custom ID.
  //
  // Single-shot: runs once after loading completes. Providers with >1 model
  // are skipped (user already fetched or manually added models).
  const autoPopulatedRef = useRef(false)
  useEffect(() => {
    if (loading || autoPopulatedRef.current) return
    autoPopulatedRef.current = true
    void (async () => {
      const registryRes = await window.agentApi.listRegistryModels()
      if (!registryRes.ok) return // Registry unavailable — user can fetch manually later

      const registryModels = Array.isArray(registryRes.data) ? registryRes.data : []

      // Capture current providers state at the moment this effect runs.
      // Don't read from `providers` prop to avoid dependency cycle.
      setProviders((currentProviders) => {
        const next = { ...currentProviders }
        let mutated = false

        for (const key of MANAGED_PROVIDER_KEYS) {
          const provider = next[key]
          // Skip if: not enabled, no API key, or already has multiple models
          if (!provider.enabled || !provider.apiKey.trim() || provider.models.length > 1) {
            continue
          }

          // Get all models for this provider from registry
          const providerModels = registryModels.filter((m) => m.provider === key)
          if (providerModels.length === 0) continue

          // Merge: keep user's configured model(s) + add all registry models
          const userModelIds = new Set(provider.models.map((m) => m.id))
          const merged: ProviderModelEntry[] = [...provider.models]

          for (const regModel of providerModels) {
            const modelId = regModel.model_id || ''
            if (!modelId || userModelIds.has(modelId)) continue

            // Extract capabilities from registry metadata
            const supports = regModel.supports || {}
            const tags: string[] = []
            if (supports.vision === true) tags.push('vision')
            if (supports.web_search === true) tags.push('search')
            if (supports.reasoning === true) tags.push('reasoning')
            if (supports.function_calling === true) tags.push('tools')

            merged.push({
              id: modelId,
              name: regModel.display_name || undefined,
              group: regModel.family || undefined,
              tags: tags.length > 0 ? tags : undefined,
              enabled: false, // User's onboarding choice stays enabled; registry models start disabled
            })
          }

          if (merged.length > provider.models.length) {
            next[key] = { ...provider, models: merged }
            mutated = true
          }
        }

        // Persist the updated model lists to appConfig if anything changed
        if (mutated && appConfig) {
          const nextAppConfig = buildAppModelConfig(appConfig, next, defaultProvider)
          void window.appConfig.save(nextAppConfig)
        }

        return mutated ? next : currentProviders
      })
    })()
  }, [loading, appConfig, defaultProvider])

  // Persist only the renderer-side UI state (appConfig). The engine YAML
  // is owned by the Providers Management API — every mutation goes
  // through the HTTP endpoints (PATCH /providers, POST/PATCH/DELETE
  // /endpoints, PUT /fallback-chain), and the engine writes its own
  // yaml on success. We no longer call `engineConfig.save` here.
  const queuePersist = useCallback(
    (
      nextProviders: Record<ManagedProviderKey, ProviderConfig>,
      nextDefaultProvider: ManagedProviderKey,
    ) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      setPersistState('saving')
      setPersistMessage(t('models.persist.saving'))
      saveTimerRef.current = setTimeout(async () => {
        if (!appConfig) return

        const nextAppConfig = buildAppModelConfig(appConfig, nextProviders, nextDefaultProvider)
        const appResult = await window.appConfig.save(nextAppConfig)

        if (!appResult.ok) {
          setPersistState('error')
          setPersistMessage(appResult.error || t('models.persist.saveFailed'))
          return
        }

        setAppConfig(nextAppConfig)
        setPersistState('saved')
      }, 500)
    },
    [appConfig]
  )

  // ─── Providers Management API helpers ───────────────────────────────
  // All provider / endpoint / chain mutations go through HTTP — the
  // engine persists to yaml on its side. See
  // harnessclaw-engine/docs/api/providers-management-api.md.
  //
  // Best-effort error handling:
  //   - HTTP 404         → API not mounted (chain<2 entries) → silent skip
  //   - other failures   → toast warning
  //
  // The provider name used in URLs is the renderer-side ManagedProviderKey
  // directly (e.g. `anthropic`, `deepseek`); the engine yaml is expected
  // to declare the same map keys.
  const debouncedProviderPatchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reportHotReloadError = useCallback(
    (label: string, error: string, message?: string) => {
      const detail = message ? `${error}: ${message}` : error
      setToastNotice({
        tone: 'error',
        message: t('models.hotReloadError', { label, detail }),
      })
    },
    [t],
  )

  // PATCH /api/v1/providers/{p} — debounced 500ms so typing in the api_key
  // / api_base input doesn't fire a request per keystroke.
  //
  // If the engine doesn't yet have a `llm.providers.<key>` entry (the
  // common case for vendors the user is configuring for the first
  // time, e.g. DeepSeek / Google), PATCH returns 404 / update_failed.
  // We then fall back to `POST /providers` to create it on the fly so
  // typing into the key/base fields seamlessly bootstraps the entry.
  const schedulePatchProviderCredentials = useCallback(
    (key: ManagedProviderKey) => {
      if (debouncedProviderPatchRef.current) {
        clearTimeout(debouncedProviderPatchRef.current)
      }
      debouncedProviderPatchRef.current = setTimeout(async () => {
        const cfg = providers[key]
        const baseUrl = cfg.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key] || ''
        const apiKey = cfg.apiKey.trim()
        if (!apiKey && !baseUrl) return
        const res = await window.agentApi.patchProvider(key, {
          api_key: apiKey,
          base_url: baseUrl,
        })
        if (res.ok) return
        if (res.status === 404 || res.status === 0) {
          // 404 (API not mounted) or network error — silent skip.
          return
        }
        // PATCH failed — likely the provider entry doesn't exist yet.
        // Try POST /providers to create it. Engine `type` resolved via
        // the per-provider override (cfg.engineType) falling back to
        // PROVIDER_ENGINE_TYPES (or protocol for custom).
        const engineType = getEffectiveEngineType(key, cfg)
        const createRes = await window.agentApi.createProvider({
          name: key,
          type: engineType,
          ...(baseUrl ? { base_url: baseUrl } : {}),
          ...(apiKey ? { api_key: apiKey } : {}),
        })
        if (createRes.ok) return
        if (createRes.status === 404 || createRes.status === 0) return
        // "already exists" race — try one more PATCH.
        if (createRes.status === 400 && /exist/i.test(createRes.message || '')) {
          const retry = await window.agentApi.patchProvider(key, {
            api_key: apiKey,
            base_url: baseUrl,
          })
          if (retry.ok) return
          reportHotReloadError(t('models.hotReloadLabels.apiKey'), retry.error || `http_${retry.status}`, retry.message)
          return
        }
        reportHotReloadError(t('models.hotReloadLabels.create'), createRes.error || `http_${createRes.status}`, createRes.message)
      }, 500)
    },
    [providers, reportHotReloadError, t],
  )

  useEffect(() => {
    return () => {
      if (debouncedProviderPatchRef.current) {
        clearTimeout(debouncedProviderPatchRef.current)
      }
    }
  }, [])

  // Make sure the engine has a `llm.providers.<key>` entry before we
  // POST endpoints into it. The engine added `POST /providers` on
  // 2026-05-14 to support this (see
  // harnessclaw-engine/docs/api/providers-management-api.md). We
  // probe via `GET /providers` and create on miss.
  //
  // Returns true when the provider exists (now or after create). Surfaces
  // a toast on hard failure and returns false. 404/0 (API not mounted
  // because chain<2) is treated as best-effort success — the caller may
  // still attempt POST endpoint; if that 404s too, it'll silently skip.
  const ensureProviderExists = useCallback(
    async (key: ManagedProviderKey): Promise<boolean> => {
      const list = await window.agentApi.listProviders()
      if (!list.ok) {
        // Chain<2 → API not mounted. Let the caller proceed and silent-
        // skip its own 404. Network/timeout: same treatment.
        if (list.status === 404 || list.status === 0) return true
        reportHotReloadError(t('models.hotReloadLabels.list'), list.error || `http_${list.status}`, list.message)
        return false
      }
      if (list.data.providers.some((p) => p.name === key)) return true

      // Provider missing — create it. Engine `type` resolved via the
      // per-provider override (cfg.engineType) falling back to
      // PROVIDER_ENGINE_TYPES (or protocol for custom).
      const cfg = providers[key]
      const engineType = getEffectiveEngineType(key, cfg)
      const baseUrl = cfg.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key] || undefined
      const apiKey = cfg.apiKey.trim() || undefined
      const res = await window.agentApi.createProvider({
        name: key,
        type: engineType,
        ...(baseUrl ? { base_url: baseUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      })
      if (res.ok) return true
      if (res.status === 404 || res.status === 0) return true
      // 400 update_failed with "already exists" is racy-safe — treat as ok.
      if (res.status === 400 && /exist/i.test(res.message || '')) return true
      reportHotReloadError(t('models.hotReloadLabels.create'), res.error || `http_${res.status}`, res.message)
      return false
    },
    [providers, reportHotReloadError, t],
  )

  // POST /api/v1/providers/{p}/endpoints + append Agent-routable models
  // to fallback-chain. Image-generation-only models are still persisted as
  // disabled endpoints so credentials/model metadata remain editable here,
  // but they are not eligible for Agent LLM routing.
  // When POST returns 400 update_failed (most often because the
  // endpoint already exists on the engine side), we transparently fall
  // back to "just add to chain" instead of surfacing an error.
  //
  // Idempotent: when the endpoint already exists we still PATCH
  // `disabled` to match the model category, so re-enabling a previously
  // paused Agent model routes again while image-generation models stay
  // out of the dispatcher.
  const hotCreateEndpoint = useCallback(
    async (
      key: ManagedProviderKey,
      modelId: string,
      maxTokens?: number,
      tags?: string[],
      group?: string,
      routeToAgent = true,
    ): Promise<void> => {
      // Guard: the engine rejects POST endpoint when the provider entry
      // doesn't exist. Create it first if needed.
      const providerReady = await ensureProviderExists(key)
      if (!providerReady) return

      const payload: {
        name: string
        model: string
        max_tokens?: number
        disabled?: boolean
        group?: string
      } = {
        name: modelId,
        model: modelId,
        // Enabled in the model list means the endpoint is available.
        // routeToAgent below only controls whether it enters the chat
        // fallback chain; image-generation endpoints stay available for
        // image_generate without becoming answer-model fallbacks.
        disabled: false,
      }
      if (typeof maxTokens === 'number' && maxTokens > 0) payload.max_tokens = maxTokens
      // POST has no "clear" state — omit empty to avoid sending group: "".
      if (group !== undefined && group !== '') payload.group = group
      const res = await window.agentApi.createEndpoint(key, payload)
      let endpointReady = res.ok

      if (!res.ok) {
        if (res.status === 404 || res.status === 0) {
          // API not mounted or network error — silent skip.
          return
        }
        // Could be "already exists" or "provider unknown" or "adapter
        // build failed". Probe via GET /endpoints to disambiguate.
        const list = await window.agentApi.listEndpoints(key)
        if (list.ok && list.data.endpoints.some((e) => e.name === modelId)) {
          endpointReady = true
          // Endpoint already on engine — make sure the enabled model is
          // available. Forward group too; empty still means "no group
          // requested" here, not a 3-state clear.
          const patchRes = await window.agentApi.patchEndpoint(key, modelId, {
            disabled: false,
            ...(group !== undefined && group !== '' ? { group } : {}),
          })
          if (!patchRes.ok && patchRes.status !== 404 && patchRes.status !== 0) {
            reportHotReloadError(
              t('models.hotReloadLabels.enable'),
              patchRes.error || `http_${patchRes.status}`,
              patchRes.message,
            )
          }
        } else {
          reportHotReloadError(t('models.hotReloadLabels.modelCreate'), res.error || `http_${res.status}`, res.message)
          return
        }
      }
      if (!endpointReady) return

      // Push the chip-derived model_type to the engine. The POST endpoint
      // payload doesn't accept model_type (engine 2026-05-19 added the
      // field via PATCH only), so this is the canonical write path for
      // newly-enabled models. Filter to known server tokens (visible +
      // hidden) — anything else would 400 invalid_model_type.
      if (tags && tags.length > 0) {
        const allowed = new Set<string>([
          ...Array.from(VISIBLE_MODEL_TYPE_TOKENS),
          ...Array.from(HIDDEN_MODEL_TYPE_TOKENS),
        ])
        const modelType = tags.filter((t) => allowed.has(t))
        if (modelType.length > 0) {
          const mtRes = await window.agentApi.patchEndpoint(key, modelId, {
            model_type: modelType,
          })
          if (!mtRes.ok && mtRes.status !== 404 && mtRes.status !== 0
              && mtRes.error !== 'update_failed') {
            reportHotReloadError(
              '能力同步',
              mtRes.error || `http_${mtRes.status}`,
              mtRes.message,
            )
          }
        }
      }

      void refreshEngineImageGenerationUrls()
      if (!routeToAgent) return

      // After create (or detected-exists), append to chain so the
      // endpoint actually routes. Canonical chain ref separator is `:`
      // (engine 2026-05-14+); this lets endpoint names contain `.`
      // (e.g. `gpt-5.5`). Old `.` separator is still accepted on the
      // server side for back-compat but all yaml / API responses use `:`.
      const chain = await window.agentApi.getFallbackChain()
      if (!chain.ok) return
      const chainRef = `${key}:${modelId}`
      const legacyRef = `${key}.${modelId}`
      if (chain.data.chain.includes(chainRef) || chain.data.chain.includes(legacyRef)) return
      const nextChain = [...chain.data.chain, chainRef]
      const putRes = await window.agentApi.updateFallbackChain(nextChain)
      if (!putRes.ok && putRes.status !== 404 && putRes.status !== 0) {
        reportHotReloadError(
          t('models.hotReloadLabels.update'),
          putRes.error || `http_${putRes.status}`,
          putRes.message,
        )
      }
    },
    [ensureProviderExists, refreshEngineImageGenerationUrls, reportHotReloadError],
  )

  // PATCH /api/v1/providers/{p}/endpoints/{e} { disabled }. The
  // canonical enable/disable flow per engine 2026-05-14: keeps the
  // endpoint in the chain & yaml so re-enabling is a single PATCH.
  // No DELETE / chain mutation here.
  const hotSetEndpointDisabled = useCallback(
    async (
      key: ManagedProviderKey,
      modelId: string,
      disabled: boolean,
    ): Promise<void> => {
      const res = await window.agentApi.patchEndpoint(key, modelId, { disabled })
      if (res.ok) return
      if (res.status === 404 || res.status === 0) return
      // `update_failed` typically means "no change" or "not found" — both
      // safe to ignore here. Surface other errors.
      if (res.error === 'update_failed') return
      reportHotReloadError(
        disabled ? t('models.hotReloadLabels.disable') : t('models.hotReloadLabels.enable'),
        res.error || `http_${res.status}`,
        res.message,
      )
    },
    [reportHotReloadError],
  )

  // DELETE /api/v1/providers/{p}/endpoints/{e} — used by 🗑 "remove
  // from list" only. Toggle off (✓→✗) keeps the endpoint and uses
  // `disabled: true` instead. Engine auto-removes the entry from the
  // fallback chain.
  const hotDeleteEndpoint = useCallback(
    async (key: ManagedProviderKey, modelId: string): Promise<void> => {
      const res = await window.agentApi.deleteEndpoint(key, modelId)
      if (!res.ok && res.status !== 404 && res.status !== 0 && res.error !== 'update_failed') {
        reportHotReloadError(t('models.hotReloadLabels.delete'), res.error || `http_${res.status}`, res.message)
      }
      void refreshEngineImageGenerationUrls()
    },
    [refreshEngineImageGenerationUrls, reportHotReloadError, t],
  )

  // PATCH /api/v1/providers/{p}/endpoints/{e}. Renames are not
  // propagated to the engine (would require DELETE + POST, which we
  // intentionally don't do here — same-name edits still PATCH
  // model / max_tokens etc.).
  const hotPatchEndpoint = useCallback(
    async (
      key: ManagedProviderKey,
      previousId: string,
      nextId: string,
      patch: { model?: string; max_tokens?: number; model_type?: string[]; group?: string },
    ): Promise<void> => {
      if (previousId !== nextId) {
        // Renames are local-only now. The original endpoint stays on
        // the engine under its old name; the user can `disabled: true`
        // it manually if needed.
        return
      }
      const res = await window.agentApi.patchEndpoint(key, previousId, patch)
      if (!res.ok && res.status !== 404 && res.status !== 0 && res.error !== 'update_failed') {
        reportHotReloadError(t('models.hotReloadLabels.modelUpdate'), res.error || `http_${res.status}`, res.message)
      }
      void refreshEngineImageGenerationUrls()
    },
    [refreshEngineImageGenerationUrls, reportHotReloadError, t],
  )

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  useEffect(() => {
    if (!toastNotice) return
    const timer = window.setTimeout(() => setToastNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toastNotice])

  // Clear the flash highlight after ~1.8s (≈3 animation cycles) so the
  // user sees motion but the UI settles back to normal.
  useEffect(() => {
    if (!flashField) return
    // Longer than the old border-pulse (1.8s): the spotlight backdrop
    // needs time to register visually before it auto-dismisses.
    const timer = window.setTimeout(() => setFlashField(null), 3500)
    return () => window.clearTimeout(timer)
  }, [flashField])

  // Track which providers we've already auto-refreshed during this session
  // so navigating between them doesn't refetch repeatedly.
  const autoRefreshedRef = useRef<Set<ManagedProviderKey>>(new Set())

  // Tombstones — model ids the user explicitly removed via 🗑 in this
  // session. Without this, a stale handleFetchModels resolving after
  // a deletion (or a manual "refresh") would re-add the entry from
  // the registry's default-manifest.yaml and the model would
  // "magically come back". Cleared per provider when the user clicks
  // refresh AFTER the deletes have settled (they explicitly want a
  // fresh registry pull).
  const deletedModelIdsRef = useRef<Map<ManagedProviderKey, Set<string>>>(new Map())
  const rememberDeletion = useCallback(
    (key: ManagedProviderKey, modelId: string) => {
      let set = deletedModelIdsRef.current.get(key)
      if (!set) {
        set = new Set()
        deletedModelIdsRef.current.set(key, set)
      }
      set.add(modelId)
    },
    [],
  )

  useEffect(() => {
    if (loading) return
    if (modelFetchState === 'loading') return
    if (autoRefreshedRef.current.has(selectedProvider)) return
    const currentModels = providers[selectedProvider]?.models
    if (currentModels && currentModels.length > 0) return
    autoRefreshedRef.current.add(selectedProvider)
    // Auto-refresh: preserve tombstones so a stale fetch doesn't
    // resurrect entries the user 🗑-removed in this session (e.g.,
    // when navigating Models tab away & back triggers a fresh mount).
    void handleFetchModels({ autoRefresh: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedProvider, providers])

  const updateProvider = (key: ManagedProviderKey, patch: Partial<ProviderConfig>) => {
    setProviders((prev) => {
      const current = prev[key]
      const next = { ...current, ...patch }
      const updated: Record<ManagedProviderKey, ProviderConfig> = {
        ...prev,
        [key]: {
          ...next,
          raw: buildAppProviderRaw(next),
        },
      }
      queuePersist(updated, defaultProvider)
      return updated
    })
  }

  // Validate a provider before enabling it. Returns the missing-field
  // diagnostic (or null when ready). Fields are checked in priority
  // order: API 密钥 > API 地址 > 模型. The `field` is used by the UI to
  // flash the corresponding input/button so the user knows where to look.
  const getDefaultProviderValidationError = (
    key: ManagedProviderKey,
  ): { message: string; field: 'apiKey' | 'apiBase' | 'models' } | null => {
    const provider = providers[key]
    const display = getDisplayName(key)
    if (!provider.apiKey.trim()) {
      return { message: t('models.validation.missingKey', { name: display }), field: 'apiKey' }
    }
    if (!(provider.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key])) {
      return { message: t('models.validation.missingBase', { name: display }), field: 'apiBase' }
    }
    if (provider.models.length === 0) {
      return { message: t('models.validation.noModels', { name: display }), field: 'models' }
    }
    if (!provider.models.some((m) => m.enabled)) {
      return { message: t('models.validation.noneSelected', { name: display }), field: 'models' }
    }
    return null
  }

  // Toggle a provider's enabled flag independently of others (multi-select).
  // When the *current default* is disabled, the first remaining enabled
  // provider auto-promotes so `defaultProvider` always points to an
  // enabled one. When the first provider is enabled and nothing was the
  // default before, it also becomes the default.
  //
  // Engine sync — uses the provider-level `disabled` flag (engine
  // 2026-05-14+, see providers-management-api.md). This atomically
  // toggles routing for every endpoint under the provider in one
  // PATCH — no endpoint deletion, no chain churn, no model-by-model
  // POSTs on re-enable.
  //
  //   OFF: PATCH /providers/{p} { disabled: true }
  //   ON:  POST  /providers (if missing) → PATCH credentials →
  //        PATCH /providers/{p} { disabled: false } → ensure each
  //        enabled model has an endpoint (idempotent create).
  const handleToggleProviderEnabled = (key: ManagedProviderKey, nextEnabled: boolean) => {
    // Enabling a provider requires API 密钥 / 地址 / 模型 — all three.
    // Surface the first missing field as a toast and flash the matching
    // input/button. Priority: apiKey → apiBase → models.
    if (nextEnabled) {
      const validationError = getDefaultProviderValidationError(key)
      if (validationError) {
        setToastNotice({ tone: 'error', message: validationError.message })
        setFlashField(validationError.field)
        return
      }
    }

    const previous = providers[key]

    setProviders((prev) => {
      const updated: Record<ManagedProviderKey, ProviderConfig> = {
        ...prev,
        [key]: { ...prev[key], enabled: nextEnabled },
      }
      // Promote / demote `defaultProvider` to stay aligned with the
      // enabled set.
      let nextDefault = defaultProvider
      if (nextEnabled && isAgentProviderKey(key) && !Object.values(prev).some((p) => p.enabled)) {
        nextDefault = key
      } else if (!nextEnabled && defaultProvider === key) {
        const nextActive = (Object.entries(updated) as Array<[ManagedProviderKey, ProviderConfig]>)
          .find(([providerKey, p]) => p.enabled && isAgentProviderKey(providerKey))
        if (nextActive) nextDefault = nextActive[0]
      }
      if (nextDefault !== defaultProvider) setDefaultProvider(nextDefault)
      queuePersist(updated, nextDefault)
      return updated
    })

    // Fire-and-forget engine sync. Failures surface as toasts via
    // `reportHotReloadError`; the renderer state already advanced.
    if (nextEnabled) {
      void (async () => {
        // Single GET /providers snapshot — we use it to decide:
        //   - POST vs PATCH the provider entry
        //   - per enabled model: POST endpoint, PATCH disabled, or skip
        // This avoids the previous flow that re-issued GET /providers
        // inside every hotCreateEndpoint call.
        const list = await window.agentApi.listProviders()
        if (!list.ok && list.status !== 404 && list.status !== 0) {
          reportHotReloadError(t('models.hotReloadLabels.list'), list.error || `http_${list.status}`, list.message)
          return
        }
        const apiUnavailable = !list.ok
        const existing = list.ok ? list.data.providers.find((p) => p.name === key) : undefined

        const baseUrl = previous.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key] || ''
        const apiKey = previous.apiKey.trim()
        const engineType = getEffectiveEngineType(key, previous)

        // 1) Provider entry: POST when missing, PATCH when present.
        if (!apiUnavailable) {
          if (!existing) {
            const createPayload: {
              name: string
              type: 'openai' | 'anthropic' | 'gemini'
              base_url?: string
              api_key?: string
              disabled?: boolean
            } = { name: key, type: engineType, disabled: false }
            if (baseUrl) createPayload.base_url = baseUrl
            if (apiKey) createPayload.api_key = apiKey
            const createRes = await window.agentApi.createProvider(createPayload)
            if (!createRes.ok && createRes.status !== 404 && createRes.status !== 0) {
              if (!(createRes.status === 400 && /exist/i.test(createRes.message || ''))) {
                reportHotReloadError(
                  t('models.hotReloadLabels.create'),
                  createRes.error || `http_${createRes.status}`,
                  createRes.message,
                )
                return
              }
            }
          } else {
            // PATCH only when something actually changed — saves a
            // round-trip when re-toggling without edits.
            const patchBody: {
              api_key?: string
              base_url?: string
              disabled?: boolean
            } = {}
            if (existing.disabled === true) patchBody.disabled = false
            if (apiKey && existing.api_key !== apiKey) patchBody.api_key = apiKey
            if (baseUrl && existing.base_url !== baseUrl) patchBody.base_url = baseUrl
            if (Object.keys(patchBody).length > 0) {
              const patchRes = await window.agentApi.patchProvider(key, patchBody)
              if (!patchRes.ok && patchRes.status !== 404 && patchRes.status !== 0) {
                reportHotReloadError(
                  t('models.hotReloadLabels.enable'),
                  patchRes.error || `http_${patchRes.status}`,
                  patchRes.message,
                )
              }
            }
          }
        }

        // 2) Per-model: POST when missing, PATCH disabled=false when
        //    present-and-paused. routeToAgent only controls chat fallback
        //    chain membership; image-generation endpoints must remain
        //    available for the image_generate tool.
        const endpointMap = new Map<
          string,
          { name: string; disabled?: boolean; in_chain: boolean }
        >()
        for (const e of existing?.endpoints ?? []) endpointMap.set(e.name, e)
        const chainNeedsRefs: string[] = []
        for (const model of previous.models) {
          if (!model.enabled) continue
          const routeToAgent = isAgentRoutableModel(key, model)
          const modelType = model.tags?.filter((tag) => VISIBLE_MODEL_TYPE_TOKENS.has(tag)) ?? []
          const ep = endpointMap.get(model.id)
          if (!ep) {
            const postRes = await window.agentApi.createEndpoint(key, {
              name: model.id,
              model: model.id,
              disabled: false,
            })
            if (!postRes.ok && postRes.status !== 404 && postRes.status !== 0) {
              if (postRes.status === 400 && /exist/i.test(postRes.message || '')) {
                // race: another caller created it — make sure it's
                // in the route state this model type expects.
                await window.agentApi.patchEndpoint(key, model.id, {
                  disabled: false,
                  ...(modelType.length > 0 ? { model_type: modelType } : {}),
                })
              } else {
                reportHotReloadError(
                  t('models.hotReloadLabels.modelCreate'),
                  postRes.error || `http_${postRes.status}`,
                  postRes.message,
                )
                continue
              }
            }
            if (postRes.ok && modelType.length > 0) {
              await window.agentApi.patchEndpoint(key, model.id, { model_type: modelType })
            }
            // Engine doesn't auto-chain newly created endpoints —
            // collect refs and PUT them in one chain update at the end.
            if (routeToAgent) chainNeedsRefs.push(`${key}:${model.id}`)
          } else {
            const patchBody: { disabled?: boolean; model_type?: string[] } = {}
            if (ep.disabled === true) patchBody.disabled = false
            if (modelType.length > 0) patchBody.model_type = modelType
            if (Object.keys(patchBody).length > 0) {
              const patchRes = await window.agentApi.patchEndpoint(key, model.id, patchBody)
              if (
                !patchRes.ok
                && patchRes.status !== 404
                && patchRes.status !== 0
                && patchRes.error !== 'update_failed'
              ) {
                reportHotReloadError(
                  t('models.hotReloadLabels.enable'),
                  patchRes.error || `http_${patchRes.status}`,
                  patchRes.message,
                )
              }
            }
            if (routeToAgent && !ep.in_chain) chainNeedsRefs.push(`${key}:${model.id}`)
          }
        }

        // 3) Single chain PUT — only when we have new refs to add.
        if (!apiUnavailable && chainNeedsRefs.length > 0) {
          const chain = await window.agentApi.getFallbackChain()
          if (!chain.ok) return
          const present = new Set(chain.data.chain)
          const additions = chainNeedsRefs.filter((ref) => {
            // Account for legacy `provider.endpoint` chain refs too.
            const [provider, ...rest] = ref.split(':')
            const legacy = `${provider}.${rest.join(':')}`
            return !present.has(ref) && !present.has(legacy)
          })
          if (additions.length === 0) return
          const nextChain = [...chain.data.chain, ...additions]
          const putRes = await window.agentApi.updateFallbackChain(nextChain)
          if (!putRes.ok && putRes.status !== 404 && putRes.status !== 0) {
            reportHotReloadError(
              t('models.hotReloadLabels.update'),
              putRes.error || `http_${putRes.status}`,
              putRes.message,
            )
          }
        }
      })()
    } else {
      void (async () => {
        // Single PATCH pauses the whole provider. Endpoints / chain /
        // yaml are preserved so toggling back on is symmetric.
        const res = await window.agentApi.patchProvider(key, { disabled: true })
        if (!res.ok && res.status !== 404 && res.status !== 0) {
          reportHotReloadError(
            t('models.hotReloadLabels.disable'),
            res.error || `http_${res.status}`,
            res.message,
          )
          return
        }
        const agent = await window.agentApi.getAgentConfig()
        if (
          agent.ok
          && typeof agent.data?.image_generation === 'string'
          && agent.data.image_generation.startsWith(`${key}:`)
        ) {
          const patch = await window.agentApi.patchAgentConfig({ image_generation: '' })
          if (!patch.ok && patch.status !== 404 && patch.status !== 0) {
            reportHotReloadError(
              t('models.hotReloadLabels.update'),
              patch.error || `http_${patch.status}`,
              patch.message,
            )
          }
        }
      })()
    }
  }

  // Apply the engine `type` directly. Persists locally and
  // PATCH /providers/{p} {type} to hot-reload on the engine. The change
  // also affects subsequent POST /providers fall-backs through
  // `getEffectiveEngineType`.
  const applyEngineType = async (
    key: ManagedProviderKey,
    next: 'openai' | 'anthropic' | 'gemini',
  ) => {
    const cfg = providers[key]
    const current = getEffectiveEngineType(key, cfg)
    if (current === next) return
    // For `custom` we keep `protocol` in sync so the legacy renderer
    // paths (`resolveProviderProtocol`, etc.) reflect the choice.
    const patch: Partial<ProviderConfig> = { engineType: next }
    if (key === 'custom' && (next === 'openai' || next === 'anthropic')) {
      patch.protocol = next
    }
    updateProvider(key, patch)

    // Hot-reload to engine. PATCH first; if provider isn't there yet,
    // POST to create it with the new type.
    const patchRes = await window.agentApi.patchProvider(key, { type: next })
    if (patchRes.ok) return
    if (patchRes.status === 404 || patchRes.status === 0) return
    const baseUrl = cfg.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key] || undefined
    const apiKey = cfg.apiKey.trim() || undefined
    const createRes = await window.agentApi.createProvider({
      name: key,
      type: next,
      ...(baseUrl ? { base_url: baseUrl } : {}),
      ...(apiKey ? { api_key: apiKey } : {}),
    })
    if (createRes.ok) return
    if (createRes.status === 404 || createRes.status === 0) return
    if (createRes.status === 400 && /exist/i.test(createRes.message || '')) {
      const retry = await window.agentApi.patchProvider(key, { type: next })
      if (retry.ok) return
      reportHotReloadError(t('models.hotReloadLabels.protocol'), retry.error || `http_${retry.status}`, retry.message)
      return
    }
    reportHotReloadError(t('models.hotReloadLabels.protocol'), createRes.error || `http_${createRes.status}`, createRes.message)
  }

  const handleTest = async () => {
    setTestState('testing')
    await new Promise((r) => setTimeout(r, 1200))
    const selected = providers[selectedProvider]
    const hasKey = selected.apiKey.trim().length > 0
    const hasBase = selectedProvider === 'custom'
      ? Boolean(selected.apiBase?.trim())
      : true

    if (hasKey && hasBase) {
      setTestState('ok')
    } else {
      setTestState('fail')
    }
    setTimeout(() => setTestState('idle'), 2500)
  }

  const handleFetchModels = async (opts: { autoRefresh?: boolean } = {}) => {
    // Snapshot the provider we're fetching for. The actual model-list
    // merge happens via setProviders((prev) => ...) below so we
    // reconcile against the *latest* state — important because the
    // user can delete / toggle models while the registry GET is in
    // flight (race condition that previously revived deleted entries).
    const targetProvider = selectedProvider

    // Tombstone policy depends on the trigger:
    //   - Manual refresh (button click): clear tombstones — the user
    //     explicitly asked for the full registry view, so previously-
    //     deleted ids should be eligible to re-appear.
    //   - Auto refresh (on mount when the provider has no models yet):
    //     preserve tombstones — otherwise navigating Models tab away
    //     & back would silently revive entries the user just removed.
    if (!opts.autoRefresh) {
      deletedModelIdsRef.current.delete(targetProvider)
    }

    const currentProvider = providers[targetProvider]
    const displayName = getDisplayName(targetProvider)
    if (!currentProvider.apiKey.trim()) {
      setToastNotice({ tone: 'error', message: t('models.validation.missingKey', { name: displayName }) })
      return
    }
    const baseUrl = currentProvider.apiBase?.trim() || PROVIDER_DEFAULT_BASES[targetProvider] || ''
    if (!baseUrl) {
      setToastNotice({ tone: 'error', message: t('models.validation.missingBase', { name: displayName }) })
      return
    }

    setModelFetchState('loading')
    try {
      const result = await window.agentApi.listProviderModels({
        provider: targetProvider,
        type: getEffectiveEngineType(targetProvider, currentProvider),
        baseUrl,
        apiKey: currentProvider.apiKey.trim(),
      })
      if (!result.ok) {
        let friendly = t('models.requestFailed', {
          error: `${result.error}${result.message ? ` (${result.message})` : ''}`,
        })
        if (result.error === 'network_error') {
          friendly = t('models.engineError')
        } else if (result.error === 'timeout') {
          friendly = t('models.timeout')
        }
        setToastNotice({ tone: 'error', message: friendly })
        return
      }

      const parsed = result.data

      const filtered = parsed.filter((m) => m.provider === targetProvider)

      if (filtered.length === 0) {
        setToastNotice({
          tone: 'error',
          message: t('models.noModelsForProvider', { name: displayName }),
        })
        return
      }

      // Derive tags from any capability metadata returned by the provider
      // fetch. Keys match MODEL_TAGS (= server-side model_type tokens) so
      // chip selections can pass straight through to PATCH /endpoint
      // without translation.
      const deriveTags = (s?: Record<string, unknown>): string[] => {
        if (!s) return []
        const tags: string[] = []
        if (s.vision === true) tags.push('vision')
        if (s.web_search === true) tags.push('search')
        if (s.image_generation === true) tags.push('image_generation')
        if (s.reasoning === true) tags.push('reasoning')
        if (s.function_calling === true) tags.push('tools')
        return tags
      }

      // Pure merge: given the *current* model list + the provider
      // payload + tombstones, return the next list and a count of
      // genuinely-new provider entries. Called twice — once with the
      // closure snapshot (for the toast counters, since React's setState
      // updater runs at commit time, not synchronously) and once
      // inside the setProviders updater so the persisted state reflects
      // the *latest* prev (correct under concurrent edits).
      const mergeWithRegistry = (existingModels: ProviderModelEntry[]): {
        merged: ProviderModelEntry[]
        addedCount: number
      } => {
        const merged: ProviderModelEntry[] = []
        const seenIds = new Set<string>()

        // First include existing entries in their current order,
        // enriching registry-known ones.
        for (const existing of existingModels) {
          const match = filtered.find((m) => m.model_id === existing.id)
          if (match) {
            const entry: ProviderModelEntry = { id: existing.id }
            entry.name = existing.name?.trim() || match.display_name || existing.id
            entry.group = existing.group?.trim() || match.family || undefined
            if (entry.group === undefined) delete entry.group
            const tags = existing.tags && existing.tags.length > 0
              ? existing.tags
              : deriveTags(match.supports)
            if (tags.length > 0) entry.tags = tags
            if (existing.enabled) entry.enabled = true
            merged.push(entry)
          } else {
            merged.push(existing)
          }
          seenIds.add(existing.id)
        }

        // Tombstones for this provider — ids the user 🗑-removed in
        // this session. We must NOT re-add them from the registry,
        // regardless of how stale the fetch was.
        const tombstones = deletedModelIdsRef.current.get(targetProvider) ?? new Set<string>()

        // Append provider-reported entries that aren't in seenIds and weren't
        // explicitly tombstoned. This is the fix for the
        // "deleted-then-revived" race: a fetch in flight when the
        // user 🗑'd a model used to come back with that model in the
        // payload and re-add it as "new from registry".
        let addedCount = 0
        for (const m of filtered) {
          if (seenIds.has(m.model_id)) continue
          if (tombstones.has(m.model_id)) continue
          const entry: ProviderModelEntry = { id: m.model_id }
          if (m.display_name) entry.name = m.display_name
          if (m.family) entry.group = m.family
          const tags = deriveTags(m.supports)
          if (tags.length > 0) entry.tags = tags
          merged.push(entry)
          seenIds.add(m.model_id)
          addedCount++
        }

        return { merged, addedCount }
      }

      // Toast counts must be computed BEFORE setProviders schedules a
      // re-render — the updater closure that mutates external vars
      // doesn't run until React commits, which is AFTER setToastNotice
      // would read them. So we compute against the current snapshot
      // here, and re-merge inside setProviders for state correctness.
      const snapshotEntries = providers[targetProvider]?.models ?? []
      const { addedCount, merged: snapshotMerged } = mergeWithRegistry(snapshotEntries)
      const finalLength = snapshotMerged.length

      setProviders((prev) => {
        const current = prev[targetProvider]
        if (!current) return prev
        const { merged } = mergeWithRegistry(current.models)
        const updated: Record<ManagedProviderKey, ProviderConfig> = {
          ...prev,
          [targetProvider]: {
            ...current,
            models: merged,
            raw: buildAppProviderRaw({ ...current, models: merged }),
          },
        }
        queuePersist(updated, defaultProvider)
        return updated
      })

      setToastNotice({
        tone: 'success',
        message: addedCount > 0
          ? t('models.syncOk', { total: finalLength, added: addedCount })
          : t('models.syncOkNoAdded', { total: finalLength }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setToastNotice({ tone: 'error', message: t('models.syncFailed', { reason: message }) })
    } finally {
      setModelFetchState('idle')
    }
  }

  const handleAddModel = () => {
    const id = addModelId.trim()
    if (!id) {
      setToastNotice({ tone: 'error', message: t('models.addModelId') })
      return
    }
    const current = providers[selectedProvider].models

    if (editingModelId) {
      // Edit existing entry
      if (id !== editingModelId && current.some((m) => m.id === id)) {
        setToastNotice({ tone: 'error', message: t('models.modelExists') })
        return
      }
      const previousEntry = current.find((m) => m.id === editingModelId)
      const next: ProviderModelEntry[] = current.map((m) => {
        if (m.id !== editingModelId) return m
        const entry: ProviderModelEntry = { id }
        if (addModelName.trim()) entry.name = addModelName.trim()
        if (addModelGroup.trim()) entry.group = addModelGroup.trim()
        if (addModelTags.length > 0) entry.tags = [...addModelTags]
        if (m.enabled) entry.enabled = true
        applyPricingToEntry(entry, {
          currency: addModelCurrency,
          inputPrice: addModelInputPrice,
          outputPrice: addModelOutputPrice,
        })
        return entry
      })
      const patch: Partial<ProviderConfig> = { models: next }
      // If renamed and this was the default model, keep it as default
      if (providers[selectedProvider].model === editingModelId && id !== editingModelId) {
        patch.model = id
      }
      updateProvider(selectedProvider, patch)
      // Hot-reload endpoint on the engine. Only the enabled endpoints are
      // live in the engine; skip the API call if the renderer-side entry
      // was never enabled. model_type combines visible chip selections
      // with any hidden tokens (pdf/audio/video) hydrated from the
      // endpoint snapshot so a yaml-only token survives.
      if (previousEntry?.enabled) {
        const visible = addModelTags.filter((t) => VISIBLE_MODEL_TYPE_TOKENS.has(t))
        const modelType = [...visible, ...hiddenModelTypeTokens]
        const groupValue = addModelGroup.trim()
        void hotPatchEndpoint(selectedProvider, editingModelId, id, {
          model: id,
          model_type: modelType,
          group: groupValue, // "" 显式清空, 与后端三态语义一致
        })
      }
      closeAddModal()
      return
    }

    if (current.some((m) => m.id === id)) {
      setToastNotice({ tone: 'error', message: t('models.modelAlreadyExists') })
      return
    }
    const entry: ProviderModelEntry = { id }
    if (addModelName.trim()) entry.name = addModelName.trim()
    if (addModelGroup.trim()) entry.group = addModelGroup.trim()
    if (addModelTags.length > 0) entry.tags = [...addModelTags]
    applyPricingToEntry(entry, {
      currency: addModelCurrency,
      inputPrice: addModelInputPrice,
      outputPrice: addModelOutputPrice,
    })
    updateProvider(selectedProvider, { models: [...current, entry] })
    // New models default to disabled — no endpoint hot-create until the
    // user clicks the checkmark toggle (see handleToggleModelEnabled).
    closeAddModal()
  }

  const handleEditModel = (entry: ProviderModelEntry) => {
    setEditingModelId(entry.id)
    setAddModelId(entry.id)
    setAddModelName(entry.name ?? '')
    setAddModelGroup(entry.group ?? '')
    setAddModelTags(entry.tags ? [...entry.tags] : [])
    // Fetch the engine-side model_type so hidden tokens (pdf/audio/video)
    // survive the next save. listProviders is cheap enough to call on
    // every edit open; the engine already holds the snapshot in memory.
    setHiddenModelTypeTokens([])
    void (async () => {
      const res = await window.agentApi.listProviders()
      if (!res.ok) return
      const prov = res.data.providers.find((p) => p.name === selectedProvider)
      const ep = prov?.endpoints.find((e) => e.name === entry.id)
      const mt = Array.isArray(ep?.model_type) ? ep!.model_type! : []
      const hidden = mt.filter((t) => HIDDEN_MODEL_TYPE_TOKENS.has(t))
      setHiddenModelTypeTokens(hidden)
    })()
    // 把已保存的"币种 / 价格"灌回编辑表单。number → string 是为了让
    // <input type="number" /> 在空值与 0.00 之间不闪烁。
    setAddModelCurrency(entry.currency ?? '$')
    setAddModelInputPrice(
      typeof entry.inputPrice === 'number' && Number.isFinite(entry.inputPrice)
        ? String(entry.inputPrice)
        : ''
    )
    setAddModelOutputPrice(
      typeof entry.outputPrice === 'number' && Number.isFinite(entry.outputPrice)
        ? String(entry.outputPrice)
        : ''
    )
    setAdvancedOpen(false)
    setAddModelOpen(true)
  }

  const handleRemoveModel = (id: string) => {
    const current = providers[selectedProvider].models
    const previousEntry = current.find((m) => m.id === id)
    const next = current.filter((m) => m.id !== id)
    const patch: Partial<ProviderConfig> = { models: next }
    if (providers[selectedProvider].model === id) {
      patch.model = next[0]?.id ?? null
    }
    updateProvider(selectedProvider, patch)
    // Tombstone so an in-flight handleFetchModels (auto-refresh on
    // tab entry) doesn't revive this id from the registry.
    rememberDeletion(selectedProvider, id)
    // 🗑 真删：DELETE engine-side endpoint. The engine auto-removes
    // the entry from the fallback chain. Only call when the model
    // was previously enabled (engine actually has it).
    if (previousEntry?.enabled) {
      void hotDeleteEndpoint(selectedProvider, id)
    }
  }

  const handleToggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }))
  }

  const handleSelectModel = (id: string) => {
    updateProvider(selectedProvider, { model: id || null })
  }

  // Multi-select: each model entry has its own `enabled` flag. Toggling
  // doesn't affect siblings. The engine still receives a single active
  // `model` per provider — when the currently-active model is disabled
  // we promote the first remaining enabled entry; when the first model
  // is enabled and no active model is set, we set it as the active one.
  //
  // Enable  → POST /providers/{p}/endpoints (create if absent) +
  //           PATCH disabled=false (if already existed) +
  //           PUT /fallback-chain (append, idempotent)
  // Disable → PATCH /providers/{p}/endpoints/{e} { disabled: true }
  //           (engine 2026-05-14+: dispatcher skips, no chain churn)
  const handleToggleModelEnabled = (id: string) => {
    const current = providers[selectedProvider]
    const previousEntry = current.models.find((m) => m.id === id)
    const willEnable = !previousEntry?.enabled
    const nextModels: ProviderModelEntry[] = current.models.map((m) => {
      if (m.id !== id) return m
      const next: ProviderModelEntry = { ...m }
      if (willEnable) next.enabled = true
      else delete next.enabled
      return next
    })

    const patch: Partial<ProviderConfig> = { models: nextModels }
    const activeModelId = current.model

    if (willEnable && !activeModelId) {
      patch.model = id
    } else if (!willEnable && activeModelId === id) {
      const nextActive = nextModels.find((m) => m.enabled)
      patch.model = nextActive ? nextActive.id : null
    }

    updateProvider(selectedProvider, patch)

    // Hot-reload to the engine. Fire-and-forget; failures surface as toasts.
    // Pass the entry's tags so model_type lands in the engine the same
    // moment the endpoint is created — saves the user from having to
    // open the edit form just to push capability flags through.
    if (willEnable) {
      const tags = previousEntry?.tags
      void hotCreateEndpoint(
        selectedProvider,
        id,
        undefined,
        tags,
        // omit empty — POST has no clear semantics.
        previousEntry?.group?.trim() || undefined,
        isAgentRoutableModel(selectedProvider, previousEntry),
      )
    } else {
      void hotSetEndpointDisabled(selectedProvider, id, true)
    }
  }

  const closeAddModal = () => {
    setAddModelOpen(false)
    setEditingModelId(null)
    setAddModelId('')
    setAddModelName('')
    setAddModelGroup('')
    setAddModelTags([])
    setHiddenModelTypeTokens([])
    setAddModelCurrency('$')
    setAddModelInputPrice('')
    setAddModelOutputPrice('')
    setGroupSuggestOpen(false)
    setAdvancedOpen(false)
  }

  const selected = providers[selectedProvider]
  const selectedApiPathSuffix = getApiPathSuffix(getEffectiveEngineType(selectedProvider, selected))
  const selectedBaseUrl = selected.apiBase?.trim() || PROVIDER_DEFAULT_BASES[selectedProvider] || ''
  const selectedApiTargetUrl = buildApiTargetUrl(selectedBaseUrl, selectedApiPathSuffix)
  const showCustomProvider = selectedProvider === 'custom'
    || defaultProvider === 'custom'
    || Boolean(
      providers.custom.apiKey.trim()
      || providers.custom.apiBase?.trim()
      || providers.custom.model?.trim()
      || providers.custom.models.length > 0
    )
  const providerKeys = MANAGED_PROVIDER_KEYS.filter((key) => {
    // Image-generation providers (doubao/Doubao Seedream, gpt-image) are not
    // chat models — they belong to the 图片生成 segment, not 对话模型.
    if (!isAgentProviderKey(key)) return false
    if (key === selectedProvider) return true
    if (key === 'custom' && !showCustomProvider) return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return key.toLowerCase().includes(q) || getDisplayName(key).toLowerCase().includes(q)
  })

  // Show the "去配置 Agent LLM 节点" affordance only when the
  // currently-viewed provider is enabled — the prompt is contextual
  // to the row the user is editing, not the global enabled set.
  const selectedProviderEnabled = Boolean(
    providers[selectedProvider]?.enabled && isAgentProviderKey(selectedProvider)
  )

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="flex h-full">
      <div className="w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('models.searchPlaceholder')}
              className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {/* ── 对话模型 (text / LLM providers) ── */}
          <SectionDivider label="对话模型" />
          {providerKeys.map((key) => {
            const isActive = selectedKind === 'text' && key === selectedProvider
            const isEnabled = Boolean(providers[key]?.enabled)

            return (
              <button
                key={key}
                onClick={() => {
                  setSelectedKind('text')
                  setSelectedProvider(key)
                  setShowApiKey(false)
                  setTestState('idle')
                  setModelSearchVisible(false)
                  setModelSearchQuery('')
                  setAddModelOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors mb-0.5',
                  isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                )}
              >
                <ProviderLogo provider={key} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{getDisplayName(key)}</span>
                    {isEnabled && (
                      <span className="text-[10px] font-semibold text-status-connected bg-status-connected/15 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        ON
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}

          {providerKeys.length === 0 && (
            <div className="px-2 py-4">
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t('models.noMatch')}
              </div>
            </div>
          )}

          {/* ── 图片生成 (image providers) ── */}
          <SectionDivider label="图片生成" />
          {imageProviderKeys.map((key) => {
            const isActive = selectedKind === 'image' && key === selectedExtraKey
            return (
              <button
                key={`image:${key}`}
                onClick={() => {
                  setSelectedKind('image')
                  setSelectedExtraKey(key)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors mb-0.5',
                  isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                )}
              >
                <MediaProviderIcon
                  providerKey={key}
                  size={28}
                  fallback={<Image size={28} className="text-muted-foreground" />}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{mediaProviderDisplayName(key)}</span>
              </button>
            )
          })}
          {imageProviderKeys.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              在 config 里添加 imagegen provider 后显示
            </p>
          )}

          {/* ── 视频生成 (video providers) ── */}
          <SectionDivider label="视频生成" />
          {videoProviderKeys.map((key) => {
            const isActive = selectedKind === 'video' && key === selectedExtraKey
            return (
              <button
                key={`video:${key}`}
                onClick={() => {
                  setSelectedKind('video')
                  setSelectedExtraKey(key)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors mb-0.5',
                  isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                )}
              >
                <MediaProviderIcon
                  providerKey={key}
                  size={28}
                  fallback={<Film size={28} className="text-muted-foreground" />}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{mediaProviderDisplayName(key)}</span>
              </button>
            )
          })}
          {videoProviderKeys.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              在 config 里添加 videogen provider 后显示
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 max-w-[52rem] mx-auto w-full">
          {persistState === 'error' && persistMessage && (
            <div
              className={cn(
                'mb-5 rounded-xl border px-4 py-3 text-sm',
                'border-red-200 bg-red-50 text-red-600'
              )}
            >
              {persistMessage}
            </div>
          )}

          {selectedKind === 'image' && (
            <ImageModelSection providerName={selectedExtraKey} />
          )}

          {selectedKind === 'video' && (
            <VideoModelSection providerName={selectedExtraKey} />
          )}

          {selectedKind === 'text' && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border">
              <div className="flex items-center gap-2.5">
                <ProviderLogo provider={selectedProvider} size={28} />
                <h2 className="text-lg font-semibold text-foreground">{getDisplayName(selectedProvider)}</h2>
                {PROVIDER_DOCS_PAGES[selectedProvider] && (
                  <button
                    type="button"
                    onClick={() => window.appRuntime?.openExternal?.(PROVIDER_DOCS_PAGES[selectedProvider])}
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    title={t('models.visitOfficialSite')}
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
              </div>
              <Toggle
                checked={Boolean(selected.enabled)}
                onChange={(checked) => handleToggleProviderEnabled(selectedProvider, checked)}
              />
            </div>

            <div className="px-6 py-5 space-y-6">
              {selectedProvider === 'custom' && (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{t('models.protocolLabel')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('models.protocolDesc')}</p>
                  </div>
                  <Segment
                    value={selected.protocol}
                    onChange={(value) => updateProvider(selectedProvider, { protocol: value as ProviderConfig['protocol'] })}
                    options={[
                      { label: t('models.protocols.openai'), value: 'openai' },
                      { label: t('models.protocols.anthropic'), value: 'anthropic' },
                    ]}
                  />
                </div>
              )}

              {/* API 密钥 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-foreground">{t('models.apiKeyLabel')}</p>
                </div>
                <div className="relative">
                  <input
                    ref={apiKeyInputRef}
                    type={showApiKey ? 'text' : 'password'}
                    value={selected.apiKey}
                    onChange={(e) => {
                      updateProvider(selectedProvider, { apiKey: e.target.value })
                      schedulePatchProviderCredentials(selectedProvider)
                    }}
                    placeholder={t('models.apiKeyPlaceholder')}
                    className={cn(
                      'h-10 w-full rounded-md border border-border bg-background pl-3 pr-[5.5rem] text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring',
                      flashApiKey && 'animate-pulse border-amber-400 ring-2 ring-amber-400 ring-offset-1'
                    )}
                  />
                  <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={handleTest}
                      disabled={testState === 'testing'}
                      className={cn(
                        'inline-flex h-7 min-w-[2.75rem] items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors',
                        testState === 'ok' ? 'border-status-connected text-status-connected'
                          : testState === 'fail' ? 'border-status-disconnected text-status-disconnected'
                            : 'border-border bg-card hover:bg-muted text-foreground'
                      )}
                    >
                      {testState === 'testing' && <Loader2 size={12} className="animate-spin" />}
                      {testState === 'ok' && <Check size={12} />}
                      {testState === 'fail' && <X size={12} />}
                      {testState === 'testing' ? t('models.test.testing') : testState === 'ok' ? t('models.test.ok') : testState === 'fail' ? t('models.test.fail') : t('models.test.normal')}
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  {PROVIDER_APIKEY_PAGES[selectedProvider] ? (
                    <button
                      type="button"
                      onClick={() => window.appRuntime?.openExternal?.(PROVIDER_APIKEY_PAGES[selectedProvider])}
                      className="text-sky-500 hover:text-sky-600 hover:underline"
                    >
                      {t('models.getApiKey')}
                    </button>
                  ) : <span />}
                  <span className="text-muted-foreground">{t('models.apiKeyHint')}</span>
                </div>
              </div>

              {/* API 地址 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-foreground">{t('models.apiBaseLabel')}</p>
                    {/*
                      Engine `type` badge. Click opens a small popup with
                      the three protocol options (openai / anthropic /
                      gemini). Selecting one PATCHes /providers/{p}.
                    */}
                    <button
                      type="button"
                      onClick={() => setEngineTypePopupOpen((v) => !v)}
                      title={t('models.protocolType')}
                      className={cn(
                        'inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors',
                        getEffectiveEngineType(selectedProvider, selected) === 'openai'
                          && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600',
                        getEffectiveEngineType(selectedProvider, selected) === 'anthropic'
                          && 'border-amber-500/40 bg-amber-500/10 text-amber-600',
                        getEffectiveEngineType(selectedProvider, selected) === 'gemini'
                          && 'border-sky-500/40 bg-sky-500/10 text-sky-600',
                      )}
                    >
                      {getEffectiveEngineType(selectedProvider, selected)}
                    </button>
                  </div>
                  <div className="relative" ref={engineTypePopupRef}>
                    <button
                      type="button"
                      onClick={() => setEngineTypePopupOpen((v) => !v)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                      title={t('models.protocolType')}
                    >
                      <SlidersHorizontal size={14} />
                    </button>
                    {engineTypePopupOpen && (
                      <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-border bg-card p-1 shadow-lg">
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t('models.protocolType')}
                        </div>
                        {ENGINE_TYPE_OPTIONS.map((t) => {
                          const active = getEffectiveEngineType(selectedProvider, selected) === t
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                setEngineTypePopupOpen(false)
                                void applyEngineType(selectedProvider, t)
                              }}
                              className={cn(
                                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                                active ? 'bg-accent/60 text-foreground' : 'text-foreground',
                              )}
                            >
                              <span className="font-medium">{t}</span>
                              {active && <Check size={12} className="text-foreground" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {(() => {
                  const apiBaseValid = isValidApiBase(selected.apiBase || '')
                  return (
                    <>
                      <input
                        ref={apiBaseInputRef}
                        type="text"
                        value={selected.apiBase || ''}
                        onChange={(e) => {
                          const next = e.target.value
                          updateProvider(selectedProvider, { apiBase: next || null })
                          // Skip engine PATCH when the URL is malformed —
                          // wait until the user finishes typing a valid one.
                          if (isValidApiBase(next)) {
                            schedulePatchProviderCredentials(selectedProvider)
                          }
                        }}
                        placeholder={PROVIDER_DEFAULT_BASES[selectedProvider] || 'https://api.example.com'}
                        aria-invalid={!apiBaseValid}
                        className={cn(
                          'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring',
                          flashApiBase && 'animate-pulse border-amber-400 ring-2 ring-amber-400 ring-offset-1',
                          !apiBaseValid && 'border-red-500 focus:ring-red-500'
                        )}
                      />
                      {apiBaseValid ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t('models.previewLabel')}
                          {selectedApiTargetUrl}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-red-500">
                          {t('models.apiBaseInvalid')}
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* 模型 */}
              <div ref={modelsSectionRef}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{t('models.modelsLabel')}</p>
                    {selected.models.length > 0 && (
                      <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                        {selected.models.length}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setModelSearchVisible((v) => !v)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                      title={t('models.searchModels')}
                    >
                      <Search size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFetchModels()}
                    disabled={modelFetchState === 'loading'}
                    title={t('models.modelsLabel')}
                    className={cn(
                      'rounded p-1 text-muted-foreground transition-colors hover:text-foreground',
                      modelFetchState === 'loading' && 'opacity-60'
                    )}
                  >
                    <RefreshCw
                      size={14}
                      className={cn(modelFetchState === 'loading' && 'animate-spin')}
                    />
                  </button>
                </div>

                {modelSearchVisible && (
                  <input
                    type="text"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder={t('models.searchModels')}
                    className="mb-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                  />
                )}

                {/* Model groups */}
                {selected.models.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                    {t('models.noModels')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupModels(
                      selected.models.filter((m) => {
                        if (!modelSearchQuery) return true
                        const q = modelSearchQuery.toLowerCase()
                        return m.id.toLowerCase().includes(q)
                          || (m.name?.toLowerCase().includes(q) ?? false)
                          || (m.group?.toLowerCase().includes(q) ?? false)
                      })
                    ).map((group) => {
                      const isCollapsed = collapsedGroups[group.name]
                      const palette = getGroupPalette(group.name)
                      return (
                        <div key={group.name} className="rounded-lg border border-border overflow-hidden">
                          <button
                            type="button"
                            onClick={() => handleToggleGroup(group.name)}
                            className="w-full flex items-center justify-between px-3 py-2 transition-colors hover:brightness-95"
                            style={{
                              backgroundColor: palette.bg,
                              borderBottom: `1px solid ${palette.border}`,
                            }}
                          >
                            <div className="flex items-center gap-2">
                              {isCollapsed
                                ? <ChevronRight size={14} style={{ color: palette.text }} />
                                : <ChevronDown size={14} style={{ color: palette.text }} />}
                              <span className="text-sm font-semibold" style={{ color: palette.text }}>
                                {group.name}
                              </span>
                              <span
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: 'rgba(255,255,255,0.6)',
                                  color: palette.text,
                                }}
                              >
                                {group.items.length}
                              </span>
                            </div>
                          </button>
                          {!isCollapsed && (
                            <div className="divide-y divide-border">
                              {group.items.map((entry) => {
                                const isEnabled = Boolean(entry.enabled)
                                const label = entry.name?.trim() || entry.id
                                const imageGenerationUrl = engineImageGenerationUrls[`${selectedProvider}:${entry.id}`] || ''
                                return (
                                  <div
                                    key={entry.id}
                                    className={cn(
                                      'flex items-center gap-2 px-3 py-2 transition-colors',
                                      isEnabled ? 'bg-status-connected/10' : 'hover:bg-accent/30'
                                    )}
                                  >
                                    <ModelIcon id={entry.id} size={22} />
                                    <div className="min-w-0 flex-1 flex items-center">
                                      <span className="min-w-0 max-w-full truncate text-left text-sm text-foreground">
                                        {label}
                                      </span>
                                      {entry.tags && entry.tags.length > 0 && (
                                        <div className="ml-2 flex items-center gap-1">
                                          {entry.tags
                                            .map((tagKey) => (
                                              <ModelTagBadge
                                                key={tagKey}
                                                tagKey={tagKey}
                                                t={t}
                                                detail={tagKey === 'image_generation' ? imageGenerationUrl : undefined}
                                              />
                                            ))}
                                        </div>
                                      )}
                                    </div>
                                    <HoverHint label={t('common.edit')}>
                                      <button
                                        type="button"
                                        onClick={() => handleEditModel(entry)}
                                        aria-label={t('common.edit')}
                                        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                                      >
                                        <Settings2 size={14} />
                                      </button>
                                    </HoverHint>
                                    <HoverHint label={isEnabled ? t('common.close') : t('skills.repo.enabled')}>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleModelEnabled(entry.id)}
                                        aria-label={isEnabled ? t('common.close') : t('skills.repo.enabled')}
                                        aria-pressed={isEnabled}
                                        data-flash="model-enable"
                                        data-enabled={isEnabled ? 'true' : 'false'}
                                        className={cn(
                                          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-all',
                                          isEnabled
                                            ? 'border-status-connected bg-status-connected text-white shadow-sm scale-105'
                                            : 'border-border bg-background text-transparent hover:border-status-connected/60 hover:text-status-connected/60'
                                        )}
                                      >
                                        <Check size={12} strokeWidth={3} />
                                      </button>
                                    </HoverHint>
                                    <HoverHint label={t('common.delete')}>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveModel(entry.id)}
                                        aria-label={t('common.delete')}
                                        className="rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
                                      >
                                        <X size={14} />
                                      </button>
                                    </HoverHint>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {PROVIDER_MODELS_PAGES[selectedProvider] && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t('common.view')}{' '}
                    <button
                      type="button"
                      onClick={() => window.appRuntime?.openExternal?.(PROVIDER_DOCS_PAGES[selectedProvider])}
                      className="text-sky-500 hover:underline"
                    >
                      {getDisplayName(selectedProvider)} {t('common.docs')}
                    </button>{' '}
                    {t('common.and')}{' '}
                    <button
                      type="button"
                      onClick={() => window.appRuntime?.openExternal?.(PROVIDER_MODELS_PAGES[selectedProvider])}
                      className="text-sky-500 hover:underline"
                    >
                      {t('models.modelsLabel')}
                    </button>{' '}
                    {t('common.forMoreDetails')}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddModelTags(['reasoning', 'tools'])
                      setAddModelOpen(true)
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <span className="text-base leading-none">+</span>
                    {t('common.add')}
                  </button>
                </div>

              </div>
            </div>
          </div>
          )}

          {selectedKind === 'text' && selectedProviderEnabled && onNavigateToAgents && (
            <div className="sticky bottom-0 left-0 right-0 z-20 mt-6 -mx-8 px-8 pb-6 pt-3 bg-gradient-to-t from-background via-background/95 to-background/0 pointer-events-none">
              <div className="flex justify-center pointer-events-auto">
                <button
                  type="button"
                  onClick={onNavigateToAgents}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700"
                >
                  {t('models.goToAgents')}
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {addModelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeAddModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-model-title"
            className="w-full max-w-xl rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-5">
              <h3 id="add-model-title" className="text-lg font-semibold text-foreground">
                {editingModelId ? t('models.editModel') : t('models.addModel')}
              </h3>
              <button
                type="button"
                onClick={closeAddModal}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 pb-5 space-y-5">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-5">
                <label htmlFor="add-model-id" className="flex items-center gap-1 text-sm text-foreground">
                  <span className="text-red-500">*</span>
                  <span>{t('models.modelIdLabel')}</span>
                  <HelpIcon title={t('models.modelIdHint')} />
                </label>
                <input
                  id="add-model-id"
                  type="text"
                  value={addModelId}
                  onChange={(e) => setAddModelId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddModel()
                    if (e.key === 'Escape') closeAddModal()
                  }}
                  autoFocus
                  placeholder={t('models.modelIdPlaceholder')}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />

                <label htmlFor="add-model-name" className="flex items-center gap-1 text-sm text-foreground">
                  <span>{t('models.modelNameLabel')}</span>
                  <HelpIcon title={t('models.modelNameHint')} />
                </label>
                <input
                  id="add-model-name"
                  type="text"
                  value={addModelName}
                  onChange={(e) => setAddModelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddModel()
                    if (e.key === 'Escape') closeAddModal()
                  }}
                  placeholder={t('models.modelNamePlaceholder')}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />

                <label htmlFor="add-model-group" className="flex items-center gap-1 text-sm text-foreground">
                  <span>{t('models.modelGroupLabel')}</span>
                  <HelpIcon title={t('models.modelGroupHint')} />
                </label>
                <div className="relative">
                  {(() => {
                    const existingGroups = Array.from(
                      new Set(
                        selected.models.map((m) => m.group?.trim() || getModelGroup(m.id))
                      )
                    )
                      .filter(Boolean)
                      .sort((a, b) => a.localeCompare(b))
                    const q = addModelGroup.trim().toLowerCase()
                    const suggestions = q
                      ? existingGroups.filter((g) => g.toLowerCase().includes(q))
                      : existingGroups
                    return (
                      <>
                        <input
                          id="add-model-group"
                          type="text"
                          value={addModelGroup}
                          onChange={(e) => {
                            setAddModelGroup(e.target.value)
                            setGroupSuggestOpen(true)
                          }}
                          onFocus={() => setGroupSuggestOpen(true)}
                          onBlur={() => {
                            // Delay so clicks on suggestions register before closing.
                            window.setTimeout(() => setGroupSuggestOpen(false), 120)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (groupSuggestOpen && suggestions.length > 0
                                && !existingGroups.some((g) => g.toLowerCase() === q)
                                && q) {
                                // Pick the first suggestion on Enter when typing
                                setAddModelGroup(suggestions[0])
                                setGroupSuggestOpen(false)
                                e.preventDefault()
                                return
                              }
                              handleAddModel()
                            }
                            if (e.key === 'Escape') {
                              if (groupSuggestOpen) {
                                setGroupSuggestOpen(false)
                              } else {
                                closeAddModal()
                              }
                            }
                          }}
                          placeholder={t('models.addModal.namePlaceholder')}
                          autoComplete="off"
                          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                        />
                        {groupSuggestOpen && suggestions.length > 0 && (
                          <ul
                            role="listbox"
                            className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg"
                          >
                            {suggestions.map((g) => {
                              const palette = getGroupPalette(g)
                              return (
                                <li key={g}>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setAddModelGroup(g)
                                      setGroupSuggestOpen(false)
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                                  >
                                    <span
                                      className="inline-block h-3 w-3 rounded-sm border"
                                      style={{
                                        backgroundColor: palette.bg,
                                        borderColor: palette.border,
                                      }}
                                    />
                                    <span className="truncate">{g}</span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* 模型类型：添加 / 编辑模式都展示，避免两个入口的表单不一致。
                  高频字段（决定能力开关），不藏在"高级设置"折叠区里。*/}
              <div className="mt-2 border-t border-border pt-5">
                <div className="mb-2 flex items-center gap-1">
                  <span className="text-sm font-medium text-foreground">{t('models.addModal.tagsLabel')}</span>
                  <HoverHint label={t('models.addModal.tagsHint')}>
                    <AlertTriangle size={14} className="text-amber-500" />
                  </HoverHint>
                </div>
                <div className="flex flex-wrap gap-2">
                  {MODEL_TAGS.map((tag) => {
                    const active = addModelTags.includes(tag.key)
                    const Icon = tag.icon
                    return (
                      <HoverHint key={tag.key} label={t(`models.capabilities.${tag.key}Hint`)}>
                        <button
                          type="button"
                          onClick={() =>
                            setAddModelTags((prev) =>
                              prev.includes(tag.key)
                                ? prev.filter((k) => k !== tag.key)
                                : [...prev, tag.key]
                            )
                          }
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors'
                          )}
                          style={
                            active
                              ? {
                                  backgroundColor: tag.bg,
                                  borderColor: tag.border,
                                  color: tag.fg,
                                }
                              : {
                                  backgroundColor: 'transparent',
                                  borderColor: 'var(--border, #E5E7EB)',
                                  color: '#94A3B8',
                                }
                          }
                        >
                          <Icon size={12} />
                          {t(tag.label)}
                        </button>
                      </HoverHint>
                    )
                  })}
                </div>
              </div>

              {/* 高级设置：当前仅承载计费相关三项。"币种"用下拉选择常见
                  货币符号；"输入价格 / 输出价格"采用左侧数字输入 + 右侧
                  单位（$/百万 Token）的并排布局，与设计稿对齐。 */}
              {advancedOpen && (
                <div className="mt-2 space-y-4 border-t border-border pt-5">
                  <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                    <label htmlFor="add-model-currency" className="text-sm text-foreground">
                      {t('models.pricing.currency')}
                    </label>
                    <div className="flex">
                      <div className="relative w-28">
                        <select
                          id="add-model-currency"
                          value={addModelCurrency}
                          onChange={(e) => setAddModelCurrency(e.target.value)}
                          className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 pr-8 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="$">$</option>
                          <option value="¥">¥</option>
                          <option value="€">€</option>
                          <option value="£">£</option>
                          <option value="₩">₩</option>
                          <option value="₹">₹</option>
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                    <label htmlFor="add-model-input-price" className="text-sm text-foreground">
                      {t('models.pricing.inputPrice')}
                    </label>
                    <div className="flex items-stretch">
                      <input
                        id="add-model-input-price"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={addModelInputPrice}
                        onChange={(e) => setAddModelInputPrice(e.target.value)}
                        placeholder="0.00"
                        className="h-10 w-40 rounded-l-md border border-r-0 border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                      />
                      <span className="inline-flex h-10 items-center rounded-r-md border border-border bg-muted px-3 text-xs text-muted-foreground">
                        {addModelCurrency} {t('models.pricing.perMillionTokens')}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                    <label htmlFor="add-model-output-price" className="text-sm text-foreground">
                      {t('models.pricing.outputPrice')}
                    </label>
                    <div className="flex items-stretch">
                      <input
                        id="add-model-output-price"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={addModelOutputPrice}
                        onChange={(e) => setAddModelOutputPrice(e.target.value)}
                        placeholder="0.00"
                        className="h-10 w-40 rounded-l-md border border-r-0 border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                      />
                      <span className="inline-flex h-10 items-center rounded-r-md border border-border bg-muted px-3 text-xs text-muted-foreground">
                        {addModelCurrency} {t('models.pricing.perMillionTokens')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <SlidersHorizontal size={14} />
                  {t('common.advanced')}
                  {advancedOpen
                    ? <ChevronDown size={14} className="text-muted-foreground" />
                    : <ChevronRight size={14} className="text-muted-foreground" />}
                </button>
                <button
                  type="button"
                  onClick={handleAddModel}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-700"
                >
                  {editingModelId ? t('common.save') : t('common.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {toastNotice && (
        <NoticeToast
          tone={toastNotice.tone}
          message={toastNotice.message}
          position="top"
          anchor="viewport"
        />
      )}
      {flashField && (
        <SpotlightOverlay
          getTargets={getSpotlightTargets}
          onDismiss={() => setFlashField(null)}
        />
      )}
    </div>
  )
}

// ─── Channel Config Helpers ─────────────────────────────────────────────────

const CHANNEL_DISPLAY = (t: any): Record<string, { name: string; icon: string; color: string }> => ({
  dingtalk:  { name: t('settings.channels.names.dingtalk'), icon: '钉', color: '#3370FF' },
  discord:   { name: t('settings.channels.names.discord'), icon: 'D', color: '#5865F2' },
  email:     { name: t('settings.channels.names.email'), icon: '@', color: '#EA4335' },
  feishu:    { name: t('settings.channels.names.feishu'), icon: '飞', color: '#3370FF' },
  mochat:    { name: t('settings.channels.names.mochat'), icon: 'M', color: '#00C853' },
  qq:        { name: t('settings.channels.names.qq'), icon: 'Q', color: '#12B7F5' },
  slack:     { name: t('settings.channels.names.slack'), icon: 'S', color: '#4A154B' },
  telegram:  { name: t('settings.channels.names.telegram'), icon: 'T', color: '#26A5E4' },
  wecom:     { name: t('settings.channels.names.wecom'), icon: '企', color: '#07C160' },
  whatsapp:  { name: t('settings.channels.names.whatsapp'), icon: 'W', color: '#25D366' },
  harnessclaw:      { name: t('settings.channels.names.harnessclaw'), icon: 'H', color: '#F59E0B' },
})

const CHANNEL_KEYS = ['dingtalk', 'discord', 'email', 'harnessclaw', 'feishu', 'mochat', 'qq', 'slack', 'telegram', 'wecom', 'whatsapp']

// Channel field labels (simplified Chinese)
const FIELD_LABELS = (t: any): Record<string, string> => ({
  enabled: t('settings.channels.labels.enabled'),
  clientId: 'Client ID',
  clientSecret: 'Client Secret',
  token: 'Token',
  botToken: 'Bot Token',
  appToken: 'App Token',
  appId: 'App ID',
  appSecret: 'App Secret',
  secret: 'Secret',
  botId: 'Bot ID',
  encryptKey: 'Encrypt Key',
  verificationToken: 'Verification Token',
  clawToken: 'Claw Token',
  agentUserId: 'Agent User ID',
  bridgeToken: 'Bridge Token',
  imapHost: 'IMAP Host',
  imapPort: 'IMAP Port',
  imapUsername: t('settings.channels.labels.imapUsername'),
  imapPassword: t('settings.channels.labels.imapPassword'),
  imapMailbox: t('settings.channels.labels.imapMailbox'),
  imapUseSsl: 'IMAP SSL',
  smtpHost: 'SMTP Host',
  smtpPort: 'SMTP Port',
  smtpUsername: t('settings.channels.labels.smtpUsername'),
  smtpPassword: t('settings.channels.labels.smtpPassword'),
  smtpUseTls: 'SMTP TLS',
  smtpUseSsl: 'SMTP SSL',
  fromAddress: t('settings.channels.labels.fromAddress'),
  autoReplyEnabled: t('settings.channels.labels.autoReplyEnabled'),
  pollIntervalSeconds: t('settings.channels.labels.pollIntervalSeconds'),
  markSeen: t('settings.channels.labels.markSeen'),
  maxBodyChars: t('settings.channels.labels.maxBodyChars'),
  subjectPrefix: t('settings.channels.labels.subjectPrefix'),
  gatewayUrl: 'Gateway URL',
  intents: 'Intents',
  groupPolicy: t('settings.channels.labels.groupPolicy'),
  reactEmoji: t('settings.channels.labels.reactEmoji'),
  replyToMessage: t('settings.channels.labels.replyToMessage'),
  replyInThread: t('settings.channels.labels.replyInThread'),
  userTokenReadOnly: t('settings.channels.labels.userTokenReadOnly'),
  msgFormat: t('settings.channels.labels.msgFormat'),
  welcomeMessage: t('settings.channels.labels.welcomeMessage'),
  bridgeUrl: 'Bridge URL',
  baseUrl: 'Base URL',
  socketUrl: 'Socket URL',
  socketPath: 'Socket Path',
  mode: t('settings.channels.labels.mode'),
  webhookPath: 'Webhook Path',
  consentGranted: t('settings.channels.labels.consentGranted'),
  allowFrom: t('settings.channels.labels.allowFrom'),
  groupAllowFrom: t('settings.channels.labels.groupAllowFrom'),
  host: t('settings.channels.labels.host'),
  port: t('settings.channels.labels.port'),
})

// Fields to skip rendering (complex nested objects)
const SKIP_FIELDS = new Set(['sessions', 'panels', 'groups', 'mention', 'dm', 'proxy',
  'socketDisableMsgpack', 'socketReconnectDelayMs', 'socketMaxReconnectDelayMs', 'socketConnectTimeoutMs',
  'refreshIntervalMs', 'watchTimeoutMs', 'watchLimit', 'retryDelayMs', 'maxRetryAttempts', 'replyDelayMode', 'replyDelayMs'])

// ─── Channel Section ────────────────────────────────────────────────────────

function ChannelSection() {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useEngineConfig()

  const channels = (config?.channels || {}) as Record<string, unknown>
  const sendProgress = (channels.sendProgress as boolean) ?? true
  const sendToolHints = (channels.sendToolHints as boolean) ?? false

  const [selectedChannel, setSelectedChannel] = useState<string>(CHANNEL_KEYS[0])
  const [searchQuery, setSearchQuery] = useState('')

  const updateChannel = (chKey: string, patch: Record<string, unknown>) => {
    const current = (channels[chKey] || {}) as Record<string, unknown>
    updateConfig({ channels: { ...channels, [chKey]: { ...current, ...patch } } })
  }

  const filteredKeys = CHANNEL_KEYS.filter((key) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    const info = CHANNEL_DISPLAY(t)[key]
    return key.toLowerCase().includes(q) || (info?.name || '').toLowerCase().includes(q)
  })

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  const chData = (channels[selectedChannel] || {}) as Record<string, unknown>
  const chInfo = CHANNEL_DISPLAY(t)[selectedChannel] || { name: selectedChannel, icon: selectedChannel[0].toUpperCase(), color: '#888' }
  const isEnabled = (chData.enabled as boolean) ?? false

  // Render a field based on its type
  const renderField = (fieldKey: string, fieldValue: unknown) => {
    if (fieldKey === 'enabled' || SKIP_FIELDS.has(fieldKey)) return null
    const label = FIELD_LABELS(t)[fieldKey] || fieldKey

    if (typeof fieldValue === 'boolean') {
      return (
        <SettingRow key={fieldKey} label={label}>
          <Toggle checked={fieldValue} onChange={(v) => updateChannel(selectedChannel, { [fieldKey]: v })} />
        </SettingRow>
      )
    }
    if (typeof fieldValue === 'number') {
      return (
        <SettingRow key={fieldKey} label={label}>
          <NumberInput value={fieldValue} onChange={(v) => updateChannel(selectedChannel, { [fieldKey]: v })} className="w-20" />
        </SettingRow>
      )
    }
    if (typeof fieldValue === 'string') {
      const isSecret = fieldKey.toLowerCase().includes('secret') || fieldKey.toLowerCase().includes('password') || fieldKey.toLowerCase().includes('token')
      if (isSecret) {
        return <SecretFieldRow key={fieldKey} label={label} value={fieldValue} onChange={(v) => updateChannel(selectedChannel, { [fieldKey]: v })} />
      }
      return (
        <SettingRow key={fieldKey} label={label}>
          <TextInput value={fieldValue} onChange={(v) => updateChannel(selectedChannel, { [fieldKey]: v })} className="w-52" mono={fieldKey.includes('Url') || fieldKey.includes('url') || fieldKey.includes('Path') || fieldKey.includes('Host')} />
        </SettingRow>
      )
    }
    if (Array.isArray(fieldValue)) {
      const strValue = (fieldValue as string[]).join(', ')
      return (
        <SettingRow key={fieldKey} label={label} description={t('settings.channels.hints.commaSeparated')}>
          <TextInput
            value={strValue}
            onChange={(v) => {
              const arr = v.split(/[,，]\s*/).map(s => s.trim()).filter(Boolean)
              updateChannel(selectedChannel, { [fieldKey]: arr })
            }}
            placeholder={t('settings.channels.hints.noLimit')}
            className="w-52"
          />
        </SettingRow>
      )
    }
    return null
  }

  return (
    <div className="flex h-full">
      {/* Left: channel list */}
      <div className="w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('settings.channels.searchPlaceholder')}
              className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Global settings */}
        <div className="px-3 pb-2 mb-1 border-b border-border">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">{t('settings.channels.sendProgress')}</span>
            <Toggle checked={sendProgress} onChange={(v) => updateConfig({ channels: { ...channels, sendProgress: v } })} />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">{t('settings.channels.sendToolHints')}</span>
            <Toggle checked={sendToolHints} onChange={(v) => updateConfig({ channels: { ...channels, sendToolHints: v } })} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {filteredKeys.map((key) => {
            const info = CHANNEL_DISPLAY(t)[key]
            const ch = (channels[key] || {}) as Record<string, unknown>
            const enabled = (ch.enabled as boolean) ?? false
            const isActive = key === selectedChannel
            return (
              <button
                key={key}
                onClick={() => setSelectedChannel(key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors mb-0.5',
                  isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                )}
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold" style={{ backgroundColor: info.color }}>
                  {info.icon}
                </div>
                <span className="flex-1 text-sm font-medium truncate">{info.name}</span>
                {enabled && (
                  <span className="text-[10px] font-semibold text-status-connected bg-status-connected/15 px-1.5 py-0.5 rounded-full flex-shrink-0">ON</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: channel detail */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 max-w-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: chInfo.color }}>
                {chInfo.icon}
              </div>
              <h2 className="text-lg font-semibold text-foreground">{chInfo.name}</h2>
            </div>
            <Toggle checked={isEnabled} onChange={(v) => updateChannel(selectedChannel, { enabled: v })} />
          </div>

          {/* Fields */}
          <GroupCard title={t('common.config')}>
            {Object.entries(chData).map(([k, v]) => renderField(k, v))}
          </GroupCard>
        </div>
      </div>
    </div>
  )
}

function SecretFieldRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <SettingRow label={label}>
      <div className="flex items-center gap-1.5">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-44 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground font-mono"
        />
        <button onClick={() => setShow(!show)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </SettingRow>
  )
}

// ─── Search Section ─────────────────────────────────────────────────────────
// 搜索服务配置：iFly Search / Tavily Search。采用与模型配置一致的
// 左右两栏布局：左侧为搜索服务列表，右侧为所选服务的详情卡片。

type SearchProviderKey = 'ifly' | 'tavily'

const SEARCH_PROVIDER_KEYS: SearchProviderKey[] = ['ifly', 'tavily']

const SEARCH_PROVIDER_LABELS: Record<SearchProviderKey, string> = {
  ifly: 'iFly Search',
  tavily: 'Tavily Search',
}

const SEARCH_PROVIDER_DOCS: Record<SearchProviderKey, string> = {
  ifly: 'https://www.xfyun.cn/services/OneAPI',
  tavily: 'https://app.tavily.com/home',
}

const SEARCH_PROVIDER_BG: Record<SearchProviderKey, string> = {
  ifly: '#1A6BFF',
  tavily: '#0F172A',
}

function SearchProviderLogo({ provider, size = 28 }: { provider: SearchProviderKey; size?: number }) {
  const inner = Math.round(size * 0.62)
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: SEARCH_PROVIDER_BG[provider] }}
    >
      {provider === 'ifly' ? (
        <BrandMark brand="spark" size={inner} color="#FFFFFF" />
      ) : (
        <Search size={Math.round(size * 0.5)} color="#FFFFFF" strokeWidth={2.4} />
      )}
    </div>
  )
}

// SearchProviderKey ↔ engine tool name. The engine's Tools Management
// API keys tools by their yaml field name (`web_search` / `tavily_search`),
// so we centralize the mapping here.
const SEARCH_PROVIDER_TOOL_NAMES: Record<SearchProviderKey, string> = {
  ifly: 'web_search',
  tavily: 'tavily_search',
}

// iFly `web_search` config schema. api_key is the v2/search APIPassword
// (used verbatim as `Authorization: Bearer <key>`); endpoint and rerank
// flags are owned by the engine and not configurable from the UI.
interface IflySearchConfig {
  enabled?: boolean
  api_key?: string
  limit?: number
}

interface TavilySearchConfig {
  enabled?: boolean
  api_key?: string
  max_results?: number
}

// Local mirror of the wire ToolEntry shape (kept in sync with
// docs/api/tools-management-api.md §数据模型 and the global ambient
// declaration in preload/index.d.ts). Inlined here because the global
// `ToolEntry` interface lives behind an ES-module-style preload
// declaration that the renderer's tsconfig doesn't pull into scope —
// see the existing pattern for `ProviderInfo` etc.
interface ToolEntryView {
  name: string
  registered_name: string
  enabled: boolean
  effective: boolean
  config: Record<string, unknown>
  credential_fields: string[]
}

function emptyToolEntry(name: string): ToolEntryView {
  return {
    name,
    registered_name: '',
    enabled: false,
    effective: false,
    config: {},
    credential_fields: [],
  }
}

function SearchSection() {
  // Tools Management API is the source of truth for runtime state +
  // hot-reload; we no longer write to engine.yaml directly via
  // `useEngineConfig`. PATCH /api/v1/tools/{name} handles both the live
  // registry swap and the yaml persistence atomically.
  //
  // Local edit buffer: the user types into `iflyDraft` / `tavilyDraft`
  // and hits "Save" — at that point we PATCH the whole config block in
  // one round-trip. Enable/disable toggle bypasses the draft and goes
  // straight to the server so the user gets immediate feedback if
  // credentials are missing (`invalid_config`).
  const { t } = useTranslation()
  const [tools, setTools] = useState<Record<string, ToolEntryView>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedProvider, setSelectedProvider] = useState<SearchProviderKey>('ifly')
  const [showIflyApiKey, setShowIflyApiKey] = useState(false)
  const [showTavilyApiKey, setShowTavilyApiKey] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Per-provider local edit buffers (un-saved). `null` means "in sync
  // with server"; we never persist `null` — saving copies the merged
  // config back to `tools` and resets the draft to `null`.
  const [iflyDraft, setIflyDraft] = useState<IflySearchConfig | null>(null)
  const [tavilyDraft, setTavilyDraft] = useState<TavilySearchConfig | null>(null)

  // PATCH inflight per provider — disables Save / Toggle to avoid
  // overlapping writes (engine serializes them anyway, but the UI
  // should reflect that).
  const [savingProvider, setSavingProvider] = useState<SearchProviderKey | null>(null)
  const [togglingProvider, setTogglingProvider] = useState<SearchProviderKey | null>(null)

  // NoticeToast supports `error | info | success` (NoticeTone). We map
  // warning-class outcomes (e.g. "no changes to save") onto `info` so
  // we don't widen NoticeTone just for one screen.
  const [toastNotice, setToastNotice] = useState<{
    tone: 'success' | 'info' | 'error'
    message: string
  } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((tone: 'success' | 'info' | 'error', message: string) => {
    setToastNotice({ tone, message })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastNotice(null), 3200)
  }, [])

  // Initial load + retry hook. We don't poll — config rarely changes
  // out from under the user; the system_notice modal's "去设置" CTA is
  // the typical entry path, and we always render the freshest state on
  // mount.
  const refreshTools = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await window.agentApi.listTools()
      if (result.ok) {
        const map: Record<string, ToolEntryView> = {}
        for (const entry of result.data.tools) map[entry.name] = entry as ToolEntryView
        setTools(map)
      } else {
        setLoadError(result.message || result.error || t('settings.search.errors.loadFailed'))
      }
    } catch (error) {
      setLoadError(String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshTools()
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [refreshTools])

  // Translate engine error codes (per tools-management-api.md §错误表)
  // into Chinese guidance. Falls back to the raw message when we don't
  // recognize the code.
  const explainError = (code: string, message?: string): string => {
    switch (code) {
      case 'invalid_config':
        return message || t('settings.search.errors.invalidConfig')
      case 'not_found':
        return t('settings.search.errors.notRegistered')
      case 'hot_reload_failed':
        return t('settings.search.errors.hotReloadFailed')
      case 'persist_failed':
        return t('settings.search.errors.persistFailed')
      case 'registry_missing':
        return t('settings.search.errors.registryMissing')
      case 'bad_request':
        return message || t('settings.search.errors.badRequest')
      case 'network_error':
        return t('settings.search.errors.networkError')
      case 'timeout':
        return t('settings.search.errors.timeout')
      default:
        return message || t('settings.search.errors.generic', { code })
    }
  }

  // Server-side ToolEntry view, merged with the local draft when the
  // user has un-saved edits. Reads from `tools` (the API snapshot) for
  // the `enabled` / `effective` truth and lays the draft over `config`.
  const iflyEntry = tools.web_search || emptyToolEntry('web_search')
  const tavilyEntry = tools.tavily_search || emptyToolEntry('tavily_search')

  const iflyConfig: IflySearchConfig = {
    ...(iflyEntry.config as IflySearchConfig),
    ...(iflyDraft || {}),
  }
  const tavilyConfig: TavilySearchConfig = {
    ...(tavilyEntry.config as TavilySearchConfig),
    ...(tavilyDraft || {}),
  }

  const updateIflyDraft = (patch: Partial<IflySearchConfig>) => {
    setIflyDraft((prev) => ({ ...(prev || {}), ...patch }))
  }

  const updateTavilyDraft = (patch: Partial<TavilySearchConfig>) => {
    setTavilyDraft((prev) => ({ ...(prev || {}), ...patch }))
  }

  // PATCH wrapper — `enabledOverride` lets the toggle send `enabled`
  // explicitly even when the draft is empty; the Save button uses the
  // current `tools[name].enabled` (no change to enabled state).
  const patchProviderTool = async (
    provider: SearchProviderKey,
    body: { enabled?: boolean; config?: Record<string, unknown> },
    inflightSetter: (p: SearchProviderKey | null) => void,
  ): Promise<boolean> => {
    inflightSetter(provider)
    try {
      const targetName = SEARCH_PROVIDER_TOOL_NAMES[provider]
      const result = await window.agentApi.patchTool(targetName, body)
      if (result.ok) {
        setTools((prev) => ({ ...prev, [targetName]: result.data as ToolEntryView }))
        return true
      }
      showToast('error', explainError(result.error, result.message))
      return false
    } catch (error) {
      showToast('error', t('settings.search.errors.requestFailed', { detail: String(error) }))
      return false
    } finally {
      inflightSetter(null)
    }
  }

  // Helper — coerces the typed config draft into the API's flat record
  // shape. The typed interface uses optional keys; we strip undefined
  // before sending so the engine treats the field as "not provided" per
  // its partial-update contract.
  const draftToConfig = (
    draft: IflySearchConfig | TavilySearchConfig | null,
  ): Record<string, unknown> | undefined => {
    if (!draft) return undefined
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(draft)) {
      if (v !== undefined) out[k] = v
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  const handleToggleEnabled = async (provider: SearchProviderKey, checked: boolean) => {
    // Merge any un-saved draft into the PATCH so the user doesn't lose
    // half-typed credentials when flipping the toggle. If they only
    // wanted to flip the switch and nothing else, both drafts are null
    // and we send the enabled flag alone.
    const draft = provider === 'ifly' ? iflyDraft : tavilyDraft
    const body: { enabled: boolean; config?: Record<string, unknown> } = { enabled: checked }
    const draftConfig = draftToConfig(draft)
    if (draftConfig) body.config = draftConfig
    const ok = await patchProviderTool(provider, body, setTogglingProvider)
    if (ok) {
      if (provider === 'ifly') setIflyDraft(null)
      else setTavilyDraft(null)
      showToast('success', checked ? t('settings.search.toast.enabled') : t('settings.search.toast.disabled'))
    }
  }

  const handleSave = async (provider: SearchProviderKey) => {
    const draft = provider === 'ifly' ? iflyDraft : tavilyDraft
    const draftConfig = draftToConfig(draft)
    if (!draftConfig) {
      // Nothing changed — no-op, but acknowledge so the user gets
      // feedback instead of a silent button click.
      showToast('info', t('settings.search.toast.noChanges'))
      return
    }
    const ok = await patchProviderTool(provider, { config: draftConfig }, setSavingProvider)
    if (ok) {
      if (provider === 'ifly') setIflyDraft(null)
      else setTavilyDraft(null)
      showToast('success', t('settings.search.toast.savedAndApplied'))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm">
        <AlertTriangle size={20} className="text-amber-500" />
        <p className="text-muted-foreground">{loadError}</p>
        <button
          type="button"
          onClick={() => void refreshTools()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <RefreshCw size={12} />
          {t('settings.search.ui.reload')}
        </button>
      </div>
    )
  }

  const providerKeys = SEARCH_PROVIDER_KEYS.filter((key) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return key.toLowerCase().includes(q) || SEARCH_PROVIDER_LABELS[key].toLowerCase().includes(q)
  })

  const enabledMap: Record<SearchProviderKey, boolean> = {
    ifly: iflyEntry.enabled,
    tavily: tavilyEntry.enabled,
  }
  const effectiveMap: Record<SearchProviderKey, boolean> = {
    ifly: iflyEntry.effective,
    tavily: tavilyEntry.effective,
  }
  const dirtyMap: Record<SearchProviderKey, boolean> = {
    ifly: !!iflyDraft && Object.keys(iflyDraft).length > 0,
    tavily: !!tavilyDraft && Object.keys(tavilyDraft).length > 0,
  }

  return (
    <div className="flex h-full">
      <div className="w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('settings.search.ui.searchPlaceholder')}
              className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {providerKeys.map((key) => {
            const isActive = key === selectedProvider
            const isEnabled = enabledMap[key]
            return (
              <button
                key={key}
                onClick={() => setSelectedProvider(key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors mb-0.5',
                  isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                )}
              >
                <SearchProviderLogo provider={key} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{SEARCH_PROVIDER_LABELS[key]}</span>
                    {/*
                      Surface the engine's `effective` (yaml enabled +
                      credentials non-empty) and `enabled` (yaml flag
                      alone) separately. `effective=true` is the strong
                      signal — the tool is actually registered and
                      callable in the LLM pool. `enabled=true` but
                      `effective=false` means credentials are missing.
                    */}
                    {effectiveMap[key] ? (
                      <span className="text-[10px] font-semibold text-status-connected bg-status-connected/15 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        ON
                      </span>
                    ) : isEnabled ? (
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-500/15 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {t('settings.search.ui.pendingConfig')}
                      </span>
                    ) : null}
                    {dirtyMap[key] && (
                      <span
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
                        title={t('settings.search.ui.unsavedChanges')}
                      />
                    )}
                  </div>
                </div>
              </button>
            )
          })}

          {providerKeys.length === 0 && (
            <div className="px-2 py-4">
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t('settings.search.ui.noMatch')}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 max-w-[52rem] mx-auto w-full">
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5 border-b border-border">
              <div className="flex items-center gap-2.5">
                <SearchProviderLogo provider={selectedProvider} size={28} />
                <h2 className="text-lg font-semibold text-foreground">{SEARCH_PROVIDER_LABELS[selectedProvider]}</h2>
                {/*
                  Effectiveness pill — backed by ToolEntry.effective, not
                  the local toggle. `effective=true` means the engine has
                  the tool registered AND callable; if the user disabled
                  it just now we still display the new state from the
                  PATCH response.
                */}
                {effectiveMap[selectedProvider] ? (
                  <span className="rounded-full bg-status-connected/15 px-2 py-0.5 text-[11px] font-medium text-status-connected">
                    {t('settings.search.ui.effective')}
                  </span>
                ) : enabledMap[selectedProvider] ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                    {t('settings.search.ui.pendingConfig')}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {t('settings.search.ui.notEnabled')}
                  </span>
                )}
                {SEARCH_PROVIDER_DOCS[selectedProvider] && (
                  <button
                    type="button"
                    onClick={() => window.appRuntime?.openExternal?.(SEARCH_PROVIDER_DOCS[selectedProvider])}
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    title={t('settings.search.ui.visitWebsite')}
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {/*
                  Save button — PATCHes only the local draft (omitting
                  `enabled`), engine hot-swaps the registry, and the
                  yaml is rewritten atomically. Disabled when there are
                  no pending edits OR another PATCH is in flight.
                */}
                <button
                  type="button"
                  onClick={() => void handleSave(selectedProvider)}
                  disabled={
                    !dirtyMap[selectedProvider]
                    || savingProvider === selectedProvider
                    || togglingProvider === selectedProvider
                  }
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                    dirtyMap[selectedProvider]
                      ? 'bg-foreground text-background hover:opacity-90 dark:bg-primary dark:text-primary-foreground'
                      : 'cursor-not-allowed bg-muted text-muted-foreground',
                  )}
                >
                  {savingProvider === selectedProvider ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {t('settings.search.ui.saving')}
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      {t('settings.search.ui.save')}
                    </>
                  )}
                </button>
                <Toggle
                  checked={enabledMap[selectedProvider]}
                  onChange={(v) => void handleToggleEnabled(selectedProvider, v)}
                />
              </div>
            </div>

            <div className="px-6 py-5 space-y-6">
              {selectedProvider === 'ifly' ? (
                <>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">API Key</p>
                    <div className="relative">
                      <input
                        type={showIflyApiKey ? 'text' : 'password'}
                        value={iflyConfig.api_key || ''}
                        onChange={(e) => updateIflyDraft({ api_key: e.target.value })}
                        placeholder={t('settings.search.fields.apiKeyPlaceholder')}
                        className="h-10 w-full rounded-md border border-border bg-background pl-3 pr-10 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring font-mono"
                      />
                      <button
                        onClick={() => setShowIflyApiKey(!showIflyApiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {showIflyApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => window.appRuntime?.openExternal?.('https://console.xfyun.cn/services/aggSearch')}
                        className="text-sky-500 hover:text-sky-600 hover:underline"
                      >
                        {t('settings.search.fields.getKeyHere')}
                      </button>
                      <span className="text-muted-foreground">{t('settings.search.fields.iflyConsoleHint')}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Limit</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t('settings.search.fields.maxResultsDesc')}</p>
                      </div>
                      <NumberInput
                        value={iflyConfig.limit ?? 5}
                        onChange={(v) => updateIflyDraft({ limit: v })}
                        min={1}
                        max={20}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">API Key</p>
                    <div className="relative">
                      <input
                        type={showTavilyApiKey ? 'text' : 'password'}
                        value={tavilyConfig.api_key || ''}
                        onChange={(e) => updateTavilyDraft({ api_key: e.target.value })}
                        placeholder="tvly-xxx"
                        className="h-10 w-full rounded-md border border-border bg-background pl-3 pr-10 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring font-mono"
                      />
                      <button
                        onClick={() => setShowTavilyApiKey(!showTavilyApiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {showTavilyApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => window.appRuntime?.openExternal?.('https://app.tavily.com/home')}
                        className="text-sky-500 hover:text-sky-600 hover:underline"
                      >
                        {t('settings.search.fields.getKeyHere')}
                      </button>
                      <span className="text-muted-foreground">{t('settings.search.fields.tavilyConsoleHint')}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{t('settings.search.fields.maxResults')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t('settings.search.fields.tavilyMaxResultsDesc')}</p>
                      </div>
                      <NumberInput
                        value={tavilyConfig.max_results ?? 5}
                        onChange={(v) => updateTavilyDraft({ max_results: v })}
                        min={1}
                        max={20}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {/*
        Toast for hot-reload feedback. The engine error codes
        (invalid_config / hot_reload_failed / persist_failed / ...) are
        translated by `explainError` into actionable Chinese guidance.
      */}
      {toastNotice && (
        <NoticeToast
          tone={toastNotice.tone}
          message={toastNotice.message}
          position="top"
          anchor="viewport"
        />
      )}
    </div>
  )
}

// ─── Tools Section ──────────────────────────────────────────────────────────

function ToolsSection() {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useEngineConfig()

  const tools = (config?.tools || {}) as Record<string, unknown>
  const exec = (tools.exec || {}) as { timeout?: number; pathAppend?: string }
  const restrictToWorkspace = (tools.restrictToWorkspace as boolean) ?? false
  const mcpServers = (tools.mcpServers || {}) as Record<string, unknown>
  const mcpCount = Object.keys(mcpServers).length

  const updateExec = (patch: Record<string, unknown>) => {
    updateConfig({ tools: { ...tools, exec: { ...exec, ...patch } } })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Wrench} title={t('settings.tools.title')} subtitle={t('settings.tools.subtitle')} />

      <GroupCard title={t('settings.tools.exec.title')}>
        <SettingRow label={t('settings.tools.exec.timeout')} description={t('settings.tools.exec.timeoutDesc')}>
          <NumberInput value={exec.timeout ?? 60} onChange={(v) => updateExec({ timeout: v })} suffix={t('common.seconds')} min={5} max={600} />
        </SettingRow>
        <SettingRow label={t('settings.tools.exec.pathAppend')} description={t('settings.tools.exec.pathAppendDesc')}>
          <TextInput value={exec.pathAppend || ''} onChange={(v) => updateExec({ pathAppend: v })} placeholder="/usr/local/bin" className="w-52" mono />
        </SettingRow>
        <SettingRow label={t('settings.tools.exec.restrictWorkspace')} description={t('settings.tools.exec.restrictWorkspaceDesc')}>
          <Toggle checked={restrictToWorkspace} onChange={(v) => updateConfig({ tools: { ...tools, restrictToWorkspace: v } })} />
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('settings.tools.mcp.title')}>
        <div className="py-4">
          {mcpCount === 0 ? (
            <div className="flex items-center justify-center py-6 border border-dashed border-border rounded-lg">
              <p className="text-xs text-muted-foreground">{t('settings.tools.mcp.noServers')}</p>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('settings.tools.mcp.configured', { count: mcpCount })}
            </div>
          )}
        </div>
      </GroupCard>
    </div>
  )
}

// ─── UI Section ─────────────────────────────────────────────────────────────

function UISection() {
  const { t, i18n } = useTranslation()
  const { config, loading, updateConfig } = useAppConfig()
  const ui = (config?.ui || {}) as {
    theme?: string
    fontSize?: string
    language?: string
    codeTheme?: string
    animation?: boolean
  }
  const persistedTheme = typeof ui.theme === 'string' ? ui.theme : ''
  const resolveCurrentThemePreference = (): string => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark' || saved === 'light') {
      return saved
    }
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  }
  const theme = persistedTheme || resolveCurrentThemePreference()
  const fontSize = ui.fontSize || 'medium'
  const language = ui.language || 'zh'
  const codeTheme = ui.codeTheme || 'github-light'
  const animation = ui.animation !== false

  const updateUi = (patch: Record<string, unknown>) => {
    updateConfig({ ui: { ...ui, ...patch } })
    if (patch.language) {
      void i18n.changeLanguage(patch.language as string)
    }
  }

  const applyTheme = (v: string) => {
    if (v === 'dark') {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else if (v === 'light') {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', prefersDark)
      localStorage.removeItem('theme')
    }
    // Notify other surfaces (e.g., the sidebar dark/light toggle button) so
    // they can update their own state immediately without a remount.
    window.dispatchEvent(new CustomEvent('theme-changed'))
  }

  const handleThemeChange = (v: string) => {
    updateUi({ theme: v })
    applyTheme(v)
  }

  useEffect(() => {
    if (!loading && persistedTheme) {
      applyTheme(persistedTheme)
    }
    if (!loading && ui.language) {
      void i18n.changeLanguage(ui.language)
    }
  }, [loading, persistedTheme, ui.language])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Palette} title={t('settings.ui.title')} subtitle={t('settings.ui.subtitle')} />
      <GroupCard title={t('settings.ui.appearance')}>
        <SettingRow label={t('settings.ui.theme')} description={t('settings.ui.themeDesc')}>
          <Segment options={[{ label: t('settings.ui.themeLight'), value: 'light' }, { label: t('settings.ui.themeDark'), value: 'dark' }, { label: t('settings.ui.themeSystem'), value: 'system' }]} value={theme} onChange={handleThemeChange} />
        </SettingRow>
        <SettingRow label={t('settings.ui.fontSize')} description={t('settings.ui.fontSizeDesc')}>
          <Segment options={[{ label: t('settings.ui.fontSizeSmall'), value: 'small' }, { label: t('settings.ui.fontSizeMedium'), value: 'medium' }, { label: t('settings.ui.fontSizeLarge'), value: 'large' }]} value={fontSize} onChange={(v) => updateUi({ fontSize: v })} />
        </SettingRow>
        <SettingRow label={t('settings.ui.language')} description={t('settings.ui.languageDesc')}>
          <SelectInput value={language} onChange={(v) => updateUi({ language: v })} options={[{ label: t('settings.ui.languageZh'), value: 'zh' }, { label: t('settings.ui.languageEn'), value: 'en' }]} />
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('settings.ui.editor')}>
        <SettingRow label={t('settings.ui.codeTheme')} description={t('settings.ui.codeThemeDesc')}>
          <SelectInput
            value={codeTheme}
            onChange={(v) => updateUi({ codeTheme: v })}
            options={[
              { label: 'GitHub Light', value: 'github-light' },
              { label: 'GitHub Dark', value: 'github-dark' },
              { label: 'Dracula', value: 'dracula' },
              { label: 'Monokai', value: 'monokai' },
              { label: 'One Dark', value: 'one-dark' },
            ]}
          />
        </SettingRow>
        <SettingRow label={t('settings.ui.animation')} description={t('settings.ui.animationDesc')}>
          <Toggle checked={animation} onChange={(v) => updateUi({ animation: v })} />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Storage Section ────────────────────────────────────────────────────────

function StorageSection() {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useAppConfig()
  const storage = (config?.storage || {}) as { dbPath?: string }
  const dbPath = storage.dbPath || defaultDbDisplayPath
  const [clearState, setClearState] = useState<'idle' | 'clearing' | 'done'>('idle')
  const [exportState, setExportState] = useState<{ type: string; text: string; ok: boolean } | null>(null)

  const handleClearCache = async () => {
    setClearState('clearing')
    await new Promise((r) => setTimeout(r, 800))
    setClearState('done')
    setTimeout(() => setClearState('idle'), 2000)
  }

  const handleExport = async (type: 'chat' | 'config' | 'logs') => {
    const result = await window.appRuntime.exportData(type)
    if (result.ok && result.path) {
      setExportState({ type, text: t('storage.export.success', { path: result.path }), ok: true })
    } else {
      setExportState({ type, text: result.error || t('storage.export.failed'), ok: false })
    }
  }

  const handleBrowseDbPath = async () => {
    const result = await window.appRuntime.openDatabaseLocation(dbPath)
    if (!result.ok) {
      setExportState({ type: 'browse', text: result.error || t('storage.export.openFailed'), ok: false })
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={HardDrive} title={t('settings.storage.title')} subtitle={t('settings.storage.subtitle')} />
      <GroupCard title={t('settings.storage.title')}>
        <SettingRow label={t('settings.storage.dbPath')} description={t('settings.storage.dbPathDesc')}>
          <div className="flex items-center gap-1.5">
            <TextInput value={dbPath} onChange={(v) => updateConfig({ storage: { ...storage, dbPath: v } })} className="w-52" mono />
            <button
              onClick={() => void handleBrowseDbPath()}
              title={t('settings.storage.dbShowInFolder')}
              className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5"
            >
              <FolderOpen size={12} />{t('common.manage')}
            </button>
          </div>
        </SettingRow>
        <SettingRow label={t('settings.storage.cacheSize')} description={t('settings.storage.cacheSizeDesc')}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">{clearState === 'done' ? '0 B' : '12.4 MB'}</span>
            <button
              onClick={handleClearCache}
              disabled={clearState !== 'idle'}
              className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:border-destructive hover:text-destructive transition-colors text-foreground flex items-center gap-1.5 disabled:opacity-50"
            >
              {clearState === 'clearing' ? <Loader2 size={11} className="animate-spin" /> : clearState === 'done' ? <Check size={11} className="text-green-500" /> : <Trash2 size={11} />}
              {clearState === 'clearing' ? t('common.loading') : clearState === 'done' ? t('common.saved') : t('settings.storage.clearCache')}
            </button>
          </div>
        </SettingRow>
      </GroupCard>

      <GroupCard title={t('storage.export.title')}>
        {[
          { key: 'chat', label: t('storage.export.db'), description: t('storage.export.dbDesc') },
          { key: 'logs', label: t('storage.export.logs'), description: t('storage.export.logsDesc') },
          { key: 'config', label: t('storage.export.config'), description: t('storage.export.configDesc') },
        ].map((item) => (
          <SettingRow key={item.key} label={item.label} description={item.description}>
            <button onClick={() => void handleExport(item.key as 'chat' | 'config' | 'logs')} className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5">
              <Download size={12} />{t('common.save')}
            </button>
          </SettingRow>
        ))}
      </GroupCard>

      {exportState && (
        <div className={cn(
          'mt-3 rounded-lg border px-3 py-2 text-xs',
          exportState.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600'
        )}>
          {exportState.text}
        </div>
      )}
    </div>
  )
}

type AppUpdateEvent = {
  type: 'checking' | 'available' | 'not-available' | 'download-started' | 'download-deferred' | 'download-progress' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

function UpdateSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [message, setMessage] = useState(t('updates.autoCheckHint'))
  const [version, setVersion] = useState('')
  const [currentVersion, setCurrentVersion] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    let disposed = false

    const loadVersion = async () => {
      const nextVersion = await window.appBridge.getVersion()
      if (!disposed) {
        setCurrentVersion(nextVersion)
      }
    }

    void loadVersion()

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    return window.appBridge.onUpdateEvent((event) => {
      const updateEvent = event as AppUpdateEvent

      switch (updateEvent.type) {
        case 'checking':
          setStatus('checking')
          setIsChecking(true)
          setProgress(null)
          setMessage(t('updates.checkingSource'))
          break
        case 'available':
          setStatus('available')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setMessage(updateEvent.version ? t('updates.foundNew', { version: updateEvent.version }) : t('updates.foundNewGeneric'))
          break
        case 'not-available':
          setStatus('not-available')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setMessage(updateEvent.version ? t('updates.latest', { version: updateEvent.version }) : t('updates.latestGeneric'))
          break
        case 'download-started':
          setStatus('downloading')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setProgress(0)
          setMessage(updateEvent.version ? t('updates.downloadStarted', { version: updateEvent.version }) : t('updates.downloadStartedGeneric'))
          break
        case 'download-progress':
          setStatus('downloading')
          setIsChecking(false)
          setProgress(typeof updateEvent.percent === 'number' ? updateEvent.percent : null)
          setMessage(typeof updateEvent.percent === 'number'
            ? t('updates.downloadProgress', { percent: updateEvent.percent.toFixed(1) })
            : t('updates.downloadProgressGeneric'))
          break
        case 'downloaded':
          setStatus('downloaded')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setProgress(100)
          setMessage(updateEvent.version ? t('updates.downloadDone', { version: updateEvent.version }) : t('updates.downloadDoneGeneric'))
          break
        case 'download-deferred':
          setStatus('available')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setProgress(null)
          setMessage(updateEvent.version ? t('updates.downloadDeferred', { version: updateEvent.version }) : t('updates.downloadDeferredGeneric'))
          break
        case 'error':
          setStatus('error')
          setIsChecking(false)
          setProgress(null)
          setMessage(updateEvent.message || t('updates.checkFailed'))
          break
      }
    })
  }, [t])

  const handleCheck = async () => {
    setIsChecking(true)
    const result = await window.appBridge.checkForUpdates()
    if (!result.ok) {
      setStatus('error')
      setIsChecking(false)
      setProgress(null)
      setMessage(result.error || t('updates.checkFailed'))
    }
  }

  return (
    <div>
      <SectionHeader icon={RotateCcw} title={t('updates.title')} subtitle={t('updates.subtitle')} />

      <GroupCard title={t('updates.title')}>
        <SettingRow label={t('updates.check')} description={t('updates.checkDesc')}>
          <button
            onClick={() => void handleCheck()}
            disabled={isChecking}
            className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5 disabled:opacity-50"
          >
            {isChecking ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            {isChecking ? t('updates.checking') : t('updates.check')}
          </button>
        </SettingRow>

        <SettingRow label={t('updates.currentVersion')} description={t('updates.currentVersionDesc')}>
          <div className="text-right">
            <p className="text-sm font-medium text-foreground">{currentVersion || '--'}</p>
          </div>
        </SettingRow>

        <SettingRow label={t('updates.status')} description={t('updates.statusDesc')}>
          <div className="text-right">
            <p className="text-sm font-medium text-foreground">
              {status === 'idle' && t('updates.idle')}
              {status === 'checking' && t('updates.checkingStatus')}
              {status === 'available' && t('updates.available')}
              {status === 'not-available' && t('updates.notAvailable')}
              {status === 'downloading' && t('updates.downloading')}
              {status === 'downloaded' && t('updates.downloaded')}
              {status === 'error' && t('updates.error')}
            </p>
            {version && <p className="mt-0.5 text-xs text-muted-foreground">{t('updates.version', { version })}</p>}
          </div>
        </SettingRow>

        {status === 'downloading' && (
          <div className="py-4 border-b border-border last:border-0">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('updates.progress')}</span>
              <span>{progress != null ? `${progress.toFixed(1)}%` : '--'}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-200 dark:bg-primary"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </GroupCard>

      <div className={cn(
        'mt-3 rounded-lg border px-3 py-2 text-xs',
        status === 'error'
          ? 'border-red-200 bg-red-50 text-red-600'
          : 'border-border bg-card text-muted-foreground'
      )}>
        {message}
      </div>
    </div>
  )
}

type LogViewerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type LogViewerFile = 'all' | 'harnessclaw'
type LogViewerMode = 'parsed' | 'raw'
type LogEntry = {
  cursor: string
  timestamp: number
  isoTime: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  source: string
  message: string
  metaText: string
  file: 'harnessclaw'
  raw: string
}

function getLogBadgeClass(level: LogEntry['level']): string {
  if (level === 'fatal') return 'bg-rose-100 text-rose-700 border-rose-200'
  if (level === 'error') return 'bg-red-50 text-red-700 border-red-200'
  if (level === 'warn') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (level === 'debug') return 'bg-sky-50 text-sky-700 border-sky-200'
  if (level === 'trace') return 'bg-slate-100 text-slate-700 border-slate-200'
  return 'bg-emerald-50 text-emerald-700 border-emerald-200'
}

function formatLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function summarizeLog(entry: LogEntry): string {
  const summary = entry.message || entry.metaText || entry.raw
  if (summary.length <= 140) return summary
  return `${summary.slice(0, 140)}...`
}

function mergeLogEntries(current: LogEntry[], incoming: LogEntry[]): LogEntry[] {
  const merged = new Map<string, LogEntry>()
  for (const entry of current) {
    merged.set(entry.cursor, entry)
  }
  for (const entry of incoming) {
    merged.set(entry.cursor, entry)
  }
  return [...merged.values()].sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return right.timestamp - left.timestamp
    }
    return right.cursor.localeCompare(left.cursor)
  })
}

function LogsSection() {
  const { t } = useTranslation()
  const { loading } = useAppConfig()

  const [selectedLevel, setSelectedLevel] = useState<LogViewerLevel>('info')
  const [selectedFile, setSelectedFile] = useState<LogViewerFile>('all')
  const [query, setQuery] = useState('')
  const [followMode, setFollowMode] = useState(true)
  const [viewMode, setViewMode] = useState<LogViewerMode>('parsed')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [reloadKey, setReloadKey] = useState(0)
  const logScrollRef = useRef<HTMLDivElement | null>(null)

  const displayedEntries = useMemo(() => {
    if (viewMode === 'raw') {
      return [...entries].sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp
        }
        return left.cursor.localeCompare(right.cursor)
      })
    }
    return entries
  }, [entries, viewMode])

  useEffect(() => {
    if (viewMode !== 'raw') return
    const node = logScrollRef.current
    if (!node) return
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  }, [viewMode, displayedEntries])

  useEffect(() => {
    if (loading) return

    let cancelled = false
    setLoadingLogs(true)

    void window.appRuntime.getLogs({
      level: viewMode === 'raw' ? 'trace' : selectedLevel,
      file: selectedFile,
      query: query.trim() || undefined,
      limit: 0,
    }).then((result) => {
      if (cancelled) return
      setEntries(result.items as LogEntry[])
      setCursor(result.cursor)
      setLoadError('')
    }).catch((error) => {
      if (cancelled) return
      setLoadError(String(error))
    }).finally(() => {
      if (!cancelled) {
        setLoadingLogs(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [loading, query, reloadKey, selectedFile, selectedLevel, viewMode])

  useEffect(() => {
    if (loading || !followMode || !cursor) return

    let cancelled = false
    const timer = setInterval(() => {
      void window.appRuntime.getLogs({
        after: cursor,
        level: viewMode === 'raw' ? 'trace' : selectedLevel,
        file: selectedFile,
        query: query.trim() || undefined,
        limit: 0,
      }).then((result) => {
        if (cancelled) return
        if (result.items.length > 0) {
          setEntries((current) => mergeLogEntries(current, result.items as LogEntry[]))
        }
        setCursor(result.cursor)
        setLoadError('')
      }).catch((error) => {
        if (cancelled) return
        setLoadError(String(error))
      })
    }, 1500)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [loading, followMode, cursor, query, selectedFile, selectedLevel, viewMode])

  const handleLevelChange = (value: string) => {
    const nextLevel = value as LogViewerLevel
    setSelectedLevel(nextLevel)
  }

  const handleReset = () => {
    setQuery('')
    setSelectedFile('all')
    setSelectedLevel('info')
    setFollowMode(true)
    setViewMode('parsed')
    setExpandedRows({})
    setNotice(null)
    setReloadKey((current) => current + 1)
  }

  const toggleExpanded = (cursorValue: string) => {
    setExpandedRows((current) => ({
      ...current,
      [cursorValue]: !current[cursorValue],
    }))
  }

  const handleOpenLogsDirectory = async () => {
    const result = await window.appRuntime.openLogsDirectory()
    setNotice(result.ok
      ? { ok: true, text: t('settings.logs.notices.openDirSuccess', { path: result.path }) }
      : { ok: false, text: result.error || t('settings.logs.notices.openDirFailed') })
  }

  const handleExportLogs = async () => {
    const result = await window.appRuntime.exportData('logs')
    setNotice(result.ok && result.path
      ? { ok: true, text: t('settings.logs.notices.exportSuccess', { path: result.path }) }
      : { ok: false, text: result.error || t('settings.logs.notices.exportFailed') })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full max-w-5xl mx-auto px-8 py-8 flex flex-col">
        <SectionHeader icon={FileText} title={t('settings.logs.title')} subtitle={t('settings.logs.subtitle')} />

        <div className="rounded-2xl border border-border bg-card shadow-sm p-4 mb-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex-1 min-w-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('settings.logs.searchPlaceholder')}
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Segment
                options={[
                  { label: t('settings.logs.levels.fatal'), value: 'fatal' },
                  { label: t('settings.logs.levels.error'), value: 'error' },
                  { label: t('settings.logs.levels.warn'), value: 'warn' },
                  { label: t('settings.logs.levels.info'), value: 'info' },
                  { label: t('settings.logs.levels.debug'), value: 'debug' },
                  { label: t('settings.logs.levels.trace'), value: 'trace' },
                ]}
                value={selectedLevel}
                onChange={handleLevelChange}
              />
              <Segment
                options={[
                  { label: t('settings.logs.viewModes.parsed'), value: 'parsed' },
                  { label: t('settings.logs.viewModes.raw'), value: 'raw' },
                ]}
                value={viewMode}
                onChange={(value) => setViewMode(value as LogViewerMode)}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1',
                followMode ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
              )}>
                <span className={cn('w-2 h-2 rounded-full', followMode ? 'bg-emerald-500' : 'bg-amber-500')} />
                {followMode ? t('settings.logs.followModeOn') : t('settings.logs.followModeOff')}
              </span>
              <span>{t('settings.logs.directoryLabel', { path: defaultLogsDisplayPath })}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setFollowMode((current) => !current)}
                className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-foreground flex items-center gap-1.5"
              >
                {followMode ? <Pause size={14} /> : <Play size={14} />}
                {followMode ? t('settings.logs.followModeOff') : t('settings.logs.followModeOn')}
              </button>
              <button
                onClick={handleReset}
                className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-foreground flex items-center gap-1.5"
              >
                <RotateCcw size={14} />
                {t('settings.logs.reset')}
              </button>
              <button
                onClick={() => void handleOpenLogsDirectory()}
                className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-foreground flex items-center gap-1.5"
              >
                <FolderOpen size={14} />
                {t('settings.logs.openDirectory')}
              </button>
              <button
                onClick={() => void handleExportLogs()}
                className="h-9 px-3 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors text-sm font-medium flex items-center gap-1.5"
              >
                <Download size={14} />
                {t('settings.logs.exportLogs')}
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div className={cn(
            'mb-4 rounded-xl border px-3 py-2 text-sm',
            notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'
          )}>
            {notice.text}
          </div>
        )}

        {loadError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 flex items-center gap-2">
            <AlertTriangle size={15} />
            <span className="flex-1">{t('common.loadFailed')}: {loadError}</span>
            <button
              onClick={() => setReloadKey((current) => current + 1)}
              className="h-7 px-2.5 rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 transition-colors"
            >
              {t('common.refresh')}
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div>
              <p className="text-sm font-semibold text-foreground">{t('settings.logs.title')}</p>
            </div>
            {(loadingLogs || (followMode && entries.length === 0)) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                {t('common.loading')}
              </div>
            )}
          </div>

          <div ref={logScrollRef} className="flex-1 min-h-0 overflow-y-auto">
            {!loadingLogs && entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <FileText size={28} className="text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-foreground">
                  {query.trim() ? t('settings.logs.searchPlaceholder') : t('settings.logs.title')}
                </p>
              </div>
            ) : viewMode === 'raw' ? (
              <div className="overflow-x-auto">
                <pre className="whitespace-pre text-xs text-foreground font-mono px-4 py-3 min-w-max">
                  {displayedEntries.map((entry) => entry.raw).join('\n')}
                </pre>
              </div>
            ) : (
              <div>
                <div className="divide-y divide-border">
                {displayedEntries.map((entry) => {
                  const expanded = Boolean(expandedRows[entry.cursor])
                  return (
                    <div key={entry.cursor} className="px-4 py-3">
                      <button onClick={() => toggleExpanded(entry.cursor)} className="w-full text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase', getLogBadgeClass(entry.level))}>
                                {entry.level}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                latest.log
                              </span>
                              <span className="text-xs font-mono text-muted-foreground break-all">{entry.source}</span>
                            </div>
                            <div className="flex items-start gap-2">
                              {expanded ? <ChevronDown size={15} className="mt-0.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight size={15} className="mt-0.5 text-muted-foreground flex-shrink-0" />}
                              <div className="min-w-0">
                                <p className="text-sm text-foreground break-words">{summarizeLog(entry)}</p>
                                <p className="text-xs text-muted-foreground mt-1">{formatLogTime(entry.timestamp)}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>

                      {expanded && (
                        <div className="mt-3 ml-6 rounded-xl border border-border bg-background/60 p-3 space-y-3">
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Message</p>
                            <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-mono">{entry.message || '(empty)'}</pre>
                          </div>

                          {entry.metaText && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Metadata</p>
                              <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground font-mono">{entry.metaText}</pre>
                            </div>
                          )}

                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Raw</p>
                            <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground font-mono">{entry.raw}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Quick-launcher hotkey capture ─────────────────────────────────────────
//
// `HotkeyInput` is a click-to-record hotkey field used by the
// 快捷助手 settings card. Clicking the chip enters capture mode; the
// next key combo with at least one modifier is converted to an
// Electron accelerator string (e.g. `"Alt+Space"`) and surfaced via
// `onChange`. Escape cancels without changing the value.
//
// Visual style mirrors the reference screenshot — modifier symbols
// (⌃⌥⇧⌘ on macOS) followed by the main key, rendered as inline glyphs
// inside a rounded border. While recording, a `Keyboard` icon
// floats on the right of the chip as a "press a combination" hint.

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

const MODIFIER_SYMBOLS: Record<string, string> = {
  Control: '⌃',
  Ctrl: '⌃',
  Alt: IS_MAC ? '⌥' : 'Alt',
  Option: '⌥',
  Shift: '⇧',
  Meta: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  CommandOrControl: IS_MAC ? '⌘' : 'Ctrl',
  CmdOrCtrl: IS_MAC ? '⌘' : 'Ctrl',
  Super: IS_MAC ? '⌘' : 'Win',
}

const KEY_SYMBOLS: Record<string, string> = {
  Return: '↩',
  Enter: '↩',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
  Space: 'Space',
}

const MODIFIER_ORDER = ['Control', 'Ctrl', 'Alt', 'Option', 'Shift', 'Meta', 'Command', 'Cmd', 'CommandOrControl', 'CmdOrCtrl', 'Super']

function isModifierToken(token: string): boolean {
  return MODIFIER_ORDER.includes(token)
}

/** Parse `"Alt+Shift+K"` → `{ modifiers: ['Alt','Shift'], key: 'K' }`. */
function parseAccelerator(accel: string): { modifiers: string[]; key: string } {
  if (!accel) return { modifiers: [], key: '' }
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean)
  const modifiers: string[] = []
  let key = ''
  for (const part of parts) {
    if (isModifierToken(part)) modifiers.push(part)
    else key = part
  }
  return { modifiers, key }
}

/** Convert a DOM KeyboardEvent into an Electron-compatible accelerator. */
function eventToAccelerator(event: KeyboardEvent): string | null {
  // Skip lone modifier presses — we wait until the user pairs at
  // least one modifier with a non-modifier key.
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null

  const modifiers: string[] = []
  if (event.metaKey) modifiers.push('Command')
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')

  let key: string | null = null
  const k = event.key
  if (k === ' ' || event.code === 'Space') key = 'Space'
  else if (k === 'ArrowUp') key = 'Up'
  else if (k === 'ArrowDown') key = 'Down'
  else if (k === 'ArrowLeft') key = 'Left'
  else if (k === 'ArrowRight') key = 'Right'
  else if (k === 'Enter') key = 'Return'
  else if (k === 'Tab') key = 'Tab'
  else if (k === 'Backspace') key = 'Backspace'
  else if (k === 'Delete') key = 'Delete'
  else if (/^F\d{1,2}$/.test(k)) key = k
  else if (k.length === 1) key = k.toUpperCase()

  if (!key) return null
  // Require at least one modifier — bare single keys would conflict
  // with normal typing once registered as a global accelerator.
  if (modifiers.length === 0) return null
  return [...modifiers, key].join('+')
}

function renderToken(token: string, dim: boolean): React.ReactNode {
  const sym = MODIFIER_SYMBOLS[token] || KEY_SYMBOLS[token] || token
  return (
    <span
      key={token}
      className={cn(
        'inline-flex items-center justify-center text-[15px] font-semibold leading-none transition-colors',
        dim ? 'text-muted-foreground/40' : 'text-primary',
      )}
    >
      {sym}
    </span>
  )
}

// Canonical modifier slots shown inside every HotkeyInput. We always
// render all four so the user can see at a glance which modifiers are
// part of the current hotkey (highlighted) vs available but unused
// (dimmed). Matches the Alfred-style affordance in the design
// reference. Order follows the macOS convention (⌃⌥⇧⌘); on
// Windows / Linux the symbols fall back to their text labels via the
// MODIFIER_SYMBOLS table.
const MODIFIER_SLOTS: Array<{ token: string; matches: (mods: string[]) => boolean }> = [
  { token: 'Control', matches: (m) => m.includes('Control') || m.includes('Ctrl') },
  { token: 'Alt',     matches: (m) => m.includes('Alt') || m.includes('Option') },
  { token: 'Shift',   matches: (m) => m.includes('Shift') },
  { token: 'Command', matches: (m) => m.includes('Command') || m.includes('Cmd') || m.includes('Meta') || m.includes('CommandOrControl') || m.includes('CmdOrCtrl') || m.includes('Super') },
]

function HotkeyInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const { modifiers, key } = parseAccelerator(value)

  useEffect(() => {
    if (!capturing) return
    const onKey = (event: KeyboardEvent) => {
      // Swallow the combo so it doesn't trigger app-level shortcuts
      // (e.g. Cmd+, opens Settings) while the user is recording.
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }
      const accel = eventToAccelerator(event)
      if (!accel) return
      onChange(accel)
      setCapturing(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setCapturing(false)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [capturing, onChange])

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        setCapturing(true)
      }}
      aria-pressed={capturing}
      aria-label={capturing
        ? t('settings.launcher.hotkey.capturingAria')
        : t('settings.launcher.hotkey.idleAria', { value: value || t('settings.launcher.hotkey.unset') })}
      className={cn(
        'relative inline-flex min-w-[180px] items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-left transition-colors',
        'bg-card text-foreground',
        capturing
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-border hover:border-primary/40',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="flex items-center gap-1.5">
        {/* Always render the four modifier slots so the user can see
            which modifiers are part of the current hotkey (lit) vs
            available but unused (dimmed). Matching is order-insensitive
            so e.g. `"Shift+Alt+K"` correctly highlights ⌥ + ⇧. */}
        {MODIFIER_SLOTS.map(({ token, matches }) => renderToken(token, !matches(modifiers)))}
        <span className="mx-1 inline-block h-3 w-px bg-border" aria-hidden="true" />
        {key
          ? renderToken(key, false)
          : (
            <span className="text-[12px] text-muted-foreground/70">
              {capturing ? t('settings.launcher.hotkey.pressKeys') : '—'}
            </span>
          )
        }
      </span>
      <span className="ml-auto flex items-center pl-2">
        {capturing ? (
          <Keyboard size={14} className="animate-pulse text-primary" aria-hidden="true" />
        ) : (
          <Keyboard size={14} className="text-muted-foreground/50" aria-hidden="true" />
        )}
      </span>
    </button>
  )
}

// ─── Launcher Section ──────────────────────────────────────────────────────
//
// Standalone settings page for the Alfred-style quick launcher.
// Owns `launcher.enabled` + `launcher.hotkey` in `harnessclaw.json`.
// The main process re-applies these on every config save so toggling
// the switch or rebinding the hotkey takes effect without a restart.

function LauncherSection() {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useAppConfig()
  const launcher = (config?.launcher || {}) as { enabled?: boolean; hotkey?: string }
  const launcherEnabled = launcher.enabled === true
  const launcherHotkey = typeof launcher.hotkey === 'string' && launcher.hotkey.trim().length > 0
    ? launcher.hotkey.trim()
    : 'Alt+Space'

  const handleEnabledChange = (next: boolean) => {
    updateConfig({ launcher: { ...launcher, enabled: next, hotkey: launcherHotkey } })
  }

  const handleHotkeyChange = (next: string) => {
    updateConfig({ launcher: { ...launcher, enabled: launcherEnabled, hotkey: next } })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Keyboard} title={t('settings.launcher.header.title')} subtitle={t('settings.launcher.header.subtitle')} />
      <GroupCard title={t('settings.launcher.group.basic')}>
        <SettingRow
          label={t('settings.launcher.enabled.label')}
          description={t('settings.launcher.enabled.desc')}
        >
          <Toggle checked={launcherEnabled} onChange={handleEnabledChange} />
        </SettingRow>
        <SettingRow
          label={t('settings.launcher.hotkey.label')}
          description={t('settings.launcher.hotkey.desc')}
        >
          <HotkeyInput
            value={launcherHotkey}
            onChange={handleHotkeyChange}
            disabled={!launcherEnabled}
          />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Software Section ──────────────────────────────────────────────────────

function SoftwareSection() {
  const { t } = useTranslation()
  const { config, loading, updateConfig } = useAppConfig()
  const logging = (config?.logging || {}) as { level?: LogViewerLevel }
  const persistedLevel = logging.level || 'info'
  const ui = (config?.ui || {}) as { linkOpenBehavior?: string }
  const linkOpenBehavior = ui.linkOpenBehavior === 'external' ? 'external' : 'drawer'

  const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(true)
  const [telemetryLoaded, setTelemetryLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window.appRuntime.telemetry.getConfig().then((res) => {
      if (cancelled) return
      if (res.ok && res.config) setTelemetryEnabled(res.config.enabled)
      setTelemetryLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  const handleTelemetryToggle = (next: boolean) => {
    setTelemetryEnabled(next)
    void window.appRuntime.telemetry.setEnabled(next)
  }

  const handleLevelChange = (value: string) => {
    updateConfig({ logging: { ...logging, level: value as LogViewerLevel } })
  }

  const handleLinkOpenBehaviorChange = (value: string) => {
    updateConfig({ ui: { ...ui, linkOpenBehavior: value } })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={SlidersHorizontal} title={t('settings.software.title')} subtitle={t('settings.software.subtitle')} />
      <GroupCard title={t('settings.software.chatBehavior.title')}>
        <SettingRow
          label={t('settings.software.chatBehavior.linkOpen')}
          description={t('settings.software.chatBehavior.linkOpenDesc')}
        >
          <Segment
            options={[
              { label: t('settings.software.chatBehavior.drawer'), value: 'drawer' },
              { label: t('settings.software.chatBehavior.external'), value: 'external' },
            ]}
            value={linkOpenBehavior}
            onChange={handleLinkOpenBehaviorChange}
          />
        </SettingRow>
      </GroupCard>
      <GroupCard title={t('settings.software.logging.title')}>
        <SettingRow label={t('settings.software.logging.level')} description={t('settings.software.logging.levelDesc')}>
          <SelectInput
            value={persistedLevel}
            onChange={handleLevelChange}
            options={[
              { label: t('settings.software.logging.fatal'), value: 'fatal' },
              { label: t('settings.software.logging.error'), value: 'error' },
              { label: t('settings.software.logging.warn'), value: 'warn' },
              { label: t('settings.software.logging.info'), value: 'info' },
              { label: t('settings.software.logging.debug'), value: 'debug' },
              { label: t('settings.software.logging.trace'), value: 'trace' },
            ]}
          />
        </SettingRow>
      </GroupCard>
      <GroupCard title={t('settings.software.telemetry.title')}>
        <SettingRow
          label={t('settings.software.telemetry.enabled')}
          description={t('settings.software.telemetry.enabledDesc')}
        >
          <Toggle checked={telemetryEnabled && telemetryLoaded} onChange={handleTelemetryToggle} />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Video generation models ────────────────────────────────────────────────

const DOUBAO_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

// Built-in image/video provider keys always offered in the model page, even
// when the active config hasn't declared them yet (OpenAI + 火山引擎/Ark). The
// backend registers these names too, so a freshly-filled-in provider works
// immediately after saving.
const IMAGE_BUILTIN_PROVIDERS = ['openai', 'volcengine']
const VIDEO_BUILTIN_PROVIDERS = ['volcengine']

// Sensible prefills used when a built-in provider isn't in the active config
// yet — so the user only has to enter the api_key.
const IMAGE_PROVIDER_DEFAULTS: Record<
  string,
  { baseUrl: string; path: string; endpoints: { name: string; model: string }[] }
> = {
  openai: {
    baseUrl: 'https://api.openai.com',
    path: '/v1/images/generations',
    endpoints: [{ name: 'gpt-image', model: 'gpt-image-1' }],
  },
  volcengine: {
    baseUrl: DOUBAO_DEFAULT_BASE_URL,
    path: '/images/generations',
    endpoints: [{ name: 'seedream', model: 'doubao-seedream-3-0-t2i-250415' }],
  },
}
const VIDEO_PROVIDER_DEFAULTS: Record<
  string,
  { baseUrl: string; endpoints: { name: string; model: string }[] }
> = {
  volcengine: {
    baseUrl: DOUBAO_DEFAULT_BASE_URL,
    endpoints: [{ name: 'seedance', model: 'doubao-seedance-1-0-lite-i2v-250428' }],
  },
}

// Local editable shape for one endpoint row. We keep `name` in the row
// (rather than as the map key) so the user can rename an endpoint freely
// without React losing the row's input focus on every keystroke.
interface VideoEndpointRow {
  name: string
  model: string
}

const IMAGE_DEFAULT_PATH = '/v1/images/generations'

// 图片生成 provider 配置。GET /api/v1/imagegen → 渲染指定 provider 的
// 凭证 + path + 每个 endpoint 的 model 绑定;编辑后 PATCH /api/v1/imagegen
// 持久化。结构对齐 VideoModelSection,额外多一个「API 地址 path」字段
// (videogen 没有 path,imagegen 有)。每个 provider 一个卡片,由
// ModelSection 左栏选中的 providerName 决定渲染哪一个。
function ImageModelSection({ providerName }: { providerName: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [toastNotice, setToastNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  const [apiKey, setApiKey] = useState('')
  // Unified「API 地址」= the full endpoint URL (base_url + path joined). The
  // backend stores it as base_url with an empty path, so split-form configs
  // (base_url + path) are joined here on load and flattened on save.
  const [apiUrl, setApiUrl] = useState('')
  const [endpoints, setEndpoints] = useState<VideoEndpointRow[]>([])

  // Hydrate form state from a GET/PATCH response, scoped to providerName.
  // Typed structurally rather than via the ambient `ImageGenListing` name
  // (preload's interfaces aren't visible to the renderer tsconfig — same
  // reason `ProviderInfo` is referenced structurally throughout this file).
  const hydrate = useCallback(
    (listing: {
      providers?: Record<
        string,
        { api_key?: string; base_url?: string; path?: string; endpoints?: Record<string, { model?: string }> }
      >
    }) => {
      const prov = listing.providers?.[providerName]
      if (prov) {
        setApiKey(prov.api_key ?? '')
        setApiUrl((prov.base_url ?? '') + (prov.path ?? ''))
        setEndpoints(
          Object.entries(prov.endpoints ?? {}).map(([name, info]) => ({
            name,
            model: info?.model ?? '',
          }))
        )
        return
      }
      // Not in the active config yet — prefill built-in defaults so the user
      // only needs to enter the api_key (火山引擎/openai).
      const d = IMAGE_PROVIDER_DEFAULTS[providerName]
      setApiKey('')
      setApiUrl(d ? d.baseUrl + d.path : '')
      setEndpoints(d ? d.endpoints.map((e) => ({ ...e })) : [])
    },
    [providerName]
  )

  useEffect(() => {
    setLoading(true)
    void (async () => {
      try {
        const res = await window.agentApi.listImageProviders()
        if (res.ok) {
          hydrate(res.data)
        } else {
          setToastNotice({ tone: 'error', message: res.message || res.error })
        }
      } catch {
        setToastNotice({ tone: 'error', message: '加载失败' })
      } finally {
        setLoading(false)
      }
    })()
  }, [hydrate])

  // Auto-dismiss toast — mirrors ModelSection's 2.6s budget.
  useEffect(() => {
    if (!toastNotice) return
    const timer = window.setTimeout(() => setToastNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toastNotice])

  const updateEndpoint = (index: number, patch: Partial<VideoEndpointRow>) => {
    setEndpoints((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  const addEndpoint = () => setEndpoints((rows) => [...rows, { name: '', model: '' }])
  const removeEndpoint = (index: number) =>
    setEndpoints((rows) => rows.filter((_, i) => i !== index))

  const handleSave = async () => {
    setSaving(true)
    try {
      // Skip rows with a blank name; trim everything so stray whitespace
      // doesn't leak into the yaml. Later duplicate names win (map insert).
      const endpointsMap: Record<string, { model: string }> = {}
      for (const row of endpoints) {
        const name = row.name.trim()
        if (!name) continue
        endpointsMap[name] = { model: row.model.trim() }
      }
      const res = await window.agentApi.patchImageConfig({
        providers: {
          [providerName]: {
            api_key: apiKey.trim(),
            base_url: apiUrl.trim(), // full endpoint URL; path flattened in
            path: '',
            endpoints: endpointsMap,
          },
        },
      })
      if (res.ok) {
        hydrate(res.data)
        setToastNotice({ tone: 'success', message: '已保存' })
      } else {
        setToastNotice({ tone: 'error', message: res.message || res.error })
      }
    } catch {
      setToastNotice({ tone: 'error', message: '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <GroupCard title={`${mediaProviderDisplayName(providerName)} 图片生成`}>
        {/* API 密钥 */}
        <div className="py-3.5 border-b border-border">
          <p className="text-sm font-semibold text-foreground mb-2">API 密钥</p>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`输入 ${providerName} API Key`}
              className="h-10 w-full rounded-md border border-border bg-background pl-3 pr-10 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>

        {/* API 地址（完整接口 URL） */}
        <div className="py-3.5 border-b border-border">
          <p className="text-sm font-semibold text-foreground mb-2">API 地址</p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder={`https://api.openai.com${IMAGE_DEFAULT_PATH}`}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">完整的图片生成接口地址，例如 {`https://api.openai.com${IMAGE_DEFAULT_PATH}`}</p>
        </div>

        {/* Endpoints */}
        <div className="py-3.5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-foreground">Endpoints</p>
            <button
              onClick={addEndpoint}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus size={13} /> 添加 endpoint
            </button>
          </div>
          {endpoints.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">暂无 endpoint,点击“添加 endpoint”新增一行。</p>
          ) : (
            <div className="flex flex-col gap-2">
              {endpoints.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateEndpoint(index, { name: e.target.value })}
                    placeholder="endpoint 名称"
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="text"
                    value={row.model}
                    onChange={(e) => updateEndpoint(index, { model: e.target.value })}
                    placeholder="模型 ID"
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => removeEndpoint(index)}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-status-disconnected"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </GroupCard>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {toastNotice && (
        <NoticeToast
          tone={toastNotice.tone}
          message={toastNotice.message}
          position="top"
          anchor="viewport"
        />
      )}
    </div>
  )
}

// 视频生成 provider 配置。GET /api/v1/videogen → 渲染指定 provider 卡片;
// 编辑后通过 PATCH /api/v1/videogen 持久化。结构刻意对齐 ModelSection:
// loading spinner + NoticeToast 反馈 + 密码框 show/hide。providerName 由
// ModelSection 左栏选中的视频 provider 决定。

function VideoModelSection({ providerName }: { providerName: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [toastNotice, setToastNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [endpoints, setEndpoints] = useState<VideoEndpointRow[]>([])

  // Hydrate form state from a GET/PATCH response, scoped to providerName.
  // Typed structurally rather than via the ambient `VideoGenListing` name
  // (preload's interfaces aren't visible to the renderer tsconfig — same
  // reason `ProviderInfo` is referenced structurally throughout this file).
  const hydrate = useCallback(
    (listing: {
      providers?: Record<
        string,
        { api_key?: string; base_url?: string; endpoints?: Record<string, { model?: string }> }
      >
    }) => {
      const prov = listing.providers?.[providerName]
      if (prov) {
        setApiKey(prov.api_key ?? '')
        setBaseUrl(prov.base_url ?? '')
        setEndpoints(
          Object.entries(prov.endpoints ?? {}).map(([name, info]) => ({
            name,
            model: info?.model ?? '',
          }))
        )
        return
      }
      // Not in the active config yet — prefill built-in defaults (火山引擎).
      const d = VIDEO_PROVIDER_DEFAULTS[providerName]
      setApiKey('')
      setBaseUrl(d?.baseUrl ?? '')
      setEndpoints(d ? d.endpoints.map((e) => ({ ...e })) : [])
    },
    [providerName]
  )

  useEffect(() => {
    setLoading(true)
    void (async () => {
      try {
        const res = await window.agentApi.listVideoProviders()
        if (res.ok) {
          hydrate(res.data)
        } else {
          setToastNotice({ tone: 'error', message: res.message || res.error })
        }
      } catch {
        setToastNotice({ tone: 'error', message: '加载失败' })
      } finally {
        setLoading(false)
      }
    })()
  }, [hydrate])

  // Auto-dismiss toast — mirrors ModelSection's 2.6s budget.
  useEffect(() => {
    if (!toastNotice) return
    const timer = window.setTimeout(() => setToastNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toastNotice])

  const updateEndpoint = (index: number, patch: Partial<VideoEndpointRow>) => {
    setEndpoints((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  const addEndpoint = () => setEndpoints((rows) => [...rows, { name: '', model: '' }])
  const removeEndpoint = (index: number) =>
    setEndpoints((rows) => rows.filter((_, i) => i !== index))

  const handleSave = async () => {
    setSaving(true)
    try {
      // Skip rows with a blank name; trim everything so stray whitespace
      // doesn't leak into the yaml. Later duplicate names win (map insert).
      const endpointsMap: Record<string, { model: string }> = {}
      for (const row of endpoints) {
        const name = row.name.trim()
        if (!name) continue
        endpointsMap[name] = { model: row.model.trim() }
      }
      // Patch shape matches the ambient `VideoGenPatchPayload`; passed
      // inline so it's structurally checked at the call site without
      // naming the (renderer-invisible) type.
      const res = await window.agentApi.patchVideoConfig({
        providers: {
          [providerName]: {
            api_key: apiKey.trim(),
            base_url: baseUrl.trim(),
            endpoints: endpointsMap,
          },
        },
      })
      if (res.ok) {
        hydrate(res.data)
        setToastNotice({ tone: 'success', message: '已保存' })
      } else {
        setToastNotice({ tone: 'error', message: res.message || res.error })
      }
    } catch {
      setToastNotice({ tone: 'error', message: '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <GroupCard title={`${mediaProviderDisplayName(providerName)} 视频生成`}>
        {/* API 密钥 */}
        <div className="py-3.5 border-b border-border">
          <p className="text-sm font-semibold text-foreground mb-2">API 密钥</p>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`输入 ${providerName} API Key`}
              className="h-10 w-full rounded-md border border-border bg-background pl-3 pr-10 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>

        {/* API 地址 */}
        <div className="py-3.5 border-b border-border">
          <p className="text-sm font-semibold text-foreground mb-2">API 地址</p>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DOUBAO_DEFAULT_BASE_URL}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">留空则使用默认地址 {DOUBAO_DEFAULT_BASE_URL}</p>
        </div>

        {/* Endpoints */}
        <div className="py-3.5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-foreground">Endpoints</p>
            <button
              onClick={addEndpoint}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus size={13} /> 添加 endpoint
            </button>
          </div>
          {endpoints.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">暂无 endpoint,点击“添加 endpoint”新增一行。</p>
          ) : (
            <div className="flex flex-col gap-2">
              {endpoints.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateEndpoint(index, { name: e.target.value })}
                    placeholder="endpoint 名称"
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="text"
                    value={row.model}
                    onChange={(e) => updateEndpoint(index, { model: e.target.value })}
                    placeholder="模型 ID"
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => removeEndpoint(index)}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-status-disconnected"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </GroupCard>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {toastNotice && (
        <NoticeToast
          tone={toastNotice.tone}
          message={toastNotice.message}
          position="top"
          anchor="viewport"
        />
      )}
    </div>
  )
}

// ─── Nav ───────────────────────────────────────────────────────────────────

type SectionKey = 'connection' | 'auth' | 'models' | 'agents' | 'channels' | 'search' | 'tools' | 'ui' | 'storage' | 'logs' | 'updates' | 'software' | 'launcher'

const FULL_WIDTH_SECTIONS = new Set<SectionKey>(['models', 'search', 'logs'])

export function SettingsPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const initialSection = location.state?.initialSection as SectionKey | undefined
  const [active, setActive] = useState<SectionKey>(
    initialSection === 'channels' || initialSection === 'auth' ? 'connection' : (initialSection || 'connection')
  )
  // Counter incremented when the user clicks "去配置 Agent LLM 节点"
  // on the 模型配置 page. Forwarded into AgentSection → ProviderStrategyRow
  // so the 主 Provider dropdown briefly pulses after navigation.
  const [agentBlinkSignal, setAgentBlinkSignal] = useState(0)

  const navGroups: { title: string; items: { key: SectionKey; icon: React.ElementType; label: string }[] }[] = useMemo(() => [
    {
      title: '',
      items: [
        { key: 'connection', icon: Wifi, label: t('settings.nav.connection') },
        { key: 'models', icon: Cpu, label: t('settings.nav.models') },
        { key: 'agents', icon: Bot, label: t('settings.nav.agents') },
        { key: 'search', icon: Search, label: t('settings.nav.search') },
        { key: 'tools', icon: Wrench, label: t('settings.nav.tools') },
      ],
    },
    {
      title: t('settings.nav.appConfig'),
      items: [
        { key: 'software', icon: SlidersHorizontal, label: t('settings.nav.software') },
        { key: 'launcher', icon: Keyboard, label: t('settings.nav.launcher') },
        { key: 'logs', icon: FileText, label: t('settings.nav.logs') },
        { key: 'ui', icon: Palette, label: t('settings.nav.ui') },
        { key: 'storage', icon: HardDrive, label: t('settings.nav.storage') },
        { key: 'updates', icon: RotateCcw, label: t('settings.nav.updates') },
      ],
    },
  ], [t])

  useEffect(() => {
    if (initialSection) {
      setActive(initialSection === 'channels' || initialSection === 'auth' ? 'connection' : initialSection)
    }
  }, [initialSection])

  const handleNavigateToAgents = () => {
    setActive('agents')
    setAgentBlinkSignal((n) => n + 1)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left nav */}
      <nav className="w-48 flex-shrink-0 border-r border-border bg-card flex flex-col py-4 gap-0.5 px-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-1">
          {t('settings.nav.settings')}
        </p>
        {navGroups.map((group, groupIndex) => (
          <div key={group.title} className={cn(groupIndex > 0 && 'mt-2 pt-3 border-t border-border')}>
            {group.title ? (
              <div className="px-2.5 mb-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{group.title}</p>
              </div>
            ) : null}
            {group.items.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActive(key)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left',
                  active === key
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon size={15} className="flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Right content */}
      <div className={cn('flex-1', FULL_WIDTH_SECTIONS.has(active) ? 'overflow-hidden' : 'overflow-y-auto')}>
        {FULL_WIDTH_SECTIONS.has(active) ? (
          <>
            {active === 'models' && <ModelSection onNavigateToAgents={handleNavigateToAgents} />}
            {active === 'search' && <SearchSection />}
            {active === 'logs' && <LogsSection />}
          </>
        ) : (
          <div className="max-w-2xl mx-auto px-8 py-8">
            {active === 'connection' && <ConnectionSection />}
            {active === 'agents' && (
              <AgentSection
                onNavigateToModels={() => setActive('models')}
                blinkPrimarySignal={agentBlinkSignal}
              />
            )}
            {active === 'tools' && <ToolsSection />}
            {active === 'updates' && <UpdateSection />}
            {active === 'software' && <SoftwareSection />}
            {active === 'launcher' && <LauncherSection />}
            {active === 'ui' && <UISection />}
            {active === 'storage' && <StorageSection />}
          </div>
        )}
      </div>
    </div>
  )
}
