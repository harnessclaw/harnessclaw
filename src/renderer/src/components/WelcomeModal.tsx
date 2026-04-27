import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import emmaAvatar from '../assets/sidebar-logo.png'

type EngineMode = 'openai' | 'anthropic'
type ProfileKey = 'A' | 'B' | 'C'
type StartupOverlayState = 'checking' | 'setup' | 'hidden'
type StageKey = 'emma' | 'engine' | 'connection' | 'profile'

interface SetupDraft {
  engineMode: EngineMode | null
  apiBase: string
  apiKey: string
  modelId: string
  profile: ProfileKey | null
}

type ConfigRecord = Record<string, unknown>

const WORKSPACE_ROOT = '~/.harnessclaw/workspace'
const FIRST_RUN_DONE_STORAGE_KEY = 'harnessclaw-first-run-complete'

const engineOptions: Array<{
  key: EngineMode
  title: string
  detail: string
}> = [
  {
    key: 'openai',
    title: 'OpenAI API',
    detail: '接入 OpenAI 官方 API 或兼容其模型命名与网关配置的账户。',
  },
  {
    key: 'anthropic',
    title: 'Anthropic API',
    detail: '接入 Anthropic 官方 API，作为 Claude 系列模型的默认入口。',
  },
]

const profileOptions: Array<{
  key: ProfileKey
  title: string
  detail: string
}> = [
  {
    key: 'A',
    title: '研发与自动化运维',
    detail: '偏长链路执行，默认开启更高工具迭代上限。',
  },
  {
    key: 'B',
    title: '数据采集与研究分析',
    detail: '偏多轮检索和整理，保持中等推理强度。',
  },
  {
    key: 'C',
    title: '复杂日常工作流',
    detail: '偏稳定协作和批量处理，保持简洁默认值。',
  },
]

const stages: Array<{ key: StageKey; title: string; subtitle: string }> = [
  { key: 'emma', title: '认识 Emma', subtitle: '从一个能聊也能干活的 Agent 控制台开始。' },
  { key: 'engine', title: '选择推理引擎', subtitle: '确定首次接入的模型 API 协议。' },
  { key: 'connection', title: '配置连接信息', subtitle: '' },
  { key: 'profile', title: '选择任务画像', subtitle: '' },
]

const emmaPrompts: Array<{ category: string; prompt: string }> = [
  // 研发
  { category: '研发', prompt: '帮我把这段函数重构得更易读，并补充单元测试。' },
  { category: '研发', prompt: '排查这段报错日志，定位最可能的根因并给出修复方案。' },
  { category: '研发', prompt: '审视这个 PR 的设计与边界，列出潜在风险点。' },
  { category: '研发', prompt: '给这个接口加上限流和重试，并写好对应的单测。' },
  // 研究
  { category: '研究', prompt: '搜索最近一周关于 RAG 的新论文，做一份要点摘要。' },
  { category: '研究', prompt: '对比 3 家头部向量数据库的架构与适用场景。' },
  { category: '研究', prompt: '梳理 Agent 评测领域的主流 benchmark 和它们的差异。' },
  { category: '研究', prompt: '帮我跟踪这位作者最近半年发表的所有论文。' },
  // 写作
  { category: '写作', prompt: '为下周产品发布会写一份 300 字的预热推文。' },
  { category: '写作', prompt: '把这份技术文档改写成给非技术同事的版本。' },
  { category: '写作', prompt: '给这个开源项目写一份简洁有力的 README 介绍。' },
  { category: '写作', prompt: '把这次复盘整理成一份对外可发的故事化稿件。' },
  // 数据
  { category: '数据', prompt: '分析这份 CSV 中的订单数据，给出复购率和异常值。' },
  { category: '数据', prompt: '帮我把这份日志拆字段，做出每小时调用量的趋势图。' },
  { category: '数据', prompt: '看一下这份 A/B 实验结果，给出统计显著性结论。' },
  { category: '数据', prompt: '从这堆用户反馈里聚类出 5 个最值得关注的话题。' },
  // 生活
  { category: '生活', prompt: '帮我规划这个周末两天的杭州周边亲子游行程。' },
  { category: '生活', prompt: '根据这周的运动和饮食记录，给我下周的调整建议。' },
  { category: '生活', prompt: '帮我比一下这两个航班加酒店的总性价比。' },
  { category: '生活', prompt: '给我列一份适合一个人安静度过的周末晚上活动清单。' },
  // 日常
  { category: '日常', prompt: '把今天的会议纪要整理成 To-do，并安排到下周日历。' },
  { category: '日常', prompt: '总结今天 Slack 里被 @ 的所有消息，标出需要回复的。' },
  { category: '日常', prompt: '把这一周的工作整理成对外可发的周报草稿。' },
  { category: '日常', prompt: '帮我从邮件里挑出真正需要今天处理的 3 件事。' },
]

function asRecord(value: unknown): ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ConfigRecord)
    : {}
}

function getDefaultApiBase(mode: EngineMode | null): string {
  if (mode === 'anthropic') return 'https://api.anthropic.com'
  return 'https://api.openai.com'
}

function getProviderKey(mode: EngineMode | null): string {
  return mode === 'anthropic' ? 'anthropic' : 'openai'
}

function getProfilePreset(profile: ProfileKey | null): {
  workspace: string
  maxToolIterations: number
  reasoningEffort: 'medium' | 'high'
} {
  if (profile === 'A') {
    return { workspace: `${WORKSPACE_ROOT}/engineering`, maxToolIterations: 60, reasoningEffort: 'high' }
  }
  if (profile === 'B') {
    return { workspace: `${WORKSPACE_ROOT}/research`, maxToolIterations: 36, reasoningEffort: 'medium' }
  }
  return { workspace: `${WORKSPACE_ROOT}/operations`, maxToolIterations: 24, reasoningEffort: 'medium' }
}

function buildEngineConfig(previous: ConfigRecord, draft: SetupDraft): ConfigRecord {
  const { providers: _legacyProviders, ...rest } = previous
  const llm = asRecord(previous.llm)
  const llmProviders = asRecord(llm.providers)
  const providerKey = getProviderKey(draft.engineMode)
  const apiBase = draft.apiBase.trim() || getDefaultApiBase(draft.engineMode)
  const apiKey = draft.apiKey.trim()
  const modelId = draft.modelId.trim()
  const existingLlmProvider = asRecord(llmProviders[providerKey])

  return {
    ...rest,
    llm: {
      ...llm,
      default_provider: providerKey,
      providers: {
        ...llmProviders,
        [providerKey]: {
          ...existingLlmProvider,
          base_url: apiBase,
          api_key: apiKey,
          model: modelId,
        },
      },
    },
  }
}

function buildAppConfig(previous: ConfigRecord, draft: SetupDraft): ConfigRecord {
  const agents = asRecord(previous.agents)
  const defaults = asRecord(agents.defaults)
  const onboarding = asRecord(previous.onboarding)
  const modelProviders = asRecord(previous.modelProviders)
  const profilePreset = getProfilePreset(draft.profile)
  const providerKey = getProviderKey(draft.engineMode)
  const modelId = draft.modelId.trim()
  const defaultModel = modelId ? `${providerKey}/${modelId}` : defaults.model
  const apiBase = draft.apiBase.trim() || getDefaultApiBase(draft.engineMode)
  const apiKey = draft.apiKey.trim()

  return {
    ...previous,
    modelProviders: {
      ...modelProviders,
      defaultSelection: providerKey,
      [providerKey]: {
        apiKey,
        apiBase,
        model: modelId,
        protocol: providerKey,
        extraHeaders: null,
      },
    },
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        provider: providerKey,
        workspace: profilePreset.workspace,
        maxToolIterations: profilePreset.maxToolIterations,
        reasoningEffort: profilePreset.reasoningEffort,
        model: defaultModel,
      },
    },
    onboarding: {
      ...onboarding,
      version: 1,
      completedAt: new Date().toISOString(),
      engineMode: draft.engineMode,
      profile: draft.profile,
    },
  }
}

export function WelcomeModal() {
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
    profile: null,
  })
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [username] = useState<string>(() => {
    try {
      return window.appBridge?.getUsername?.() || ''
    } catch {
      return ''
    }
  })

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
    emma: true,
    engine: Boolean(draft.engineMode),
    connection: Boolean(draft.apiKey.trim() && draft.modelId.trim()),
    profile: Boolean(draft.profile),
  }), [draft])

  const allStagesDone = stageDone.engine && stageDone.connection && stageDone.profile
  const currentStage = stages[stageIndex]
  const currentStageDone = stageDone[currentStage.key]
  const isLastStage = stageIndex === stages.length - 1

  const goToStage = (index: number) => {
    if (index < 0 || index >= stages.length) return
    // Allow jumping to a stage if all earlier stages are done
    for (let i = 0; i < index; i++) {
      if (!stageDone[stages[i].key]) return
    }
    setErrorMessage(null)
    setStageIndex(index)
  }

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
    if (!allStagesDone || submitting) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const finalDraft: SetupDraft = {
        ...draft,
        apiBase: draft.apiBase.trim() || getDefaultApiBase(draft.engineMode),
        apiKey: draft.apiKey.trim(),
        modelId: draft.modelId.trim(),
      }
      const currentEngineConfig = asRecord(await window.engineConfig.read())
      const currentAppConfig = asRecord(await window.appConfig.read())
      const engineResult = await window.engineConfig.save(buildEngineConfig(currentEngineConfig, finalDraft))
      const appResult = await window.appConfig.save(buildAppConfig(currentAppConfig, finalDraft))
      if (!engineResult.ok || !appResult.ok) {
        throw new Error(engineResult.error || appResult.error || '保存配置失败')
      }
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
      <div className="relative flex h-[540px] max-h-[calc(100vh-3rem)] w-[874px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/70 px-7 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Sparkles size={16} />
            </div>
            <h2 id="first-run-title" className="text-base font-semibold leading-tight text-foreground">
              {username ? `${username}，` : ''}很高兴认识你
            </h2>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {stageIndex + 1} / {stages.length}
          </span>
        </header>

        <Stepper stages={stages} stageIndex={stageIndex} stageDone={stageDone} onJump={goToStage} />

        <div className="min-h-0 flex-1 overflow-hidden px-7 py-6">
          <div className="mx-auto w-full max-w-[540px]">
          {currentStage.key !== 'emma' && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-foreground">{currentStage.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{currentStage.subtitle}</p>
            </div>
          )}

          {currentStage.key === 'emma' && (
            <div className="flex flex-col items-center text-center">
              <img
                src={emmaAvatar}
                alt="Emma"
                className="h-16 w-16 rounded-2xl object-cover shadow-sm"
              />
              <h3 className="mt-5 text-[2.6rem] font-semibold leading-none tracking-tight text-foreground">
                emma
              </h3>

              <TypedQuotes prompts={emmaPrompts} />
            </div>
          )}

          {currentStage.key === 'engine' && (
            <div className="grid gap-2.5">
              {engineOptions.map((option) => {
                const selected = draft.engineMode === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, engineMode: option.key }))}
                    className={cn(
                      'group flex items-start justify-between gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors',
                      selected
                        ? 'border-primary/60 bg-primary/8 ring-1 ring-primary/30'
                        : 'border-border bg-background hover:border-border/80 hover:bg-muted/40'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{option.title}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.detail}</div>
                    </div>
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'
                      )}
                      aria-hidden="true"
                    >
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {currentStage.key === 'connection' && (
            <div className="grid gap-3.5">
              <FormField
                label="API Base URL"
                value={draft.apiBase}
                placeholder={getDefaultApiBase(draft.engineMode)}
                onChange={(v) => setDraft((d) => ({ ...d, apiBase: v }))}
              />
              <FormField
                label="API Key"
                value={draft.apiKey}
                placeholder="sk-..."
                type="password"
                required
                onChange={(v) => setDraft((d) => ({ ...d, apiKey: v }))}
              />
              <FormField
                label="Model ID"
                hint="例如 gpt-4o-mini、claude-sonnet-4 等。"
                value={draft.modelId}
                placeholder="model-id"
                required
                onChange={(v) => setDraft((d) => ({ ...d, modelId: v }))}
              />
            </div>
          )}

          {currentStage.key === 'profile' && (
            <div className="grid grid-cols-3 gap-3">
              {profileOptions.map((option) => {
                const selected = draft.profile === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, profile: option.key }))}
                    className={cn(
                      'group relative flex h-full flex-col items-start gap-2 rounded-2xl border px-4 py-4 text-left transition-all',
                      selected
                        ? 'border-primary/70 bg-primary/8 shadow-sm ring-1 ring-primary/30'
                        : 'border-border bg-background hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30 hover:shadow-sm'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background opacity-0 group-hover:opacity-100'
                      )}
                      aria-hidden="true"
                    >
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                        selected
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-border bg-muted/60 text-muted-foreground'
                      )}
                    >
                      {option.key}
                    </span>
                    <div className="mt-1 text-sm font-semibold leading-tight text-foreground">
                      {option.title}
                    </div>
                    <div className="text-[11px] leading-5 text-muted-foreground">
                      {option.detail}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {errorMessage}
            </div>
          )}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border/70 bg-muted/20 px-7 py-4">
          {stageIndex === 0 ? (
            <span aria-hidden="true" />
          ) : (
            <button
              type="button"
              onClick={handleBack}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              上一步
            </button>
          )}

          {isLastStage ? (
            <button
              type="button"
              onClick={handleFinish}
              disabled={!allStagesDone || submitting}
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[13px] font-medium tracking-wide text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Emma 正在为你点灯…</span>
                </>
              ) : (
                <>
                  <span>去见 Emma</span>
                  <ArrowRight
                    size={14}
                    className="transition-transform duration-300 group-hover:translate-x-0.5 group-disabled:translate-x-0"
                  />
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={!currentStageDone}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一步
              <ArrowRight size={14} />
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Stepper({
  stages,
  stageIndex,
  stageDone,
  onJump,
}: {
  stages: Array<{ key: StageKey; title: string; subtitle: string }>
  stageIndex: number
  stageDone: Record<StageKey, boolean>
  onJump: (index: number) => void
}) {
  // Count consecutive completed stages from the left to determine progress line width.
  let consecutiveDone = 0
  for (let i = 0; i < stages.length; i++) {
    if (stageDone[stages[i].key]) consecutiveDone += 1
    else break
  }
  const progressFraction = stages.length > 1
    ? Math.min(1, Math.max(0, (consecutiveDone - 1) / (stages.length - 1)))
    : 0

  return (
    <div className="px-7 pb-3 pt-4">
      <div className="relative mx-auto w-full max-w-[540px]">
        {/* background line */}
        <div className="absolute left-[14px] right-[14px] top-[13px] h-px bg-border" aria-hidden="true" />
        {/* progress line */}
        <div
          className="absolute left-[14px] top-[13px] h-px bg-primary/60 transition-[width] duration-300"
          style={{ width: `calc((100% - 28px) * ${progressFraction})` }}
          aria-hidden="true"
        />

        <div className="relative flex justify-between">
          {stages.map((stage, index) => {
            const active = index === stageIndex
            const done = stageDone[stage.key]
            const reachable = index === 0 || stages.slice(0, index).every((s) => stageDone[s.key])
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => onJump(index)}
                disabled={!reachable}
                className={cn(
                  'flex flex-col items-center gap-2',
                  reachable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                )}
                aria-label={stage.title}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors',
                    done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : active
                        ? 'border-primary bg-card text-primary'
                        : 'border-border bg-card text-muted-foreground',
                    reachable && !active && !done && 'hover:border-primary/60'
                  )}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : index + 1}
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-[11px] font-medium leading-4',
                    active ? 'text-foreground' : done ? 'text-foreground/75' : 'text-muted-foreground'
                  )}
                >
                  {stage.title}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TypedQuotes({ prompts }: { prompts: Array<{ category: string; prompt: string }> }) {
  // Shuffle once on mount so each session sees a different ordering, then loop.
  const shuffled = useMemo(() => {
    const arr = prompts.slice()
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
    return arr
  }, [prompts])

  const [index, setIndex] = useState(0)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'typing' | 'holding' | 'erasing'>('typing')
  const timerRef = useRef<number | null>(null)

  const current = shuffled[index] ?? shuffled[0]

  useEffect(() => {
    const full = current.prompt
    if (timerRef.current) window.clearTimeout(timerRef.current)

    if (phase === 'typing') {
      if (text.length < full.length) {
        timerRef.current = window.setTimeout(() => setText(full.slice(0, text.length + 1)), 42)
      } else {
        timerRef.current = window.setTimeout(() => setPhase('holding'), 1400)
      }
    } else if (phase === 'holding') {
      timerRef.current = window.setTimeout(() => setPhase('erasing'), 900)
    } else {
      if (text.length > 0) {
        timerRef.current = window.setTimeout(() => setText(full.slice(0, text.length - 1)), 22)
      } else {
        timerRef.current = window.setTimeout(() => {
          setIndex((i) => (i + 1) % shuffled.length)
          setPhase('typing')
        }, 220)
      }
    }

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [text, phase, current.prompt, shuffled.length])

  return (
    <div className="mt-8 w-full">
      <div className="mx-auto min-h-[120px] max-w-[520px] rounded-2xl border border-border bg-background/60 px-5 py-5 text-left">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {current.category}
        </div>
        <div className="text-[15px] leading-7 text-foreground/90">
          <span className="text-muted-foreground/60">“</span>
          <span>{text}</span>
          <span
            className="ml-[2px] inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-foreground/70"
            aria-hidden="true"
          />
          {text === current.prompt && phase !== 'erasing' && (
            <span className="text-muted-foreground/60">”</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-center text-[10px] tabular-nums text-muted-foreground/70">
        {index + 1} / {shuffled.length}
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
        className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      {hint && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </label>
  )
}


