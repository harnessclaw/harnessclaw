import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Stethoscope,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type DoctorRunResult = Awaited<ReturnType<typeof window.doctor.run>>
type DoctorFixResult = Awaited<ReturnType<typeof window.doctor.fix>>
type DoctorCheckResult = DoctorRunResult['checks'][number]
type DoctorStage = DoctorCheckResult['stage']
type DoctorStatus = DoctorCheckResult['status']
const DOCTOR_RESULT_CACHE_KEY = 'harnessclaw-doctor-last-result'

function readCachedDoctorResult(): DoctorRunResult | null {
  try {
    const raw = window.localStorage.getItem(DOCTOR_RESULT_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as DoctorRunResult
  } catch {
    return null
  }
}

function writeCachedDoctorResult(result: DoctorRunResult): void {
  try {
    window.localStorage.setItem(DOCTOR_RESULT_CACHE_KEY, JSON.stringify(result))
  } catch {
    // Ignore cache write failures and keep the in-memory result.
  }
}

const STAGE_LABELS: Record<DoctorStage, string> = {
  environment: '环境',
  config: '配置',
  runtime: '运行时',
  flow: '链路闭环',
}

function StatusBadge({ status }: { status: DoctorStatus }) {
  const classes = {
    pass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-700',
    fail: 'border-rose-200 bg-rose-50 text-rose-700',
    skip: 'border-slate-200 bg-slate-50 text-slate-600',
  } as const

  const labels = {
    pass: 'PASS',
    warn: 'WARN',
    fail: 'FAIL',
    skip: 'SKIP',
  } as const

  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', classes[status])}>
      {labels[status]}
    </span>
  )
}

function StatusIcon({ status }: { status: DoctorStatus }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={16} className="text-emerald-600" />
    case 'warn':
      return <AlertTriangle size={16} className="text-amber-600" />
    case 'fail':
      return <XCircle size={16} className="text-rose-600" />
    case 'skip':
      return <SkipForward size={16} className="text-slate-500" />
  }
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const tones = {
    neutral: 'border-border bg-card text-foreground',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-700',
    bad: 'border-rose-200 bg-rose-50 text-rose-700',
  } as const

  return (
    <div className={cn('rounded-xl border px-4 py-3', tones[tone])}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

export function DoctorPage() {
  const [result, setResult] = useState<DoctorRunResult | null>(() => readCachedDoctorResult())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fixingCheckId, setFixingCheckId] = useState<string | null>(null)
  const [fixFeedback, setFixFeedback] = useState<DoctorFixResult | null>(null)

  const runDoctor = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.doctor.run()
      setResult(next)
      writeCachedDoctorResult(next)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleFix = useCallback(async (checkId: string) => {
    setFixingCheckId(checkId)
    setFixFeedback(null)
    try {
      const res = await window.doctor.fix(checkId)
      setFixFeedback(res)
      await runDoctor()
    } catch (err) {
      setFixFeedback({ ok: false, message: String(err) })
    } finally {
      setFixingCheckId(null)
    }
  }, [runDoctor])

  const groupedChecks = useMemo(() => {
    if (!result) return []
    return (Object.keys(STAGE_LABELS) as DoctorStage[]).map((stage) => ({
      stage,
      items: result.checks.filter((check) => check.stage === stage),
    })).filter((group) => group.items.length > 0)
  }, [result])

  const overallTone = result?.summary.fail
    ? 'bad'
    : result?.summary.warn
      ? 'warn'
      : 'good'

  const priorityFixes = useMemo(() => {
    if (!result) return []
    return result.checks
      .filter((check) => (check.status === 'fail' || check.status === 'warn') && check.fixHint)
      .slice(0, 5)
  }, [result])

  const fixableCheckIds = useMemo(() => new Set([
    'environment.runtime_dirs',
    'config.workspace',
    'config.app_exists',
    'config.nanobot_exists',
    'runtime.clawhub_installed',
    'runtime.harnessclaw_connection',
    'runtime.gateway_process',
    'runtime.gateway_port',
    'flow.gateway_handshake',
  ]), [])

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent">
              <Stethoscope size={18} className="text-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Doctor</h1>
              <p className="text-sm text-muted-foreground">从环境、配置、运行时到最小对话闭环的一键自检</p>
            </div>
          </div>
        </div>

        <button
          onClick={() => void runDoctor()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          重新检查
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Doctor 运行失败：{error}
        </div>
      )}

      {fixFeedback && (
        <div
          className={cn(
            'mb-6 rounded-xl px-4 py-3 text-sm',
            fixFeedback.ok
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-rose-200 bg-rose-50 text-rose-700'
          )}
        >
          {fixFeedback.message}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="rounded-2xl border border-border bg-card px-5 py-6 shadow-sm">
          <div className="text-base font-semibold text-foreground">Doctor 尚未运行</div>
          <div className="mt-1 text-sm text-muted-foreground">
            进入页面时不会自动执行检查。点击右上角“重新检查”后再开始自检。
          </div>
        </div>
      )}

      {result && (
        <>
          <div
            className={cn(
              'mb-6 rounded-2xl border px-5 py-4',
              overallTone === 'bad'
                ? 'border-rose-200 bg-rose-50'
                : overallTone === 'warn'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-emerald-200 bg-emerald-50'
            )}
          >
            <div className="flex items-center gap-3">
              {result.ok ? (
                <ShieldCheck size={20} className="text-emerald-700" />
              ) : (
                <ShieldAlert size={20} className={overallTone === 'bad' ? 'text-rose-700' : 'text-amber-700'} />
              )}
              <div>
                <div className="text-base font-semibold text-foreground">
                  {result.ok ? '当前链路可用' : '检测到阻塞问题'}
                </div>
                <div className="text-sm text-muted-foreground">
                  开始于 {new Date(result.startedAt).toLocaleString('zh-CN')}，结束于 {new Date(result.finishedAt).toLocaleString('zh-CN')}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="通过" value={result.summary.pass} tone="good" />
            <SummaryCard label="警告" value={result.summary.warn} tone="warn" />
            <SummaryCard label="失败" value={result.summary.fail} tone="bad" />
            <SummaryCard label="跳过" value={result.summary.skip} tone="neutral" />
          </div>

          {priorityFixes.length > 0 && (
            <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-foreground">优先修复项</div>
              <div className="space-y-2">
                {priorityFixes.map((check) => (
                  <div key={check.id} className="rounded-xl bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={check.status} />
                      <div className="text-sm font-medium text-foreground">{check.title}</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{check.fixHint}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            {groupedChecks.map((group) => (
              <section key={group.stage}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">
                    {STAGE_LABELS[group.stage]}
                  </h2>
                  <span className="text-xs text-muted-foreground">{group.items.length} 项</span>
                </div>

                <div className="space-y-3">
                  {group.items.map((check) => (
                    <div key={check.id} className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5">
                            <StatusIcon status={check.status} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-foreground">{check.title}</div>
                              <StatusBadge status={check.status} />
                            </div>
                            <div className="mt-1 text-sm text-foreground">{check.summary}</div>
                            {check.detail && (
                              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-muted/50 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                                {check.detail}
                              </pre>
                            )}
                            {check.impact && (
                              <div className="mt-2 text-xs text-muted-foreground">
                                影响：{check.impact}
                              </div>
                            )}
                            {check.fixHint && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                建议：{check.fixHint}
                              </div>
                            )}
                            {fixableCheckIds.has(check.id) && (check.status === 'fail' || check.status === 'warn') && (
                              <div className="mt-3">
                                <button
                                  onClick={() => void handleFix(check.id)}
                                  disabled={fixingCheckId !== null}
                                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                                >
                                  {fixingCheckId === check.id && <Loader2 size={12} className="animate-spin" />}
                                  {fixingCheckId === check.id ? '修复中...' : '尝试自动修复'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 text-xs text-muted-foreground">
                          {check.durationMs} ms
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
