import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Wifi, Shield, Palette, HardDrive,
  Eye, EyeOff, Loader2, Check, X,
  FolderOpen, Download, Trash2,
  Search, Plus, Settings2, Cpu,
  Bot, Radio, Wrench
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppConfig, useNanobotConfig } from '@/hooks/useNanobotConfig'

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
      <div className="flex-shrink-0">{children}</div>
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
  const { config, loading, updateConfig } = useNanobotConfig()

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

// ─── ClawHub Section ───────────────────────────────────────────────────────

function ClawHubSection() {
  const { config, loading, updateConfig } = useAppConfig()
  const clawhub = (config?.clawhub || {}) as { token?: string }
  const token = clawhub.token ?? ''

  const [showToken, setShowToken] = useState(false)
  const [binaryStatus, setBinaryStatus] = useState<{ installed: boolean; path: string } | null>(null)
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'ok' | 'fail'>('idle')
  const [verifyState, setVerifyState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [feedback, setFeedback] = useState('')

  const refreshStatus = useCallback(async () => {
    const status = await window.clawhub.getStatus()
    setBinaryStatus(status)
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const updateClawhub = (patch: Record<string, unknown>) => {
    updateConfig({ clawhub: { ...clawhub, ...patch } })
  }

  const handleInstall = async () => {
    setInstallState('installing')
    setFeedback('')
    const res = await window.clawhub.install()
    await refreshStatus()
    if (res.ok) {
      setInstallState('ok')
      setFeedback(`已更新命令: ${res.path}`)
    } else {
      setInstallState('fail')
      setFeedback(res.error || '安装失败')
    }
  }

  const handleVerify = async () => {
    if (!token.trim()) {
      setVerifyState('fail')
      setFeedback('请先输入 Token')
      return
    }
    setVerifyState('testing')
    setFeedback('')
    const res = await window.clawhub.verifyToken(token)
    if (res.ok) {
      setVerifyState('ok')
      setFeedback('')
    } else {
      setVerifyState('fail')
      setFeedback((res.stderr || res.stdout || 'Token 验证失败').trim())
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div>
      <SectionHeader icon={Wrench} title="ClawHub" subtitle="CLI 安装与 Token 验证" />

      <GroupCard title="CLI">
        <SettingRow label="命令路径" description="ClawHub 命令安装在 ~/.harnessclaw/bin/clawhub">
          <TextInput value={binaryStatus?.path || '~/.harnessclaw/bin/clawhub'} onChange={() => undefined} className="w-64" mono disabled />
        </SettingRow>
        <SettingRow label="安装状态" description="点击下载/更新会写入启动脚本，并在运行时调用最新 clawhub">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-xs font-medium px-2 py-1 rounded-full',
              binaryStatus?.installed ? 'text-green-700 bg-green-100' : 'text-yellow-700 bg-yellow-100'
            )}>
              {binaryStatus?.installed ? '已安装' : '未安装'}
            </span>
            <button
              onClick={handleInstall}
              disabled={installState === 'installing'}
              className="h-8 px-3 text-sm font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5 disabled:opacity-60"
            >
              {installState === 'installing' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {installState === 'installing' ? '下载中' : '下载/更新'}
            </button>
          </div>
        </SettingRow>
      </GroupCard>

      <GroupCard title="Token">
        <SettingRow label="访问 Token" description="输入并验证 ClawHub Token">
          <div className="flex items-center gap-1.5">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => updateClawhub({ token: e.target.value })}
              placeholder="输入 ClawHub Token"
              className="w-64 h-8 px-3 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground font-mono"
            />
            <button onClick={() => setShowToken(!showToken)} className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={handleVerify}
              disabled={verifyState === 'testing'}
              className={cn(
                'h-8 px-3 text-sm font-medium rounded-md border transition-colors flex items-center gap-1.5',
                verifyState === 'ok' ? 'border-status-connected text-status-connected'
                  : verifyState === 'fail' ? 'border-status-disconnected text-status-disconnected'
                    : 'border-border bg-card hover:bg-muted text-foreground'
              )}
            >
              {verifyState === 'testing' && <Loader2 size={12} className="animate-spin" />}
              {verifyState === 'ok' && <Check size={12} />}
              {verifyState === 'fail' && <X size={12} />}
              {verifyState === 'testing' ? '验证中' : verifyState === 'ok' ? '验证成功' : verifyState === 'fail' ? '验证失败' : '验证'}
            </button>
          </div>
        </SettingRow>
        {feedback && (
          <div className={cn(
            'mt-3 rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap',
            verifyState === 'fail' || installState === 'fail'
              ? 'border-red-200 bg-red-50 text-red-600'
              : 'border-border bg-card text-muted-foreground'
          )}>
            {feedback}
          </div>
        )}
      </GroupCard>
    </div>
  )
}

// ─── Agent Section ──────────────────────────────────────────────────────────

function AgentSection() {
  const { config, loading, updateConfig } = useNanobotConfig()

  const agents = (config?.agents || {}) as { defaults?: Record<string, unknown> }
  const defaults = agents.defaults || {}
  const workspace = (defaults.workspace as string) ?? '~/.nanobot/workspace'
  const model = (defaults.model as string) ?? ''
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
        <SettingRow label="默认模型" description="格式: provider/model-name">
          <TextInput value={model} onChange={(v) => updateDefaults({ model: v })} placeholder="anthropic/claude-opus-4-5" className="w-60" mono />
        </SettingRow>
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
  extraHeaders: Record<string, string> | null
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  custom: 'Custom',
  azureOpenai: 'Azure OpenAI',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  zhipu: '智谱',
  dashscope: '通义千问',
  vllm: 'vLLM',
  ollama: 'Ollama',
  gemini: 'Google Gemini',
  moonshot: '月之暗面',
  minimax: 'MiniMax',
  aihubmix: 'AIHubMix',
  siliconflow: '硅基流动',
  volcengine: '火山引擎',
  volcengineCodingPlan: '火山 Coding',
  byteplus: 'BytePlus',
  byteplusCodingPlan: 'BytePlus Coding',
  openaiCodex: 'OpenAI Codex',
  githubCopilot: 'GitHub Copilot',
}

const PROVIDER_DEFAULT_BASES: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  deepseek: 'https://api.deepseek.com',
  groq: 'https://api.groq.com/openai',
  zhipu: 'https://open.bigmodel.cn/api/paas',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode',
  ollama: 'http://localhost:11434',
  gemini: 'https://generativelanguage.googleapis.com',
  moonshot: 'https://api.moonshot.cn',
  minimax: 'https://api.minimax.chat',
  siliconflow: 'https://api.siliconflow.cn',
  openrouter: 'https://openrouter.ai/api',
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
  const name = PROVIDER_DISPLAY_NAMES[key] || key
  return name.charAt(0).toUpperCase()
}

function getDisplayName(key: string): string {
  return PROVIDER_DISPLAY_NAMES[key] || key
}

// ─── Model Section ──────────────────────────────────────────────────────────

function ModelSection() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({})
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await window.nanobotConfig.read()
        setConfig(data)
        const p = (data.providers || {}) as Record<string, ProviderConfig>
        setProviders(p)
        const keys = Object.keys(p)
        const enabledKey = keys.find((k) => p[k].apiKey)
        setSelectedProvider(enabledKey || keys[0] || null)
      } catch {
        setProviders({})
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const debouncedSave = useCallback(
    (updatedProviders: Record<string, ProviderConfig>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        if (!config) return
        await window.nanobotConfig.save({ ...config, providers: updatedProviders })
      }, 500)
    },
    [config]
  )

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  const updateProvider = (key: string, patch: Partial<ProviderConfig>) => {
    setProviders((prev) => {
      const updated = { ...prev, [key]: { ...prev[key], ...patch } }
      debouncedSave(updated)
      return updated
    })
  }

  const handleTest = async () => {
    setTestState('testing')
    await new Promise((r) => setTimeout(r, 1200))
    if (selectedProvider && providers[selectedProvider]?.apiKey) {
      setTestState('ok')
    } else {
      setTestState('fail')
    }
    setTimeout(() => setTestState('idle'), 2500)
  }

  const providerKeys = Object.keys(providers).filter((key) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return key.toLowerCase().includes(q) || getDisplayName(key).toLowerCase().includes(q)
  })

  const selected = selectedProvider ? providers[selectedProvider] : null
  const selectedBase = selected?.apiBase || (selectedProvider ? PROVIDER_DEFAULT_BASES[selectedProvider] : '') || ''
  const previewUrl = selectedBase ? `${selectedBase}/v1/chat/completions` : ''

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
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
            const p = providers[key]
            const isActive = key === selectedProvider
            const isEnabled = !!p.apiKey
            return (
              <button
                key={key}
                onClick={() => { setSelectedProvider(key); setShowApiKey(false); setTestState('idle') }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors mb-0.5',
                  isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                )}
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold" style={{ backgroundColor: getProviderColor(key) }}>
                  {getProviderInitial(key)}
                </div>
                <span className="flex-1 text-sm font-medium truncate">{getDisplayName(key)}</span>
                {isEnabled && (
                  <span className="text-[10px] font-semibold text-status-connected bg-status-connected/15 px-1.5 py-0.5 rounded-full flex-shrink-0">ON</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="p-2.5 border-t border-border">
          <button className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Plus size={14} />添加
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedProvider && selected ? (
          <div className="px-8 py-6 max-w-2xl">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold text-foreground">{getDisplayName(selectedProvider)}</h2>
                <Settings2 size={14} className="text-muted-foreground" />
              </div>
              <Toggle checked={!!selected.apiKey} onChange={(v) => { if (!v) updateProvider(selectedProvider, { apiKey: '' }) }} />
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground mb-2">API 密钥</h3>
              <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={selected.apiKey}
                    onChange={(e) => updateProvider(selectedProvider, { apiKey: e.target.value })}
                    placeholder="输入 API 密钥"
                    className="flex-1 h-8 px-3 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground font-mono"
                  />
                  <button onClick={() => setShowApiKey(!showApiKey)} className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={handleTest}
                    disabled={testState === 'testing'}
                    className={cn(
                      'h-8 px-3 text-sm font-medium rounded-md border transition-colors flex items-center gap-1.5 flex-shrink-0',
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
                <p className="text-xs text-muted-foreground mt-2">多个密钥使用逗号分隔</p>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground mb-2">API 地址</h3>
              <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
                <input
                  type="text"
                  value={selected.apiBase || ''}
                  onChange={(e) => updateProvider(selectedProvider, { apiBase: e.target.value || null })}
                  placeholder={PROVIDER_DEFAULT_BASES[selectedProvider] || 'https://api.example.com'}
                  className="w-full h-8 px-3 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground font-mono"
                />
                {previewUrl && <p className="text-xs text-muted-foreground mt-2 font-mono truncate">预览：{previewUrl}</p>}
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-foreground mb-2">模型</h3>
              <div className="bg-card border border-border rounded-xl px-4 py-4 shadow-sm">
                <div className="flex items-center justify-center py-6 border border-dashed border-border rounded-lg">
                  <p className="text-xs text-muted-foreground">模型列表将自动从 API 地址获取</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">选择一个模型平台查看配置</p>
          </div>
        )}
      </div>
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
  const { config, loading, updateConfig } = useNanobotConfig()

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
  const { config, loading, updateConfig } = useNanobotConfig()

  const tools = (config?.tools || {}) as Record<string, unknown>
  const web = (tools.web || {}) as { proxy?: string | null; search?: Record<string, unknown> }
  const webSearch = (web.search || {}) as { provider?: string; apiKey?: string; baseUrl?: string; maxResults?: number }
  const exec = (tools.exec || {}) as { timeout?: number; pathAppend?: string }
  const restrictToWorkspace = (tools.restrictToWorkspace as boolean) ?? false
  const mcpServers = (tools.mcpServers || {}) as Record<string, unknown>
  const mcpCount = Object.keys(mcpServers).length

  const [showSearchKey, setShowSearchKey] = useState(false)

  const updateWeb = (searchPatch: Record<string, unknown>) => {
    updateConfig({ tools: { ...tools, web: { ...web, search: { ...webSearch, ...searchPatch } } } })
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

      <GroupCard title="Web 搜索">
        <SettingRow label="搜索引擎" description="用于 web.search 工具的提供商">
          <SelectInput
            value={webSearch.provider || 'brave'}
            onChange={(v) => updateWeb({ provider: v })}
            options={[
              { label: 'Brave', value: 'brave' },
              { label: 'Google', value: 'google' },
              { label: 'Bing', value: 'bing' },
              { label: 'DuckDuckGo', value: 'duckduckgo' },
            ]}
          />
        </SettingRow>
        <SettingRow label="搜索 API Key" description="搜索引擎的 API 密钥">
          <div className="flex items-center gap-1.5">
            <input
              type={showSearchKey ? 'text' : 'password'}
              value={webSearch.apiKey || ''}
              onChange={(e) => updateWeb({ apiKey: e.target.value })}
              placeholder="输入 API Key"
              className="w-44 h-7 px-2.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground font-mono"
            />
            <button onClick={() => setShowSearchKey(!showSearchKey)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
              {showSearchKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Base URL" description="自定义搜索服务地址 (可选)">
          <TextInput value={webSearch.baseUrl || ''} onChange={(v) => updateWeb({ baseUrl: v })} placeholder="留空使用默认" className="w-52" mono />
        </SettingRow>
        <SettingRow label="最大结果数" description="每次搜索返回的最大条数">
          <NumberInput value={webSearch.maxResults ?? 5} onChange={(v) => updateWeb({ maxResults: v })} min={1} max={20} />
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
  const theme = ui.theme || 'light'
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
    } else if (v === 'light') {
      document.documentElement.classList.remove('dark')
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', prefersDark)
    }
  }

  const handleThemeChange = (v: string) => {
    updateUi({ theme: v })
    applyTheme(v)
  }

  useEffect(() => {
    applyTheme(theme)
  }, [])

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
  const dbPath = storage.dbPath || '~/.clawdbot/data/local.db'
  const [clearState, setClearState] = useState<'idle' | 'clearing' | 'done'>('idle')
  const exportRef = useRef<HTMLAnchorElement>(null)

  const handleClearCache = async () => {
    setClearState('clearing')
    await new Promise((r) => setTimeout(r, 800))
    setClearState('done')
    setTimeout(() => setClearState('idle'), 2000)
  }

  const handleExport = (type: string) => {
    console.log(`[Export] ${type}`)
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
            <button onClick={() => handleExport(item.key)} className="h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors text-foreground flex items-center gap-1.5">
              <Download size={12} />导出
            </button>
          </SettingRow>
        ))}
      </GroupCard>

      <a ref={exportRef} className="hidden" />
    </div>
  )
}

// ─── Nav ───────────────────────────────────────────────────────────────────

type SectionKey = 'connection' | 'auth' | 'clawhub' | 'models' | 'agents' | 'channels' | 'tools' | 'ui' | 'storage'

const navGroups: { title: string; items: { key: SectionKey; icon: React.ElementType; label: string }[] }[] = [
  {
    title: 'Nanobot 配置',
    items: [
      { key: 'connection', icon: Wifi, label: '连接设置' },
      { key: 'models', icon: Cpu, label: '模型配置' },
      { key: 'agents', icon: Bot, label: 'Agent 设置' },
      { key: 'channels', icon: Radio, label: '渠道配置' },
      { key: 'tools', icon: Wrench, label: '工具配置' },
    ],
  },
  {
    title: '应用配置',
    items: [
      { key: 'auth', icon: Shield, label: '认证设置' },
      { key: 'clawhub', icon: Wrench, label: 'ClawHub' },
      { key: 'ui', icon: Palette, label: 'UI 设置' },
      { key: 'storage', icon: HardDrive, label: '数据与存储' },
    ],
  },
]

const FULL_WIDTH_SECTIONS = new Set<SectionKey>(['models', 'channels'])

// ─── Page ──────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const location = useLocation()
  const initialSection = location.state?.initialSection as SectionKey | undefined
  const [active, setActive] = useState<SectionKey>(initialSection || 'connection')

  useEffect(() => {
    if (initialSection) {
      setActive(initialSection)
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
            <div className="px-2.5 mb-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{group.title}</p>
            </div>
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
            {active === 'channels' && <ChannelSection />}
          </>
        ) : (
          <div className="max-w-2xl mx-auto px-8 py-8">
            {active === 'connection' && <ConnectionSection />}
            {active === 'auth' && <AuthSection />}
            {active === 'clawhub' && <ClawHubSection />}
            {active === 'agents' && <AgentSection />}
            {active === 'tools' && <ToolsSection />}
            {active === 'ui' && <UISection />}
            {active === 'storage' && <StorageSection />}
          </div>
        )}
      </div>
    </div>
  )
}
