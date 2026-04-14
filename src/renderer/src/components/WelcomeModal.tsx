import { useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import { ArrowRight, CheckCircle2, ChevronRight, Cpu, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

type SetupPhase =
  | 'booting'
  | 'welcome'
  | 'engine_check'
  | 'engine_select'
  | 'engine_url'
  | 'engine_key'
  | 'engine_model'
  | 'engine_verify'
  | 'profile_selection'
  | 'ready'

type EngineMode = 'openai' | 'anthropic'
type ProfileKey = 'A' | 'B' | 'C'
type StartupOverlayState = 'checking' | 'setup' | 'closing' | 'hidden'

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
    return {
      workspace: `${WORKSPACE_ROOT}/engineering`,
      maxToolIterations: 60,
      reasoningEffort: 'high',
    }
  }

  if (profile === 'B') {
    return {
      workspace: `${WORKSPACE_ROOT}/research`,
      maxToolIterations: 36,
      reasoningEffort: 'medium',
    }
  }

  return {
    workspace: `${WORKSPACE_ROOT}/operations`,
    maxToolIterations: 24,
    reasoningEffort: 'medium',
  }
}

function buildEngineConfig(previous: ConfigRecord, draft: SetupDraft): ConfigRecord {
  const llm = asRecord(previous.llm)
  const llmProviders = asRecord(llm.providers)
  const rootProviders = asRecord(previous.providers)
  const providerKey = getProviderKey(draft.engineMode)
  const apiBase = draft.apiBase.trim() || getDefaultApiBase(draft.engineMode)
  const apiKey = draft.apiKey.trim()
  const modelId = draft.modelId.trim()

  const existingRootProvider = asRecord(rootProviders[providerKey])
  const existingLlmProvider = asRecord(llmProviders[providerKey])

  return {
    ...previous,
    providers: {
      ...rootProviders,
      [providerKey]: {
        ...existingRootProvider,
        enabled: true,
        apiKey,
        apiBase,
        model: modelId,
        api_key: apiKey,
        base_url: apiBase,
      },
    },
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
  const profilePreset = getProfilePreset(draft.profile)
  const providerKey = getProviderKey(draft.engineMode)
  const modelId = draft.modelId.trim()
  const defaultModel = modelId ? `${providerKey}/${modelId}` : defaults.model

  return {
    ...previous,
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        provider: getProviderKey(draft.engineMode),
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
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<SetupPhase>('booting')
  const [history, setHistory] = useState<ReactNode[]>([])
  const [inputValue, setInputValue] = useState('')
  const [welcomeReady, setWelcomeReady] = useState(false)
  const [engineSelectReady, setEngineSelectReady] = useState(false)
  const [selectedEngineIndex, setSelectedEngineIndex] = useState(0)
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(0)
  const [draft, setDraft] = useState<SetupDraft>({
    engineMode: null,
    apiBase: '',
    apiKey: '',
    modelId: '',
    profile: null,
  })
  const bootRun = useRef(false)
  const phaseRunRef = useRef<Partial<Record<SetupPhase, boolean>>>({})
  const activeInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    const runStartupGate = async () => {
      const isCachedDone = window.localStorage.getItem(FIRST_RUN_DONE_STORAGE_KEY) === 'true'
      if (!isCachedDone) {
        await sleep(1680)
      }

      const isFirst = await window.appBridge.isFirstLaunch()
      if (cancelled) return

      if (isFirst) {
        window.localStorage.removeItem(FIRST_RUN_DONE_STORAGE_KEY)
        setVisible(true)
        setOverlayState('setup')
        return
      }

      window.localStorage.setItem(FIRST_RUN_DONE_STORAGE_KEY, 'true')
      if (overlayState === 'hidden') {
        return
      }

      setOverlayState('closing')
      window.setTimeout(() => {
        if (!cancelled) {
          setOverlayState('hidden')
        }
      }, 260)
    }

    void runStartupGate()

    return () => {
      cancelled = true
    }
  }, [overlayState])

  useEffect(() => {
    if (!visible || bootRun.current) return
    bootRun.current = true

    const runBootSequence = async () => {
      await sleep(550)
      addHistoryLine(setHistory, <TypewriterLine text="[BOOT] HarnessClaw Runtime warm-up sequence" />)
      await sleep(650)
      addHistoryLine(setHistory, <TypewriterLine text="[BOOT] Local policy, storage, and workspace guards online" />)
      await sleep(540)
      addHistoryLine(setHistory, <TypewriterLine text="[BOOT] Operator console ready" className="text-[rgba(186,255,176,0.92)]" />)
      await sleep(420)
      setPhase('welcome')
    }

    void runBootSequence()
  }, [visible])

  useEffect(() => {
    if (!visible || phase !== 'welcome') return
    if (phaseRunRef.current.welcome) return
    phaseRunRef.current.welcome = true
    setWelcomeReady(false)

    const runWelcome = async () => {
      const firstLine = '欢迎接入 HarnessClaw。这里不是聊天框，而是一套可观察、可约束、可持续运行的 Agent 控制台。'
      const secondLine = '首次启动需要完成一轮基础装配：接入推理引擎、选择工作画像，并确认工具生态是否挂载。'

      addHistoryLine(setHistory, <TypewriterLine text={firstLine} />)
      await sleep(getTypewriterDuration(firstLine) + 220)
      addHistoryLine(setHistory, <TypewriterLine text={secondLine} />)
      await sleep(getTypewriterDuration(secondLine) + 180)
      setWelcomeReady(true)
    }

    void runWelcome()
  }, [phase, visible])

  useEffect(() => {
    if (!visible) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, phase, visible])

  useEffect(() => {
    if (!visible) return
    if (phase === 'engine_url' || phase === 'engine_key' || phase === 'engine_model') {
      window.setTimeout(() => activeInputRef.current?.focus(), 40)
    }
  }, [phase, visible])

  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (phase === 'welcome' && event.key === 'Enter') {
        event.preventDefault()
        void handleWelcomeEnter()
        return
      }

      if (phase === 'engine_select') {
        if (!engineSelectReady) return

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedEngineIndex((current) => Math.max(0, current - 1))
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedEngineIndex((current) => Math.min(engineOptions.length - 1, current + 1))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          void handleEngineSelect(engineOptions[selectedEngineIndex].key)
        }
        return
      }

      if (phase === 'engine_url' && event.key === 'Enter') {
        event.preventDefault()
        void handleEngineUrlSubmit()
        return
      }

      if (phase === 'engine_url' && event.key === 'Escape') {
        event.preventDefault()
        handleEngineUrlBack()
        return
      }

      if (phase === 'engine_key' && event.key === 'Enter') {
        event.preventDefault()
        void handleEngineKeySubmit()
        return
      }

      if (phase === 'engine_key' && event.key === 'Escape') {
        event.preventDefault()
        handleEngineKeyBack()
        return
      }

      if (phase === 'engine_model' && event.key === 'Enter') {
        event.preventDefault()
        void handleEngineModelSubmit()
        return
      }

      if (phase === 'engine_model' && event.key === 'Escape') {
        event.preventDefault()
        handleEngineModelBack()
        return
      }

      if (phase === 'profile_selection') {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedProfileIndex((current) => Math.max(0, current - 1))
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedProfileIndex((current) => Math.min(profileOptions.length - 1, current + 1))
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          void handleProfileSelect(profileOptions[selectedProfileIndex].key)
          return
        }

        const upper = event.key.toUpperCase()
        if (upper === 'A' || upper === 'B' || upper === 'C') {
          event.preventDefault()
          void handleProfileSelect(upper as ProfileKey)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, selectedEngineIndex, selectedProfileIndex, inputValue, visible])

  const handleWelcomeEnter = async () => {
    setWelcomeReady(false)
    setEngineSelectReady(false)
    addHistoryLine(setHistory, <SeparatorLine />)
    setPhase('engine_check')
    const scanLine = '[SCAN] Checking active logic engine bridge...'
    const warnLine = '[WARN] No default reasoning engine detected for first-run console.'
      const promptLine = '请选择本次初始化要接入的模型 API。后续都可以在设置页继续微调。'

    await sleep(280)
    addHistoryLine(setHistory, <TypewriterLine text={scanLine} />)
    await sleep(getTypewriterDuration(scanLine) + 220)
    addHistoryLine(setHistory, <TypewriterLine text={warnLine} className="text-[rgba(255,214,133,0.94)]" />)
    await sleep(getTypewriterDuration(warnLine) + 220)
    addHistoryLine(setHistory, <TypewriterLine text={promptLine} />)
    await sleep(getTypewriterDuration(promptLine) + 180)
    setPhase('engine_select')
    setEngineSelectReady(true)
  }

  const handleEngineSelect = async (mode: EngineMode) => {
    const option = engineOptions.find((item) => item.key === mode)
    if (!option) return

    setDraft((current) => ({
      ...current,
      engineMode: mode,
      apiBase: '',
      apiKey: current.apiKey,
    }))

    addHistoryLine(setHistory, <div className="text-[rgba(186,255,176,0.92)]">[SELECT] {option.title}</div>)
    setInputValue('')
    setPhase('engine_url')
  }

  const handleEngineUrlSubmit = async () => {
    const normalizedUrl = inputValue.trim() || getDefaultApiBase(draft.engineMode)
    setDraft((current) => ({ ...current, apiBase: normalizedUrl }))
    addHistoryLine(setHistory, <div>API Base URL: {normalizedUrl}</div>)
    setInputValue('')
    setPhase('engine_key')
  }

  const handleEngineUrlBack = () => {
    setInputValue('')
    setPhase('engine_select')
  }

  const handleEngineKeySubmit = async () => {
    const trimmedKey = inputValue.trim()
    setDraft((current) => ({ ...current, apiKey: trimmedKey }))
    addHistoryLine(setHistory, <div>API Key: {trimmedKey ? maskSecret(trimmedKey) : '[EMPTY]'}</div>)
    setInputValue('')
    setPhase('engine_model')
  }

  const handleEngineKeyBack = () => {
    setInputValue(draft.apiBase)
    setPhase('engine_url')
  }

  const handleEngineModelSubmit = async () => {
    const trimmedModelId = inputValue.trim()
    setDraft((current) => ({ ...current, modelId: trimmedModelId }))
    addHistoryLine(setHistory, <div>Model ID: {trimmedModelId || '[EMPTY]'}</div>)
    setInputValue('')
    setPhase('engine_verify')
    await verifyAndPersistEngine({
      ...draft,
      apiBase: draft.apiBase.trim() || getDefaultApiBase(draft.engineMode),
      apiKey: draft.apiKey.trim(),
      modelId: trimmedModelId,
    })
  }

  const handleEngineModelBack = () => {
    setInputValue(draft.apiKey)
    setPhase('engine_key')
  }

  const verifyAndPersistEngine = async (nextDraft: SetupDraft) => {
    addHistoryLine(setHistory, <TypewriterLine text="[WRITE] Saving engine profile to local config..." />)
    await sleep(780)

    try {
      const currentEngineConfig = asRecord(await window.engineConfig.read())
      const currentAppConfig = asRecord(await window.appConfig.read())

      const engineResult = await window.engineConfig.save(buildEngineConfig(currentEngineConfig, nextDraft))
      const appResult = await window.appConfig.save(buildAppConfig(currentAppConfig, nextDraft))

      if (!engineResult.ok || !appResult.ok) {
        throw new Error(engineResult.error || appResult.error || 'Unable to persist setup state')
      }

      const runtimeStatus = await window.appRuntime.getStatus()
      const verifyLine = runtimeStatus.llmConfigured
        ? '[OK] Engine configuration accepted by the local scheduler.'
        : '[INFO] Configuration written. Detailed connection test can be completed later in Settings.'

      addHistoryLine(
        setHistory,
        <TypewriterLine
          text={verifyLine}
          className={runtimeStatus.llmConfigured ? 'text-[rgba(186,255,176,0.92)]' : 'text-[rgba(255,214,133,0.94)]'}
        />
      )
      await sleep(820)
      addHistoryLine(setHistory, <SeparatorLine />)
      setPhase('profile_selection')
      await sleep(260)
      addHistoryLine(setHistory, <TypewriterLine text="[PROFILE] Choose the task profile this console should bias for." />)
    } catch (error) {
      addHistoryLine(
        setHistory,
        <TypewriterLine
          text={`[FAIL] ${String(error)}`}
          className="text-[rgba(255,148,148,0.94)]"
        />
      )
      await sleep(520)
      setPhase('engine_key')
    }
  }

  const handleProfileSelect = async (key: ProfileKey) => {
    setDraft((current) => ({ ...current, profile: key }))

    const profile = profileOptions.find((item) => item.key === key)
    addHistoryLine(setHistory, <div className="text-[rgba(186,255,176,0.92)]">[PROFILE] {key} / {profile?.title}</div>)
    setPhase('ready')

    const currentAppConfig = asRecord(await window.appConfig.read())
    const appResult = await window.appConfig.save(buildAppConfig(currentAppConfig, { ...draft, profile: key }))
    if (!appResult.ok) {
      addHistoryLine(setHistory, <TypewriterLine text={`[FAIL] ${appResult.error || 'Unable to save profile preset'}`} className="text-[rgba(255,148,148,0.94)]" />)
      setPhase('profile_selection')
      return
    }

    await sleep(720)
    addHistoryLine(setHistory, <TypewriterLine text="[READY] First-run assembly complete. Command center is now unlocked." className="text-[rgba(186,255,176,0.92)]" />)
    await sleep(1100)
    const launched = await window.appBridge.markLaunched()
    if (launched.ok) {
      window.localStorage.setItem(FIRST_RUN_DONE_STORAGE_KEY, 'true')
    }
    setVisible(false)
    setOverlayState('hidden')
  }

  if (overlayState === 'hidden') return null

  if (overlayState !== 'setup') {
    return <StartupSplash closing={overlayState === 'closing'} />
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,12,10,0.74)] px-4 py-6 backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
    >
      <div className="crt-shell crt-boot-enter font-pixel-terminal relative h-full w-full max-w-[1180px] overflow-hidden rounded-[32px] border border-[rgba(183,214,174,0.22)]">
        <div className="crt-bezel absolute inset-[18px] rounded-[24px] border border-[rgba(214,225,208,0.08)]" aria-hidden="true" />
        <div className="crt-noise absolute inset-0" aria-hidden="true" />
        <div className="crt-scanlines absolute inset-0" aria-hidden="true" />
        <div className="crt-vignette absolute inset-0" aria-hidden="true" />

        <div className="relative flex h-full flex-col overflow-hidden px-5 pb-5 pt-6 text-[rgba(199,234,191,0.92)] sm:px-7 sm:pb-7 sm:pt-7">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[rgba(173,204,162,0.16)] pb-4">
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-[0.34em] text-[rgba(174,208,164,0.52)]">
                First Initialization Console
              </p>
              <h2 id="first-run-title" className="font-pixel-display crt-title-glow text-[clamp(1.7rem,2.3vw,2.55rem)] leading-none text-[rgba(228,247,220,0.92)]">
                HarnessClaw Bootstrap
              </h2>
              <p className="mt-3 max-w-[760px] text-sm leading-6 tracking-[0.04em] text-[rgba(177,205,169,0.7)]">
                用一轮简短装配，把首次启动从欢迎语变成真实可用的本地控制台。
              </p>
            </div>

            <div className="grid gap-2 text-xs tracking-[0.08em] text-[rgba(177,205,169,0.72)] sm:text-right">
              <div className="inline-flex items-center gap-2">
                <Cpu size={14} />
                <span>本地优先 / 可回退配置</span>
              </div>
              <div className="inline-flex items-center gap-2">
                <Wrench size={14} />
                <span>引擎、技能、画像一次装配</span>
              </div>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <section className="crt-screen relative min-h-[420px] overflow-hidden rounded-[24px] border border-[rgba(184,217,174,0.18)] bg-[rgba(7,14,8,0.84)] px-4 py-4 sm:px-5">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-[rgba(169,198,158,0.46)]">
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[rgba(186,255,176,0.92)] shadow-[0_0_14px_rgba(186,255,176,0.55)]" />
                <span>System Stream</span>
              </div>

              <div className="h-[calc(100%-1.75rem)] overflow-y-auto pr-1 text-[13px] leading-7 tracking-[0.03em] sm:text-[14px]">
                {history.map((node, index) => (
                  <div key={index} className="crt-text-glow mb-1.5 last:mb-0">
                    {node}
                  </div>
                ))}

                {phase === 'welcome' && welcomeReady && (
                  <button
                    type="button"
                    className="crt-ease-out mt-6 inline-flex items-center gap-2 rounded-full border border-[rgba(184,217,174,0.26)] bg-[rgba(19,31,20,0.8)] px-4 py-2 text-sm text-[rgba(225,247,217,0.9)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-px hover:bg-[rgba(31,48,33,0.9)] hover:shadow-[0_0_14px_rgba(143,220,132,0.14)] active:translate-y-0"
                    onClick={() => void handleWelcomeEnter()}
                  >
                    <ArrowRight size={14} />
                    <span>按 Enter 启动初始化流程</span>
                  </button>
                )}

                {phase === 'engine_select' && engineSelectReady && (
                  <div className="mt-5 grid gap-2">
                    {engineOptions.map((option, index) => {
                      const selected = selectedEngineIndex === index
                      return (
                        <button
                          key={option.key}
                          type="button"
                          className={cn(
                            'crt-ease-out group rounded-[16px] border px-4 py-3 text-left transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_0_18px_rgba(143,220,132,0.08)]',
                            selected
                              ? 'border-[rgba(188,231,176,0.36)] bg-[rgba(36,53,37,0.72)] text-[rgba(228,247,220,0.96)]'
                              : 'border-[rgba(181,207,173,0.14)] bg-[rgba(14,22,15,0.72)] text-[rgba(176,201,169,0.74)] hover:bg-[rgba(24,35,25,0.78)]'
                          )}
                          onMouseEnter={() => setSelectedEngineIndex(index)}
                          onClick={() => void handleEngineSelect(option.key)}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium">{option.title}</div>
                              <div className="mt-1 text-xs text-[rgba(176,201,169,0.68)]">{option.detail}</div>
                            </div>
                            <ChevronRight
                              size={16}
                              className={cn(
                                'transition-transform',
                                selected && 'translate-x-0.5 text-[rgba(214,245,205,0.88)]'
                              )}
                            />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {phase === 'engine_url' && (
                  <InputRow
                    label="API Base URL"
                    hint={`留空默认 ${getDefaultApiBase(draft.engineMode)}，按 Esc 返回模型 API 选择。`}
                    value={inputValue}
                    onChange={setInputValue}
                    inputRef={activeInputRef}
                    placeholder={getDefaultApiBase(draft.engineMode)}
                  />
                )}

                {phase === 'engine_key' && (
                  <InputRow
                    label="API Key"
                    hint="该步骤只写入本地配置文件，不做外网验证。按 Esc 返回上一项。"
                    value={inputValue}
                    onChange={setInputValue}
                    inputRef={activeInputRef}
                    placeholder="sk-..."
                    type="password"
                  />
                )}

                {phase === 'engine_model' && (
                  <InputRow
                    label="Model ID"
                    hint="输入你要使用的模型标识。按 Esc 返回上一项。"
                    value={inputValue}
                    onChange={setInputValue}
                    inputRef={activeInputRef}
                    placeholder="model-id"
                  />
                )}

                {phase === 'profile_selection' && (
                  <div className="mt-5 grid gap-2">
                    {profileOptions.map((option, index) => {
                      const selected = selectedProfileIndex === index
                      return (
                        <button
                          key={option.key}
                          type="button"
                          className={cn(
                            'crt-ease-out rounded-[16px] border px-4 py-3 text-left transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_0_18px_rgba(143,220,132,0.08)]',
                            selected
                              ? 'border-[rgba(188,231,176,0.36)] bg-[rgba(36,53,37,0.72)] text-[rgba(228,247,220,0.96)]'
                              : 'border-[rgba(181,207,173,0.14)] bg-[rgba(14,22,15,0.72)] text-[rgba(176,201,169,0.74)] hover:bg-[rgba(24,35,25,0.78)]'
                          )}
                          onMouseEnter={() => setSelectedProfileIndex(index)}
                          onClick={() => void handleProfileSelect(option.key)}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium">[{option.key}] {option.title}</div>
                              <div className="mt-1 text-xs text-[rgba(176,201,169,0.68)]">{option.detail}</div>
                            </div>
                            <CheckCircle2
                              size={16}
                              className={cn(
                                'mt-0.5 opacity-40 transition-opacity',
                                selected && 'opacity-100 text-[rgba(214,245,205,0.88)]'
                              )}
                            />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {['booting', 'engine_check', 'engine_verify', 'ready'].includes(phase) && (
                  <div className="mt-3">
                    <Cursor />
                  </div>
                )}

                <div ref={bottomRef} className="h-14" />
              </div>
            </section>

            <aside className="grid content-start gap-4">
              <div className="rounded-[22px] border border-[rgba(184,217,174,0.18)] bg-[rgba(13,20,14,0.74)] p-4">
                <div className="mb-3 text-[11px] uppercase tracking-[0.28em] text-[rgba(169,198,158,0.46)]">
                  Initialization Map
                </div>
                <div className="grid gap-2">
                  <StatusCard
                    title="推理引擎"
                    value={draft.engineMode ? engineOptions.find((item) => item.key === draft.engineMode)?.title || '已选择' : '待配置'}
                    active={phase === 'engine_select' || phase === 'engine_url' || phase === 'engine_key' || phase === 'engine_verify'}
                    done={Boolean(draft.engineMode)}
                  />
                  <StatusCard
                    title="任务画像"
                    value={draft.profile ? profileOptions.find((item) => item.key === draft.profile)?.title || draft.profile : '待选择'}
                    active={phase === 'profile_selection'}
                    done={Boolean(draft.profile)}
                  />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

function StartupSplash({ closing }: { closing: boolean }) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(48,74,48,0.18),_transparent_30%),linear-gradient(180deg,_rgba(7,11,8,1),_rgba(3,6,4,1))] px-6',
        closing && 'pointer-events-none'
      )}
      aria-hidden="true"
    >
      <div className="crt-noise absolute inset-0" />
      <div className="crt-scanlines absolute inset-0" />
      <div className="crt-vignette absolute inset-0" />
      <div className="crt-startup-beam absolute inset-0" />

      <div
        className={cn(
          'font-pixel-terminal relative flex w-full max-w-[720px] flex-col items-center text-center text-[rgba(213,244,205,0.92)] transition-[opacity,transform,filter] duration-300',
          closing ? 'translate-y-1 opacity-0 blur-[2px]' : 'opacity-100'
        )}
      >
        <div className="crt-startup-mark mb-6 h-[2px] w-24 bg-[rgba(196,241,184,0.92)]" />
        <div className="crt-title-glow font-pixel-display text-[clamp(1.75rem,4vw,3.1rem)] uppercase leading-none tracking-[0.22em]">
          HarnessClaw
        </div>
        <div className="mt-5 text-[11px] uppercase tracking-[0.44em] text-[rgba(175,206,168,0.64)]">
          Operator Console Boot Sequence
        </div>
        <div className="mt-8 h-[1px] w-full max-w-[420px] bg-[linear-gradient(90deg,rgba(179,226,167,0),rgba(179,226,167,0.5),rgba(179,226,167,0))]" />
      </div>
    </div>
  )
}

function addHistoryLine(
  setter: Dispatch<SetStateAction<ReactNode[]>>,
  node: ReactNode,
) {
  setter((current) => [...current, node])
}

function StatusCard({
  title,
  value,
  active,
  done,
}: {
  title: string
  value: string
  active?: boolean
  done?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-[18px] border px-3 py-3 transition-colors',
        active
          ? 'border-[rgba(188,231,176,0.34)] bg-[rgba(33,49,34,0.7)]'
          : 'border-[rgba(184,217,174,0.12)] bg-[rgba(11,16,12,0.62)]'
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[rgba(169,198,158,0.46)]">
        <span
          className={cn(
            'inline-flex h-2 w-2 rounded-full',
            done
              ? 'bg-[rgba(186,255,176,0.92)] shadow-[0_0_12px_rgba(186,255,176,0.45)]'
              : active
                ? 'bg-[rgba(255,214,133,0.92)] shadow-[0_0_12px_rgba(255,214,133,0.38)]'
                : 'bg-[rgba(115,138,111,0.64)]'
          )}
        />
        <span>{title}</span>
      </div>
      <div className="text-sm text-[rgba(224,244,216,0.9)]">{value}</div>
    </div>
  )
}

function InputRow({
  label,
  hint,
  value,
  onChange,
  inputRef,
  placeholder,
  type = 'text',
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement>
  placeholder?: string
  type?: 'text' | 'password'
}) {
  return (
    <div className="crt-ease-out mt-5 rounded-[18px] border border-[rgba(184,217,174,0.18)] bg-[rgba(16,24,17,0.76)] px-4 py-3 transition-[border-color,box-shadow,transform] duration-200 focus-within:-translate-y-px focus-within:border-[rgba(189,233,177,0.38)] focus-within:shadow-[0_0_18px_rgba(153,226,141,0.12)]">
      <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-[rgba(169,198,158,0.46)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-[rgba(188,217,181,0.72)]">&gt;</span>
        <input
          ref={inputRef}
          autoFocus
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm tracking-[0.04em] text-[rgba(230,247,223,0.92)] outline-none placeholder:text-[rgba(120,146,116,0.64)]"
        />
        <Cursor />
      </div>
      <p className="mt-2 text-xs leading-5 text-[rgba(176,201,169,0.62)]">{hint}</p>
    </div>
  )
}

function TypewriterLine({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [displayed, setDisplayed] = useState('')
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    const glyphs = Array.from(text)

    if (prefersReducedMotion) {
      setDisplayed(text)
      setTyping(false)
      return
    }

    setDisplayed('')
    setTyping(true)

    let index = 0
    let timer: number | null = null

    const tick = () => {
      index += 1
      setDisplayed(glyphs.slice(0, index).join(''))

      if (index >= glyphs.length) {
        setTyping(false)
        return
      }

      timer = window.setTimeout(tick, getGlyphDelay(glyphs[index]))
    }

    timer = window.setTimeout(tick, 60)

    return () => {
      if (timer != null) window.clearTimeout(timer)
    }
  }, [prefersReducedMotion, text])

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {displayed}
      {typing && <span className="crt-type-caret ml-[2px]" aria-hidden="true" />}
    </span>
  )
}

function Cursor() {
  return <span className="crt-cursor inline-block h-4 w-2 rounded-[1px] bg-[rgba(226,247,217,0.92)] align-middle" aria-hidden="true" />
}

function SeparatorLine() {
  return <div className="my-2 h-px w-full bg-[linear-gradient(90deg,rgba(180,214,171,0),rgba(180,214,171,0.36),rgba(180,214,171,0))]" />
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '********'
  return `${value.slice(0, 4)}••••${value.slice(-2)}`
}

function getGlyphDelay(glyph: string): number {
  if (!glyph.trim()) return 10
  if (/^[,.:;!?，。：；！？]$/.test(glyph)) return 70
  if (/^[A-Z0-9[\]>/-]$/i.test(glyph)) return 16
  return 28
}

function getTypewriterDuration(text: string): number {
  return 60 + Array.from(text).reduce((total, glyph) => total + getGlyphDelay(glyph), 0)
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return prefersReducedMotion
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
