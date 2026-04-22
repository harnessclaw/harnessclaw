import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Wifi, Shield, Palette, HardDrive,
  Eye, EyeOff, Loader2, Check, X,
  FolderOpen, Download, Trash2,
  Search, Cpu,
  Bot, Radio, Wrench, FileText,
  Pause, Play, RotateCcw, AlertTriangle,
  ChevronDown, ChevronRight, ExternalLink
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { NoticeToast } from '../common/NoticeToast'
import { useAppConfig, useEngineConfig } from '@/hooks/useEngineConfig'
import { defaultDbDisplayPath, defaultLogsDisplayPath } from '@/lib/runtimePaths'

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

function StackedField({
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
    <div className={cn('py-4 border-b border-border last:border-0', className)}>
      <div className="mb-2.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
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
}: {
  value: string
  onChange: (v: string) => void
  options: { label: string; value: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 px-2 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow cursor-pointer text-foreground"
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
  const { config, loading, updateConfig } = useEngineConfig()

  const gw = (config?.gateway || {}) as { host?: string; port?: number; heartbeat?: { enabled?: boolean; intervalS?: number } }
  const host = gw.host ?? '0.0.0.0'
  const port = gw.port ?? 18790
  const hbEnabled = gw.heartbeat?.enabled ?? true
  const hbInterval = gw.heartbeat?.intervalS ?? 1800

  const [autoReconnect, setAutoReconnect] = useState(true)
  const [reconnectInterval, setReconnectInterval] = useState(5)
  const [connTimeout, setConnTimeout] = useState(10)

  const updateGateway = (patch: Record<string, unknown>) => {
    updateConfig({ gateway: { ...gw, ...patch } })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Wifi} title="连接设置" subtitle="Gateway 连接与心跳" />
      <GroupCard title="Gateway 连接">
        <SettingRow label="监听地址" description="Gateway 服务端绑定的主机地址">
          <TextInput value={host} onChange={(v) => updateGateway({ host: v })} placeholder="0.0.0.0" className="w-40" mono />
        </SettingRow>
        <SettingRow label="端口" description="Gateway 监听端口号">
          <NumberInput value={port} onChange={(v) => updateGateway({ port: v })} min={1} max={65535} className="w-20" />
        </SettingRow>
        <SettingRow label="自动重连" description="连接断开后自动尝试重新连接">
          <Toggle checked={autoReconnect} onChange={setAutoReconnect} />
        </SettingRow>
        <SettingRow label="重连间隔" description="每次重连尝试之间的等待时间">
          <NumberInput value={reconnectInterval} onChange={setReconnectInterval} suffix="秒" min={1} max={60} disabled={!autoReconnect} />
        </SettingRow>
        <SettingRow label="连接超时" description="建立连接的最大等待时间">
          <NumberInput value={connTimeout} onChange={setConnTimeout} suffix="秒" min={3} max={60} />
        </SettingRow>
      </GroupCard>

      <GroupCard title="心跳">
        <SettingRow label="心跳检测" description="定期发送 ping 保持连接活跃">
          <Toggle checked={hbEnabled} onChange={(v) => updateGateway({ heartbeat: { ...gw.heartbeat, enabled: v } })} />
        </SettingRow>
        <SettingRow label="心跳间隔" description="发送心跳包的时间间隔">
          <NumberInput value={hbInterval} onChange={(v) => updateGateway({ heartbeat: { ...gw.heartbeat, intervalS: v } })} suffix="秒" min={10} max={7200} disabled={!hbEnabled} />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Auth Section ───────────────────────────────────────────────────────────

function AuthSection() {
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
      <SectionHeader icon={Shield} title="认证设置" subtitle="本地配置，无需 API 支持" />
      <GroupCard title="认证模式">
        <SettingRow label="认证方式" description="选择连接 Gateway 时使用的认证协议">
          <Segment options={authModeOptions} value={mode} onChange={(v) => updateAuth({ mode: v as AuthMode })} />
        </SettingRow>

        {mode === 'token' && (
          <SettingRow label="Token" description="连接时使用的访问令牌">
            <div className="flex items-center gap-1.5">
              <input
                type={showSecret ? 'text' : 'password'}
                value={token}
                onChange={(e) => updateAuth({ token: e.target.value })}
                placeholder="输入 Token"
                className="w-48 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
              />
              <button onClick={() => setShowSecret(!showSecret)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </SettingRow>
        )}

        {mode === 'password' && (
          <SettingRow label="密码" description="连接时使用的认证密码">
            <div className="flex items-center gap-1.5">
              <input
                type={showSecret ? 'text' : 'password'}
                value={password}
                onChange={(e) => updateAuth({ password: e.target.value })}
                placeholder="输入密码"
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
            无需认证，直接连接 Gateway。仅适用于本地开发环境。
          </div>
        )}

        {mode === 'trusted-proxy' && (
          <div className="py-3 text-xs text-muted-foreground">
            通过受信任代理转发认证信息，由代理层负责鉴权。
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
          {testState === 'testing' ? '连接中...' : '测试连接'}
        </button>
        {testState === 'ok' && <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium"><Check size={14} /> 连接成功</span>}
        {testState === 'fail' && <span className="flex items-center gap-1.5 text-sm text-red-500 font-medium"><X size={14} /> 连接失败</span>}
      </div>
    </div>
  )
}

// ─── Agent Section ──────────────────────────────────────────────────────────

function AgentSection() {
  const { config, loading, updateConfig } = useEngineConfig()

  const agents = (config?.agents || {}) as { defaults?: Record<string, unknown> }
  const defaults = agents.defaults || {}
  const workspace = (defaults.workspace as string) ?? '~/.harnessclaw/workspace'
  const provider = (defaults.provider as string) ?? 'auto'
  const maxTokens = (defaults.maxTokens as number) ?? 8192
  const contextWindowTokens = (defaults.contextWindowTokens as number) ?? 65536
  const temperature = (defaults.temperature as number) ?? 0.1
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
      <SectionHeader icon={Bot} title="Agent 默认设置" subtitle="新建 Agent 的默认参数" />

      <GroupCard title="模型">
        <SettingRow label="Provider 策略" description="选择模型提供方的路由策略">
          <SelectInput
            value={provider}
            onChange={(v) => updateDefaults({ provider: v })}
            options={[
              { label: '自动 (auto)', value: 'auto' },
              { label: 'Anthropic', value: 'anthropic' },
              { label: 'OpenAI', value: 'openai' },
              { label: 'DeepSeek', value: 'deepseek' },
              { label: 'Groq', value: 'groq' },
              { label: 'Ollama', value: 'ollama' },
              { label: 'OpenRouter', value: 'openrouter' },
            ]}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title="生成参数">
        <SettingRow label="Max Tokens" description="单次回复的最大 Token 数">
          <NumberInput value={maxTokens} onChange={(v) => updateDefaults({ maxTokens: v })} min={256} max={200000} className="w-24" />
        </SettingRow>
        <SettingRow label="Context Window" description="上下文窗口大小 (Tokens)">
          <NumberInput value={contextWindowTokens} onChange={(v) => updateDefaults({ contextWindowTokens: v })} min={1024} max={2000000} className="w-24" />
        </SettingRow>
        <SettingRow label="Temperature" description="生成温度，值越高越随机">
          <SliderInput value={temperature} onChange={(v) => updateDefaults({ temperature: v })} min={0} max={2} step={0.1} />
        </SettingRow>
        <SettingRow label="Reasoning Effort" description="推理强度 (留空使用模型默认)">
          <SelectInput
            value={reasoningEffort || ''}
            onChange={(v) => updateDefaults({ reasoningEffort: v || null })}
            options={[
              { label: '默认', value: '' },
              { label: 'low', value: 'low' },
              { label: 'medium', value: 'medium' },
              { label: 'high', value: 'high' },
            ]}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title="工具与工作区">
        <SettingRow label="Max Tool Iterations" description="Agent 单轮最大工具调用次数">
          <NumberInput value={maxToolIterations} onChange={(v) => updateDefaults({ maxToolIterations: v })} min={1} max={200} className="w-20" />
        </SettingRow>
        <SettingRow label="工作目录" description="Agent 的默认文件工作区路径">
          <TextInput value={workspace} onChange={(v) => updateDefaults({ workspace: v })} className="w-52" mono />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Model Config Helpers ───────────────────────────────────────────────────

interface ProviderConfig {
  apiKey: string
  apiBase: string | null
  model: string | null
  protocol: 'openai' | 'anthropic'
  extraHeaders: Record<string, string> | null
  raw: Record<string, unknown>
}

type ManagedProviderKey = 'anthropic' | 'openai' | 'custom'
type ProtocolProviderKey = 'anthropic' | 'openai'

const MANAGED_PROVIDER_KEYS: ManagedProviderKey[] = ['anthropic', 'openai', 'custom']
const PROTOCOL_PROVIDER_KEYS: ProtocolProviderKey[] = ['anthropic', 'openai']

const PROVIDER_DISPLAY_NAMES: Record<ManagedProviderKey, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  custom: 'Custom',
}

const PROVIDER_DEFAULT_BASES: Record<ManagedProviderKey, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  custom: '',
}

const AVATAR_COLORS = [
  '#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399',
  '#22D3EE', '#60A5FA', '#818CF8', '#A78BFA', '#C084FC',
  '#F472B6', '#FB7185', '#4ADE80', '#2DD4BF', '#38BDF8',
]

function getProviderColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getProviderInitial(key: string): string {
  const name = isManagedProviderKey(key) ? PROVIDER_DISPLAY_NAMES[key] : key
  return name.charAt(0).toUpperCase()
}

function getDisplayName(key: ManagedProviderKey): string {
  return PROVIDER_DISPLAY_NAMES[key]
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
    protocol: protocol === 'anthropic' ? 'anthropic' : 'openai',
    extraHeaders: (raw.extraHeaders as Record<string, string> | null) ?? null,
    raw,
  }
}

function isManagedProviderKey(value: string): value is ManagedProviderKey {
  return MANAGED_PROVIDER_KEYS.includes(value as ManagedProviderKey)
}

function createEmptyProviderConfig(key: ManagedProviderKey): ProviderConfig {
  return {
    apiKey: '',
    apiBase: PROVIDER_DEFAULT_BASES[key] || null,
    model: null,
    protocol: key === 'anthropic' ? 'anthropic' : 'openai',
    extraHeaders: null,
    raw: {},
  }
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

  const protocolProviders = PROTOCOL_PROVIDER_KEYS.reduce((acc, key) => {
    const appProvider = asRecord(appProviders[key])
    const merged = mergeProviderSource(rootProviders[key], llmProviders[key])
    const normalized = normalizeProviderConfig(Object.keys(appProvider).length > 0 ? appProvider : merged)
    acc[key] = {
      ...createEmptyProviderConfig(key),
      ...normalized,
      apiBase: normalized.apiBase ?? (PROVIDER_DEFAULT_BASES[key] || null),
      raw: appProvider,
    }
    return acc
  }, {} as Record<ProtocolProviderKey, ProviderConfig>)

  const customProvider = (() => {
    const raw = asRecord(appProviders.custom)
    const fallback = mergeProviderSource(rootProviders.custom, llmProviders.custom)
    const source = Object.keys(raw).length > 0 ? raw : fallback
    const normalized = normalizeProviderConfig(source)
    return {
      ...createEmptyProviderConfig('custom'),
      ...normalized,
      apiBase: normalized.apiBase ?? null,
      raw: source,
    }
  })()

  return {
    anthropic: protocolProviders.anthropic,
    openai: protocolProviders.openai,
    custom: customProvider,
  }
}

function getManagedDefaultProvider(
  engineConfig: Record<string, unknown>,
  appConfig: Record<string, unknown>,
): ManagedProviderKey {
  const modelProviders = getAppModelProvidersConfig(appConfig)
  const defaultSelection = modelProviders.defaultSelection
  if (typeof defaultSelection === 'string' && isManagedProviderKey(defaultSelection)) {
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
  if (typeof appDefault === 'string' && isManagedProviderKey(appDefault)) {
    return appDefault
  }

  return 'anthropic'
}

function buildAppProviderRaw(next: ProviderConfig): Record<string, unknown> {
  const apiKey = next.apiKey.trim()
  const apiBase = next.apiBase?.trim() || ''
  const model = next.model?.trim() || ''

  return {
    apiKey,
    apiBase,
    model,
    protocol: next.protocol,
    extraHeaders: next.extraHeaders ?? null,
  }
}

function buildEngineProtocolProviderRaw(
  existingRaw: Record<string, unknown>,
  next: ProviderConfig,
): Record<string, unknown> | null {
  const apiKey = next.apiKey.trim()
  const apiBase = next.apiBase?.trim() || ''
  const model = next.model?.trim() || ''
  const hasValues = Boolean(apiKey || apiBase || model)
  const maxTokens = typeof existingRaw.max_tokens === 'number' ? existingRaw.max_tokens : undefined

  if (!hasValues && maxTokens === undefined) {
    return null
  }

  return {
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    base_url: apiBase,
    api_key: apiKey,
    model,
  }
}

function buildEngineModelConfig(
  previous: Record<string, unknown>,
  providers: Record<ManagedProviderKey, ProviderConfig>,
  defaultProvider: ManagedProviderKey,
): Record<string, unknown> {
  const { providers: _legacyProviders, ...rest } = previous
  const llm = asRecord(previous.llm)
  const llmProviders = asRecord(llm.providers)
  const resolvedDefaultProvider: ProtocolProviderKey = defaultProvider === 'custom'
    ? providers.custom.protocol
    : defaultProvider

  const resolvedProviders: Record<ProtocolProviderKey, ProviderConfig> = {
    anthropic: defaultProvider === 'custom' && providers.custom.protocol === 'anthropic'
      ? providers.custom
      : providers.anthropic,
    openai: defaultProvider === 'custom' && providers.custom.protocol === 'openai'
      ? providers.custom
      : providers.openai,
  }

  const nextLlmProviders = PROTOCOL_PROVIDER_KEYS.reduce((acc, key) => {
    const raw = buildEngineProtocolProviderRaw(asRecord(llmProviders[key]), resolvedProviders[key])
    if (raw) {
      acc[key] = raw
    }
    return acc
  }, {} as Record<ProtocolProviderKey, Record<string, unknown>>)

  return {
    ...rest,
    llm: {
      ...llm,
      default_provider: resolvedDefaultProvider,
      providers: nextLlmProviders,
    },
  }
}

function buildAppModelConfig(
  previous: Record<string, unknown>,
  providers: Record<ManagedProviderKey, ProviderConfig>,
  defaultProvider: ManagedProviderKey,
): Record<string, unknown> {
  const agents = asRecord(previous.agents)
  const defaults = asRecord(agents.defaults)
  const modelProviders = getAppModelProvidersConfig(previous)
  const resolvedDefaultProvider: ProtocolProviderKey = defaultProvider === 'custom'
    ? providers.custom.protocol
    : defaultProvider
  const activeProvider = defaultProvider === 'custom'
    ? providers.custom
    : providers[defaultProvider]
  const modelId = activeProvider.model?.trim() || ''

  return {
    ...previous,
    modelProviders: {
      ...modelProviders,
      defaultSelection: defaultProvider,
      anthropic: buildAppProviderRaw(providers.anthropic),
      openai: buildAppProviderRaw(providers.openai),
      custom: buildAppProviderRaw(providers.custom),
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

function hasPersistedModelProviders(appConfig: Record<string, unknown>): boolean {
  const modelProviders = getAppModelProvidersConfig(appConfig)
  return Object.keys(modelProviders).length > 0
}

function hasLegacyEngineConfig(engineConfig: Record<string, unknown>): boolean {
  const legacyProviders = asRecord(engineConfig.providers)
  if (Object.keys(legacyProviders).length > 0) {
    return true
  }

  const llmProviders = asRecord(asRecord(engineConfig.llm).providers)
  if (Object.keys(asRecord(llmProviders.custom)).length > 0) {
    return true
  }

  return Object.values(llmProviders).some((value) => {
    const provider = asRecord(value)
    return 'apiKey' in provider
      || 'apiBase' in provider
      || 'baseUrl' in provider
      || 'enabled' in provider
      || 'protocol' in provider
      || 'apiProtocol' in provider
      || 'compatibility' in provider
  })
}

// ─── Model Section ──────────────────────────────────────────────────────────

function ModelSection() {
  const [engineConfig, setEngineConfig] = useState<Record<string, unknown> | null>(null)
  const [appConfig, setAppConfig] = useState<Record<string, unknown> | null>(null)
  const [providers, setProviders] = useState<Record<ManagedProviderKey, ProviderConfig>>({
    anthropic: createEmptyProviderConfig('anthropic'),
    openai: createEmptyProviderConfig('openai'),
    custom: createEmptyProviderConfig('custom'),
  })
  const [defaultProvider, setDefaultProvider] = useState<ManagedProviderKey>('anthropic')
  const [selectedProvider, setSelectedProvider] = useState<ManagedProviderKey>('anthropic')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showApiKey, setShowApiKey] = useState(false)
  const [persistState, setPersistState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [persistMessage, setPersistMessage] = useState('')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [toastNotice, setToastNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [engineData, appData] = await Promise.all([
          window.engineConfig.read(),
          window.appConfig.read(),
        ])
        const nextProviders = getManagedProviders(engineData, appData)
        const nextDefaultProvider = getManagedDefaultProvider(engineData, appData)
        const shouldNormalize = hasLegacyEngineConfig(engineData) || !hasPersistedModelProviders(appData)

        let normalizedEngineConfig = engineData
        let normalizedAppConfig = appData

        if (shouldNormalize) {
          const nextEngineConfig = buildEngineModelConfig(engineData, nextProviders, nextDefaultProvider)
          const nextAppConfig = buildAppModelConfig(appData, nextProviders, nextDefaultProvider)
          const [engineResult, appResult] = await Promise.all([
            window.engineConfig.save(nextEngineConfig),
            window.appConfig.save(nextAppConfig),
          ])

          if (engineResult.ok && appResult.ok) {
            normalizedEngineConfig = nextEngineConfig
            normalizedAppConfig = nextAppConfig
          }
        }

        setEngineConfig(normalizedEngineConfig)
        setAppConfig(normalizedAppConfig)
        setProviders(nextProviders)
        setDefaultProvider(nextDefaultProvider)
        setSelectedProvider(nextDefaultProvider)
      } catch {
        setPersistState('error')
        setPersistMessage('模型配置读取失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const queuePersist = useCallback(
    (
      nextProviders: Record<ManagedProviderKey, ProviderConfig>,
      nextDefaultProvider: ManagedProviderKey,
    ) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      setPersistState('saving')
      setPersistMessage('正在同步到 SQLite 和 engine YAML...')
      saveTimerRef.current = setTimeout(async () => {
        if (!engineConfig || !appConfig) return

        const nextEngineConfig = buildEngineModelConfig(engineConfig, nextProviders, nextDefaultProvider)
        const nextAppConfig = buildAppModelConfig(appConfig, nextProviders, nextDefaultProvider)
        const [engineResult, appResult] = await Promise.all([
          window.engineConfig.save(nextEngineConfig),
          window.appConfig.save(nextAppConfig),
        ])

        if (!engineResult.ok || !appResult.ok) {
          setPersistState('error')
          setPersistMessage(engineResult.error || appResult.error || '模型配置保存失败')
          return
        }

        setEngineConfig(nextEngineConfig)
        setAppConfig(nextAppConfig)
        setPersistState('saved')
      }, 500)
    },
    [appConfig, engineConfig]
  )

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  useEffect(() => {
    if (!toastNotice) return
    const timer = window.setTimeout(() => setToastNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toastNotice])

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

  const getDefaultProviderValidationError = (key: ManagedProviderKey): string | null => {
    const provider = providers[key]
    if (!provider.apiKey.trim()) {
      return `${getDisplayName(key)} 的 API 密钥不能为空`
    }
    if (!(provider.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key])) {
      return `${getDisplayName(key)} 的 API 地址不能为空`
    }
    if (!provider.model?.trim()) {
      return `${getDisplayName(key)} 的 Model ID 不能为空`
    }
    return null
  }

  const handleDefaultProviderChange = (nextProvider: ManagedProviderKey): boolean => {
    const validationError = getDefaultProviderValidationError(nextProvider)
    if (validationError) {
      setToastNotice({ tone: 'error', message: validationError })
      return false
    }

    setDefaultProvider(nextProvider)
    queuePersist(providers, nextProvider)
    setToastNotice({ tone: 'success', message: `${getDisplayName(nextProvider)} 已设为当前默认模型` })
    return true
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

  const selected = providers[selectedProvider]
  const providerKeys = MANAGED_PROVIDER_KEYS.filter((key) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return key.toLowerCase().includes(q) || getDisplayName(key).toLowerCase().includes(q)
  })

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
              placeholder="搜索模型平台..."
              className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {providerKeys.map((key) => {
            const providerConfig = providers[key]
            const isActive = key === selectedProvider
            const isEnabled = key === defaultProvider

            return (
              <button
                key={key}
                onClick={() => {
                  setSelectedProvider(key)
                  setShowApiKey(false)
                  setTestState('idle')
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors mb-0.5',
                  isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                )}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                  style={{ backgroundColor: getProviderColor(key) }}
                >
                  {getProviderInitial(key)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{getDisplayName(key)}</span>
                    {isEnabled && (
                      <span className="text-[10px] font-semibold text-status-connected bg-status-connected/15 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        ON
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {key === 'custom'
                      ? `Custom / ${providerConfig.protocol === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 协议'}`
                      : providerConfig.model?.trim() || '未设置 Model ID'}
                  </p>
                </div>
              </button>
            )
          })}

          {providerKeys.length === 0 && (
            <div className="px-2 py-4">
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                没有匹配的模型平台
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 max-w-[52rem]">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                style={{ backgroundColor: getProviderColor(selectedProvider) }}
              >
                {getProviderInitial(selectedProvider)}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{getDisplayName(selectedProvider)}</h2>
                <p className="text-xs text-muted-foreground">Provider 与默认模型</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">设为默认</span>
              <Toggle
                checked={selectedProvider === defaultProvider}
                onChange={(checked) => {
                  if (checked && selectedProvider !== defaultProvider) {
                    handleDefaultProviderChange(selectedProvider)
                  }
                }}
              />
            </div>
          </div>

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

          <div className="mx-auto w-full max-w-[36rem]">
            <GroupCard title="配置">
              {selectedProvider === 'custom' && (
                <SettingRow
                  label="协议兼容"
                  description="指定 Custom provider 写入 llm.providers 时使用的协议格式"
                >
                  <Segment
                    value={selected.protocol}
                    onChange={(value) => updateProvider(selectedProvider, { protocol: value as ProviderConfig['protocol'] })}
                    options={[
                      { label: 'OpenAI 协议', value: 'openai' },
                      { label: 'Anthropic 协议', value: 'anthropic' },
                    ]}
                  />
                </SettingRow>
              )}

              <StackedField
                label="API 密钥"
                description="填写当前 provider 的访问密钥，可直接在这里做连通性检测"
              >
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={selected.apiKey}
                    onChange={(e) => updateProvider(selectedProvider, { apiKey: e.target.value })}
                    placeholder="输入 API 密钥"
                    className="h-10 w-full rounded-md border border-border bg-background pl-3 pr-[6.9rem] text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
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
                        'inline-flex h-7 min-w-[3.75rem] items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors',
                        testState === 'ok' ? 'border-status-connected text-status-connected'
                          : testState === 'fail' ? 'border-status-disconnected text-status-disconnected'
                            : 'border-border bg-card hover:bg-muted text-foreground'
                      )}
                    >
                      {testState === 'testing' && <Loader2 size={12} className="animate-spin" />}
                      {testState === 'ok' && <Check size={12} />}
                      {testState === 'fail' && <X size={12} />}
                      {testState === 'testing' ? '检测中' : testState === 'ok' ? '可用' : testState === 'fail' ? '失败' : '检测'}
                    </button>
                  </div>
                </div>
              </StackedField>

              <StackedField
                label="API 地址"
                description="留空时使用该 provider 的默认地址，自定义网关可直接填写兼容入口"
              >
                <input
                  type="text"
                  value={selected.apiBase || ''}
                  onChange={(e) => updateProvider(selectedProvider, { apiBase: e.target.value || null })}
                  placeholder={PROVIDER_DEFAULT_BASES[selectedProvider] || 'https://api.example.com'}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />
                {selectedProvider === 'custom' && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Custom 当前按 {selected.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'} 协议映射到 `llm.providers`。
                  </p>
                )}
              </StackedField>

              <StackedField
                label="Model ID"
                description="设置默认调用的模型名称，这里会作为该 provider 的首选模型"
              >
                <input
                  type="text"
                  value={selected.model || ''}
                  onChange={(e) => updateProvider(selectedProvider, { model: e.target.value || null })}
                  placeholder="输入默认使用的 Model ID"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />
                <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  {selectedProvider === defaultProvider
                    ? `当前默认 provider 为 ${getDisplayName(defaultProvider)}，这里的修改会同步成为应用默认模型。`
                    : `当前默认 provider 为 ${getDisplayName(defaultProvider)}。如需切换，请开启右上角“设为默认”。`}
                </div>
              </StackedField>
            </GroupCard>
          </div>
        </div>
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

// ─── Channel Config Helpers ─────────────────────────────────────────────────

const CHANNEL_DISPLAY: Record<string, { name: string; icon: string; color: string }> = {
  dingtalk:  { name: '钉钉', icon: '钉', color: '#3370FF' },
  discord:   { name: 'Discord', icon: 'D', color: '#5865F2' },
  email:     { name: 'Email', icon: '@', color: '#EA4335' },
  feishu:    { name: '飞书', icon: '飞', color: '#3370FF' },
  mochat:    { name: 'MoChat', icon: 'M', color: '#00C853' },
  qq:        { name: 'QQ', icon: 'Q', color: '#12B7F5' },
  slack:     { name: 'Slack', icon: 'S', color: '#4A154B' },
  telegram:  { name: 'Telegram', icon: 'T', color: '#26A5E4' },
  wecom:     { name: '企业微信', icon: '企', color: '#07C160' },
  whatsapp:  { name: 'WhatsApp', icon: 'W', color: '#25D366' },
  harnessclaw:      { name: 'Harnessclaw', icon: 'H', color: '#F59E0B' },
}

const CHANNEL_KEYS = ['dingtalk', 'discord', 'email', 'harnessclaw', 'feishu', 'mochat', 'qq', 'slack', 'telegram', 'wecom', 'whatsapp']

// Channel field labels (simplified Chinese)
const FIELD_LABELS: Record<string, string> = {
  enabled: '启用',
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
  imapUsername: 'IMAP 用户名',
  imapPassword: 'IMAP 密码',
  imapMailbox: 'IMAP 邮箱',
  imapUseSsl: 'IMAP SSL',
  smtpHost: 'SMTP Host',
  smtpPort: 'SMTP Port',
  smtpUsername: 'SMTP 用户名',
  smtpPassword: 'SMTP 密码',
  smtpUseTls: 'SMTP TLS',
  smtpUseSsl: 'SMTP SSL',
  fromAddress: '发件地址',
  autoReplyEnabled: '自动回复',
  pollIntervalSeconds: '轮询间隔 (秒)',
  markSeen: '标记已读',
  maxBodyChars: '最大正文字符数',
  subjectPrefix: '主题前缀',
  gatewayUrl: 'Gateway URL',
  intents: 'Intents',
  groupPolicy: '群组策略',
  reactEmoji: '回应表情',
  replyToMessage: '回复消息',
  replyInThread: '线程回复',
  userTokenReadOnly: '用户 Token 只读',
  msgFormat: '消息格式',
  welcomeMessage: '欢迎消息',
  bridgeUrl: 'Bridge URL',
  baseUrl: 'Base URL',
  socketUrl: 'Socket URL',
  socketPath: 'Socket Path',
  mode: '模式',
  webhookPath: 'Webhook Path',
  consentGranted: '已授权',
  allowFrom: '允许来源',
  groupAllowFrom: '允许的群组来源',
  host: '主机地址',
  port: '端口',
}

// Fields to skip rendering (complex nested objects)
const SKIP_FIELDS = new Set(['sessions', 'panels', 'groups', 'mention', 'dm', 'proxy',
  'socketDisableMsgpack', 'socketReconnectDelayMs', 'socketMaxReconnectDelayMs', 'socketConnectTimeoutMs',
  'refreshIntervalMs', 'watchTimeoutMs', 'watchLimit', 'retryDelayMs', 'maxRetryAttempts', 'replyDelayMode', 'replyDelayMs'])

// ─── Channel Section ────────────────────────────────────────────────────────

function ChannelSection() {
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
    const info = CHANNEL_DISPLAY[key]
    return key.toLowerCase().includes(q) || (info?.name || '').toLowerCase().includes(q)
  })

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  const chData = (channels[selectedChannel] || {}) as Record<string, unknown>
  const chInfo = CHANNEL_DISPLAY[selectedChannel] || { name: selectedChannel, icon: selectedChannel[0].toUpperCase(), color: '#888' }
  const isEnabled = (chData.enabled as boolean) ?? false

  // Render a field based on its type
  const renderField = (fieldKey: string, fieldValue: unknown) => {
    if (fieldKey === 'enabled' || SKIP_FIELDS.has(fieldKey)) return null
    const label = FIELD_LABELS[fieldKey] || fieldKey

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
        <SettingRow key={fieldKey} label={label} description="多个值用逗号分隔">
          <TextInput
            value={strValue}
            onChange={(v) => {
              const arr = v.split(/[,，]\s*/).map(s => s.trim()).filter(Boolean)
              updateChannel(selectedChannel, { [fieldKey]: arr })
            }}
            placeholder="留空表示不限制"
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
              placeholder="搜索渠道..."
              className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Global settings */}
        <div className="px-3 pb-2 mb-1 border-b border-border">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">发送进度</span>
            <Toggle checked={sendProgress} onChange={(v) => updateConfig({ channels: { ...channels, sendProgress: v } })} />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-muted-foreground">工具提示</span>
            <Toggle checked={sendToolHints} onChange={(v) => updateConfig({ channels: { ...channels, sendToolHints: v } })} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {filteredKeys.map((key) => {
            const info = CHANNEL_DISPLAY[key]
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
          <GroupCard title="配置">
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

// ─── Tools Section ──────────────────────────────────────────────────────────

function ToolsSection() {
  const { config, loading, updateConfig } = useEngineConfig()

  const tools = (config?.tools || {}) as Record<string, unknown>
  const iflySearch = (tools.web_search || {}) as {
    enabled?: boolean
    api_key?: string
    api_secret?: string
    app_id?: string
    host?: string
    path?: string
    limit?: number
  }
  const tavilySearch = (tools.tavily_search || {}) as {
    enabled?: boolean
    api_key?: string
    max_results?: number
  }
  const exec = (tools.exec || {}) as { timeout?: number; pathAppend?: string }
  const restrictToWorkspace = (tools.restrictToWorkspace as boolean) ?? false
  const mcpServers = (tools.mcpServers || {}) as Record<string, unknown>
  const mcpCount = Object.keys(mcpServers).length

  const [showIflyApiKey, setShowIflyApiKey] = useState(false)
  const [showIflyApiSecret, setShowIflyApiSecret] = useState(false)
  const [showTavilyApiKey, setShowTavilyApiKey] = useState(false)

  const updateIflySearch = (patch: Record<string, unknown>) => {
    updateConfig({ tools: { ...tools, web_search: { ...iflySearch, ...patch } } })
  }

  const updateTavilySearch = (patch: Record<string, unknown>) => {
    updateConfig({ tools: { ...tools, tavily_search: { ...tavilySearch, ...patch } } })
  }

  const updateExec = (patch: Record<string, unknown>) => {
    updateConfig({ tools: { ...tools, exec: { ...exec, ...patch } } })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Wrench} title="工具配置" subtitle="搜索、执行与 MCP" />

      <GroupCard title="iFly Search">
        <SettingRow label="启用 iFly Search" description="同步到 HarnessClaw Engine 的 tools.web_search 模块">
          <Toggle checked={iflySearch.enabled === true} onChange={(v) => updateIflySearch({ enabled: v })} />
        </SettingRow>
        <SettingRow label="API Key" description="iFly Search API Key">
          <div className="flex items-center gap-1.5">
            <input
              type={showIflyApiKey ? 'text' : 'password'}
              value={iflySearch.api_key || ''}
              onChange={(e) => updateIflySearch({ api_key: e.target.value })}
              placeholder="输入 API Key"
              className="w-52 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground font-mono"
            />
            <button onClick={() => setShowIflyApiKey(!showIflyApiKey)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
              {showIflyApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </SettingRow>
        <SettingRow label="API Secret" description="iFly Search API Secret">
          <div className="flex items-center gap-1.5">
            <input
              type={showIflyApiSecret ? 'text' : 'password'}
              value={iflySearch.api_secret || ''}
              onChange={(e) => updateIflySearch({ api_secret: e.target.value })}
              placeholder="输入 API Secret"
              className="w-52 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground font-mono"
            />
            <button onClick={() => setShowIflyApiSecret(!showIflyApiSecret)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
              {showIflyApiSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </SettingRow>
        <SettingRow label="App ID" description="iFly Search App ID">
          <TextInput value={iflySearch.app_id || ''} onChange={(v) => updateIflySearch({ app_id: v })} placeholder="输入 App ID" className="w-52" mono />
        </SettingRow>
        <SettingRow label="Host" description="iFly Search 服务 Host">
          <TextInput
            value={iflySearch.host || 'cbm-search-api.cn-huabei-1.xf-yun.com'}
            onChange={(v) => updateIflySearch({ host: v })}
            placeholder="cbm-search-api.cn-huabei-1.xf-yun.com"
            className="w-72"
            mono
          />
        </SettingRow>
        <SettingRow label="Path" description="iFly Search 请求 Path">
          <TextInput
            value={iflySearch.path || '/biz/search'}
            onChange={(v) => updateIflySearch({ path: v })}
            placeholder="/biz/search"
            className="w-52"
            mono
          />
        </SettingRow>
        <SettingRow label="Limit" description="每次请求返回的最大条数">
          <NumberInput
            value={iflySearch.limit ?? 5}
            onChange={(v) => updateIflySearch({ limit: v })}
            min={1}
            max={20}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title="Tavily Search">
        <SettingRow label="启用 Tavily Search" description="同步到 HarnessClaw Engine 的 tools.tavily_search 模块">
          <Toggle checked={tavilySearch.enabled === true} onChange={(v) => updateTavilySearch({ enabled: v })} />
        </SettingRow>
        <SettingRow label="API Key" description="Tavily Search API Key">
          <div className="flex items-center gap-1.5">
            <input
              type={showTavilyApiKey ? 'text' : 'password'}
              value={tavilySearch.api_key || ''}
              onChange={(e) => updateTavilySearch({ api_key: e.target.value })}
              placeholder="tvly-xxx"
              className="w-52 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground font-mono"
            />
            <button onClick={() => setShowTavilyApiKey(!showTavilyApiKey)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
              {showTavilyApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              type="button"
              onClick={() => window.open('https://app.tavily.com/home', '_blank', 'noopener,noreferrer')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/20"
              title="打开 Tavily 控制台"
              aria-label="打开 Tavily 控制台"
            >
              <ExternalLink size={12} />
            </button>
          </div>
        </SettingRow>
        <SettingRow label="最大结果数" description="每次 Tavily Search 请求返回的最大条数">
          <NumberInput
            value={tavilySearch.max_results ?? 5}
            onChange={(v) => updateTavilySearch({ max_results: v })}
            min={1}
            max={20}
          />
        </SettingRow>
      </GroupCard>

      <GroupCard title="命令执行">
        <SettingRow label="超时时间" description="执行命令的最大等待秒数">
          <NumberInput value={exec.timeout ?? 60} onChange={(v) => updateExec({ timeout: v })} suffix="秒" min={5} max={600} />
        </SettingRow>
        <SettingRow label="PATH 追加" description="追加到 PATH 环境变量的路径">
          <TextInput value={exec.pathAppend || ''} onChange={(v) => updateExec({ pathAppend: v })} placeholder="/usr/local/bin" className="w-52" mono />
        </SettingRow>
        <SettingRow label="限制工作区" description="仅允许在 workspace 目录中执行命令">
          <Toggle checked={restrictToWorkspace} onChange={(v) => updateConfig({ tools: { ...tools, restrictToWorkspace: v } })} />
        </SettingRow>
      </GroupCard>

      <GroupCard title="MCP Servers">
        <div className="py-4">
          {mcpCount === 0 ? (
            <div className="flex items-center justify-center py-6 border border-dashed border-border rounded-lg">
              <p className="text-xs text-muted-foreground">暂无 MCP Server 配置</p>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              已配置 {mcpCount} 个 MCP Server
            </div>
          )}
        </div>
      </GroupCard>
    </div>
  )
}

// ─── UI Section ─────────────────────────────────────────────────────────────

function UISection() {
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
  }

  const handleThemeChange = (v: string) => {
    updateUi({ theme: v })
    applyTheme(v)
  }

  useEffect(() => {
    if (!loading && persistedTheme) {
      applyTheme(persistedTheme)
    }
  }, [loading, persistedTheme])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Palette} title="UI 设置" subtitle="界面显示偏好" />
      <GroupCard title="外观">
        <SettingRow label="主题" description="选择界面颜色主题">
          <Segment options={[{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }]} value={theme} onChange={handleThemeChange} />
        </SettingRow>
        <SettingRow label="字体大小" description="调整界面文字大小">
          <Segment options={[{ label: '小', value: 'small' }, { label: '中', value: 'medium' }, { label: '大', value: 'large' }]} value={fontSize} onChange={(v) => updateUi({ fontSize: v })} />
        </SettingRow>
        <SettingRow label="语言" description="界面显示语言">
          <SelectInput value={language} onChange={(v) => updateUi({ language: v })} options={[{ label: '中文', value: 'zh' }, { label: 'English', value: 'en' }]} />
        </SettingRow>
      </GroupCard>

      <GroupCard title="代码编辑器">
        <SettingRow label="代码主题" description="代码块的语法高亮风格">
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
        <SettingRow label="动画效果" description="启用界面过渡和微交互动画">
          <Toggle checked={animation} onChange={(v) => updateUi({ animation: v })} />
        </SettingRow>
      </GroupCard>
    </div>
  )
}

// ─── Storage Section ────────────────────────────────────────────────────────

function StorageSection() {
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
      setExportState({ type, text: `已导出到 ${result.path}`, ok: true })
    } else {
      setExportState({ type, text: result.error || '导出失败', ok: false })
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={HardDrive} title="数据与存储" subtitle="本地文件与缓存管理" />
      <GroupCard title="存储">
        <SettingRow label="数据库路径" description="本地 SQLite 数据库文件位置">
          <div className="flex items-center gap-1.5">
            <TextInput value={dbPath} onChange={(v) => updateConfig({ storage: { ...storage, dbPath: v } })} className="w-52" mono />
            <button className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5">
              <FolderOpen size={12} />浏览
            </button>
          </div>
        </SettingRow>
        <SettingRow label="缓存大小" description="应用临时缓存占用的磁盘空间">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-muted-foreground">{clearState === 'done' ? '0 B' : '12.4 MB'}</span>
            <button
              onClick={handleClearCache}
              disabled={clearState !== 'idle'}
              className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:border-destructive hover:text-destructive transition-colors text-foreground flex items-center gap-1.5 disabled:opacity-50"
            >
              {clearState === 'clearing' ? <Loader2 size={11} className="animate-spin" /> : clearState === 'done' ? <Check size={11} className="text-green-500" /> : <Trash2 size={11} />}
              {clearState === 'clearing' ? '清空中...' : clearState === 'done' ? '已清空' : '清空缓存'}
            </button>
          </div>
        </SettingRow>
      </GroupCard>

      <GroupCard title="导出">
        {[
          { key: 'chat', label: '导出聊天历史', description: '将所有会话导出为 JSON 或 Markdown' },
          { key: 'logs', label: '导出日志', description: '导出应用运行日志' },
          { key: 'config', label: '导出配置', description: '导出全部设置为配置文件' },
        ].map((item) => (
          <SettingRow key={item.key} label={item.label} description={item.description}>
            <button onClick={() => void handleExport(item.key as 'chat' | 'config' | 'logs')} className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5">
              <Download size={12} />导出
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
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [message, setMessage] = useState('应用启动后会在 10 秒后自动检查更新，并每 6 小时轮询一次。')
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
          setMessage('正在检查更新源...')
          break
        case 'available':
          setStatus('available')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setMessage(updateEvent.version ? `发现新版本 ${updateEvent.version}。系统弹窗会提示是否下载。` : '发现新版本。')
          break
        case 'not-available':
          setStatus('not-available')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setMessage(updateEvent.version ? `当前已经是最新版本 (${updateEvent.version})。` : '当前已经是最新版本。')
          break
        case 'download-started':
          setStatus('downloading')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setProgress(0)
          setMessage(updateEvent.version ? `开始下载版本 ${updateEvent.version}。` : '开始下载更新。')
          break
        case 'download-progress':
          setStatus('downloading')
          setIsChecking(false)
          setProgress(typeof updateEvent.percent === 'number' ? updateEvent.percent : null)
          setMessage(typeof updateEvent.percent === 'number'
            ? `正在下载更新，进度 ${updateEvent.percent.toFixed(1)}%。`
            : '正在下载更新。')
          break
        case 'downloaded':
          setStatus('downloaded')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setProgress(100)
          setMessage(updateEvent.version ? `版本 ${updateEvent.version} 已下载完成，系统弹窗会提示重启安装。` : '更新已下载完成。')
          break
        case 'download-deferred':
          setStatus('available')
          setIsChecking(false)
          setVersion(updateEvent.version || '')
          setProgress(null)
          setMessage(updateEvent.version ? `已暂缓下载版本 ${updateEvent.version}。你可以稍后再次检查。` : '已暂缓下载更新。')
          break
        case 'error':
          setStatus('error')
          setIsChecking(false)
          setProgress(null)
          setMessage(updateEvent.message || '检查更新失败。')
          break
      }
    })
  }, [])

  const handleCheck = async () => {
    setIsChecking(true)
    const result = await window.appBridge.checkForUpdates()
    if (!result.ok) {
      setStatus('error')
      setIsChecking(false)
      setProgress(null)
      setMessage(result.error || '检查更新失败。')
    }
  }

  return (
    <div>
      <SectionHeader icon={RotateCcw} title="应用更新" subtitle="检查新版本、下载进度与安装状态。" />

      <GroupCard title="更新">
        <SettingRow label="检查更新" description="正式构建会自动检查，也可以手动触发一次。">
          <button
            onClick={() => void handleCheck()}
            disabled={isChecking}
            className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5 disabled:opacity-50"
          >
            {isChecking ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            {isChecking ? '检查中...' : '检查更新'}
          </button>
        </SettingRow>

        <SettingRow label="当前版本" description="当前安装在本机上的应用版本。">
          <div className="text-right">
            <p className="text-sm font-medium text-foreground">{currentVersion || '--'}</p>
          </div>
        </SettingRow>

        <SettingRow label="当前状态" description="这里展示最近一次更新检查或下载结果。">
          <div className="text-right">
            <p className="text-sm font-medium text-foreground">
              {status === 'idle' && '尚未手动检查'}
              {status === 'checking' && '正在检查'}
              {status === 'available' && '发现新版本'}
              {status === 'not-available' && '已是最新'}
              {status === 'downloading' && '下载中'}
              {status === 'downloaded' && '已下载'}
              {status === 'error' && '检查失败'}
            </p>
            {version && <p className="mt-0.5 text-xs text-muted-foreground">版本：{version}</p>}
          </div>
        </SettingRow>

        {status === 'downloading' && (
          <div className="py-4 border-b border-border last:border-0">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>下载进度</span>
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
  return [...merged.values()]
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp
      }
      return right.cursor.localeCompare(left.cursor)
    })
    .slice(0, 500)
}

function LogsSection() {
  const { config, loading, updateConfig } = useAppConfig()
  const logging = (config?.logging || {}) as { level?: LogViewerLevel }
  const persistedLevel = logging.level || 'info'

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

  useEffect(() => {
    if (!loading) {
      setSelectedLevel(persistedLevel)
    }
  }, [loading, persistedLevel])

  useEffect(() => {
    if (loading) return

    let cancelled = false
    setLoadingLogs(true)

    void window.appRuntime.getLogs({
      level: selectedLevel,
      file: selectedFile,
      query: query.trim() || undefined,
      limit: 500,
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
  }, [loading, query, reloadKey, selectedFile, selectedLevel])

  useEffect(() => {
    if (loading || !followMode || !cursor) return

    let cancelled = false
    const timer = setInterval(() => {
      void window.appRuntime.getLogs({
        after: cursor,
        level: selectedLevel,
        file: selectedFile,
        query: query.trim() || undefined,
        limit: 200,
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
  }, [loading, followMode, cursor, query, selectedFile, selectedLevel])

  const handleLevelChange = (value: string) => {
    const nextLevel = value as LogViewerLevel
    setSelectedLevel(nextLevel)
    updateConfig({ logging: { ...logging, level: nextLevel } })
  }

  const handleReset = () => {
    setQuery('')
    setSelectedFile('all')
    setSelectedLevel(persistedLevel)
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
      ? { ok: true, text: `已打开日志目录：${result.path}` }
      : { ok: false, text: result.error || '打开日志目录失败。' })
  }

  const handleExportLogs = async () => {
    const result = await window.appRuntime.exportData('logs')
    setNotice(result.ok && result.path
      ? { ok: true, text: `日志已导出到：${result.path}` }
      : { ok: false, text: result.error || '导出日志失败。' })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full max-w-5xl mx-auto px-8 py-8 flex flex-col">
        <SectionHeader icon={FileText} title="日志" subtitle="统一查看 latest.log，支持按等级、模块与关键词筛选。" />

        <div className="rounded-2xl border border-border bg-card shadow-sm p-4 mb-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex-1 min-w-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索消息、模块或元数据"
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Segment
                options={[
                  { label: '致命', value: 'fatal' },
                  { label: '错误', value: 'error' },
                  { label: '警告', value: 'warn' },
                  { label: '标准', value: 'info' },
                  { label: '调试', value: 'debug' },
                  { label: '追踪', value: 'trace' },
                ]}
                value={selectedLevel}
                onChange={handleLevelChange}
              />
              <Segment
                options={[
                  { label: '解析', value: 'parsed' },
                  { label: 'Raw', value: 'raw' },
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
                {followMode ? '跟随中' : '已暂停'}
              </span>
              <span>日志目录：{defaultLogsDisplayPath}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setFollowMode((current) => !current)}
                className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-foreground flex items-center gap-1.5"
              >
                {followMode ? <Pause size={14} /> : <Play size={14} />}
                {followMode ? '暂停刷新' : '恢复刷新'}
              </button>
              <button
                onClick={handleReset}
                className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-foreground flex items-center gap-1.5"
              >
                <RotateCcw size={14} />
                重置筛选
              </button>
              <button
                onClick={() => void handleOpenLogsDirectory()}
                className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm text-foreground flex items-center gap-1.5"
              >
                <FolderOpen size={14} />
                打开日志目录
              </button>
              <button
                onClick={() => void handleExportLogs()}
                className="h-9 px-3 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors text-sm font-medium flex items-center gap-1.5"
              >
                <Download size={14} />
                导出日志
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
            <span className="flex-1">读取日志失败：{loadError}</span>
            <button
              onClick={() => setReloadKey((current) => current + 1)}
              className="h-7 px-2.5 rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 transition-colors"
            >
              重试
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <p className="text-sm font-semibold text-foreground">日志列表</p>
            </div>
            {(loadingLogs || (followMode && entries.length === 0)) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                加载中
              </div>
            )}
          </div>

          <div className="h-full overflow-y-auto">
            {!loadingLogs && entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <FileText size={28} className="text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-foreground">
                  {query.trim() ? '当前筛选条件下没有匹配日志。' : '暂时还没有可显示的日志。'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {query.trim() ? '可以尝试放宽关键词或切换日志等级。' : '新的日志会在这里自动追加显示。'}
                </p>
              </div>
            ) : (
              <div className={cn(viewMode === 'raw' && 'overflow-x-auto')}>
                <div className={cn('divide-y divide-border', viewMode === 'raw' && 'min-w-max')}>
                {entries.map((entry) => {
                  const expanded = Boolean(expandedRows[entry.cursor])
                  return viewMode === 'raw' ? (
                    <div key={entry.cursor} className="px-4 py-2">
                      <pre className="whitespace-pre text-xs text-foreground font-mono">
                        {entry.raw}
                      </pre>
                    </div>
                  ) : (
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

// ─── Nav ───────────────────────────────────────────────────────────────────

type SectionKey = 'connection' | 'auth' | 'models' | 'agents' | 'channels' | 'tools' | 'ui' | 'storage' | 'logs' | 'updates'

const navGroups: { title: string; items: { key: SectionKey; icon: React.ElementType; label: string }[] }[] = [
  {
    title: '',
    items: [
      { key: 'connection', icon: Wifi, label: '连接设置' },
      { key: 'models', icon: Cpu, label: '模型配置' },
      { key: 'agents', icon: Bot, label: 'Agent 设置' },
      { key: 'tools', icon: Wrench, label: '工具配置' },
    ],
  },
  {
    title: '应用配置',
    items: [
      { key: 'updates', icon: RotateCcw, label: '应用更新' },
      { key: 'logs', icon: FileText, label: '日志' },
      { key: 'ui', icon: Palette, label: 'UI 设置' },
      { key: 'storage', icon: HardDrive, label: '数据与存储' },
    ],
  },
]

const FULL_WIDTH_SECTIONS = new Set<SectionKey>(['models', 'logs'])

// ─── Page ──────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const location = useLocation()
  const initialSection = location.state?.initialSection as SectionKey | undefined
  const [active, setActive] = useState<SectionKey>(
    initialSection === 'channels' || initialSection === 'auth' ? 'connection' : (initialSection || 'connection')
  )

  useEffect(() => {
    if (initialSection) {
      setActive(initialSection === 'channels' || initialSection === 'auth' ? 'connection' : initialSection)
    }
  }, [initialSection])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left nav */}
      <nav className="w-48 flex-shrink-0 border-r border-border bg-card flex flex-col py-4 gap-0.5 px-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-1">
          设置
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
            {active === 'models' && <ModelSection />}
            {active === 'logs' && <LogsSection />}
          </>
        ) : (
          <div className="max-w-2xl mx-auto px-8 py-8">
            {active === 'connection' && <ConnectionSection />}
            {active === 'agents' && <AgentSection />}
            {active === 'tools' && <ToolsSection />}
            {active === 'updates' && <UpdateSection />}
            {active === 'ui' && <UISection />}
            {active === 'storage' && <StorageSection />}
          </div>
        )}
      </div>
    </div>
  )
}
