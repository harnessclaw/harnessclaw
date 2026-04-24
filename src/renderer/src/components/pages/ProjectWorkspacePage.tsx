import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FilePlus2, FolderKanban, MoreHorizontal, Plus, SendHorizontal } from 'lucide-react'
import { DangerConfirmMenu } from '../common/DangerConfirmMenu'
import { cn } from '../../lib/utils'

const usageChartData = [
  { label: '04/09', value: 40.2 },
  { label: '04/12', value: 19.1 },
  { label: '04/14', value: 48.8 },
  { label: '04/15', value: 10.4 },
  { label: '04/16', value: 43.7 },
  { label: '04/18', value: 48.2 },
  { label: '04/19', value: 0.6 },
  { label: '04/21', value: 26.5 },
  { label: '04/23', value: 31.8 },
] as const

const projectAgents = [
  {
    id: 'agent-01',
    bg: 'linear-gradient(180deg, #f7f7f5 0%, #e9edf4 100%)',
    hair: '#6d4f34',
    skin: '#d8a881',
    shirt: '#f4f5f7',
  },
  {
    id: 'agent-02',
    bg: 'linear-gradient(180deg, #e2d5ba 0%, #b78f59 100%)',
    hair: '#2d231d',
    skin: '#9d6d4b',
    shirt: '#80878d',
  },
  {
    id: 'agent-03',
    bg: 'linear-gradient(180deg, #f4ce69 0%, #e9a72b 100%)',
    hair: '#3c1e16',
    skin: '#b86d46',
    shirt: '#c94026',
  },
  {
    id: 'agent-04',
    bg: 'linear-gradient(180deg, #dbe6f2 0%, #9bb0c8 100%)',
    hair: '#263746',
    skin: '#b98464',
    shirt: '#8fa6c3',
  },
] as const

function getProjectSessionLabel(session: DbSessionRow): string {
  const trimmed = session.title.trim()
  if (trimmed) return trimmed
  return `未命名对话 ${session.session_id.slice(-6)}`
}

export function ProjectWorkspacePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { projectId = '' } = useParams()
  const routeProject = (location.state as { project?: DbProjectRow } | null)?.project
  const [project, setProject] = useState<DbProjectRow | null>(routeProject ?? null)
  const [projectSessions, setProjectSessions] = useState<DbSessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [sessionActionError, setSessionActionError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const [projectRow, sessionRows] = await Promise.all([
          window.db.getProject(projectId),
          window.db.listProjectSessions(projectId),
        ])

        if (cancelled) return
        setProject(projectRow)
        setProjectSessions(sessionRows)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    const offSessionsChanged = window.db.onSessionsChanged(() => {
      void load()
    })

    return () => {
      cancelled = true
      offSessionsChanged()
    }
  }, [projectId])

  useEffect(() => {
    if (!menuSessionId && !confirmDeleteSessionId) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-project-session-actions]')) return
      if (target?.closest('[data-danger-confirm-dialog]')) return
      setMenuSessionId(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuSessionId(null)
        setConfirmDeleteSessionId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [confirmDeleteSessionId, menuSessionId])

  const handleCreateProjectSession = () => {
    const message = input.trim()
    if (!message || !project) return

    navigate('/chat', {
      state: {
        createSession: true,
        initialMessage: message,
        projectContext: {
          projectId: project.project_id,
          name: project.name,
          description: project.description,
          createdAt: project.created_at,
        },
      },
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleCreateProjectSession()
    }
  }

  const canCreateProjectSession = Boolean(input.trim() && project)
  const confirmingSession = projectSessions.find((session) => session.session_id === confirmDeleteSessionId) ?? null

  const handleDeleteProjectSession = async (sessionId: string) => {
    setSessionActionError('')
    setDeletingSessionId(sessionId)
    try {
      const result = await window.db.deleteSession(sessionId)
      if (!result.ok) {
        setSessionActionError(result.error || '对话删除失败，请稍后再试。')
        return
      }

      setProjectSessions((current) => current.filter((session) => session.session_id !== sessionId))
      setMenuSessionId(null)
      setConfirmDeleteSessionId(null)
    } finally {
      setDeletingSessionId(null)
    }
  }

  if (!loading && !project) {
    return (
      <div className="flex h-full min-h-0 justify-center overflow-hidden px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
        <div className="w-full max-w-[1180px]">
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} />
            <span>返回项目</span>
          </button>

          <div className="mt-6 rounded-[24px] border border-dashed border-border bg-card px-6 py-10 text-center">
            <h1 className="text-lg font-semibold text-foreground">项目不存在</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              当前项目可能已经被移除，或者这个链接还没有对应的数据。
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 justify-center overflow-hidden px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      <div className="flex h-full min-h-0 w-full max-w-[1320px] flex-col">
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_380px]">
          <section className="flex min-h-0 flex-col">
            <div className="mb-4 flex items-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="-ml-2 inline-flex min-h-10 items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft size={16} />
                <span>All projects</span>
              </button>
            </div>

            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {loading ? '加载中...' : project?.name}
                </h1>
              </div>

              <div className="hidden items-center gap-2 text-muted-foreground md:flex">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted"
                  aria-label="更多操作"
                >
                  <span className="text-xl leading-none">⋮</span>
                </button>
              </div>
            </div>

            <div
              className={cn(
                'relative overflow-hidden rounded-[28px] border bg-card transition-[border-color,box-shadow,transform] duration-200',
                'focus-within:border-primary focus-within:shadow-[0_18px_54px_rgba(15,23,42,0.08)]',
                'border-border shadow-[0_12px_40px_rgba(15,23,42,0.04)]'
              )}
            >
              <div className="p-4 sm:p-5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                placeholder="+ 输入问题、目标或下一步，我来接手。"
                className="min-h-[56px] max-h-[112px] w-full resize-none border-0 bg-transparent p-0 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground/90"
              />

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.focus()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    aria-label="添加文件"
                  >
                    <Plus size={12} />
                    <span>添加文件</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCreateProjectSession}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-opacity',
                      canCreateProjectSession
                        ? 'bg-foreground text-background hover:opacity-90'
                        : 'bg-foreground text-background opacity-50'
                    )}
                    disabled={!canCreateProjectSession}
                  >
                    <span>发送</span>
                    <SendHorizontal size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 min-h-0 flex-1 space-y-0 overflow-hidden">
              {sessionActionError ? (
                <p className="mb-2 px-4 text-xs text-destructive">{sessionActionError}</p>
              ) : null}
              {projectSessions.map((session, index) => (
                <div
                  key={session.session_id}
                  className={cn(
                    'relative flex items-center gap-2 border-border px-4 py-3 transition-colors hover:bg-muted/30',
                    index === 0 ? 'border-t' : 'border-t',
                    index === projectSessions.length - 1 && 'border-b'
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => navigate('/chat', { state: { sessionId: session.session_id } })}
                  >
                    <p className="text-[0.98rem] font-medium text-foreground">{getProjectSessionLabel(session)}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {new Date(session.updated_at).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </button>
                  <div data-project-session-actions className="relative flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSessionActionError('')
                        setConfirmDeleteSessionId(null)
                        setMenuSessionId((current) => current === session.session_id ? null : session.session_id)
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={`打开${getProjectSessionLabel(session)}的对话操作`}
                      aria-expanded={menuSessionId === session.session_id}
                    >
                      <MoreHorizontal size={15} />
                    </button>

                    {menuSessionId === session.session_id ? (
                      <DangerConfirmMenu
                        className="absolute right-0 top-9"
                        confirming={false}
                        disabled={deletingSessionId === session.session_id}
                        pending={deletingSessionId === session.session_id}
                        pendingLabel="删除中"
                        onRequestConfirm={() => {
                          setMenuSessionId(null)
                          setConfirmDeleteSessionId(session.session_id)
                        }}
                        onCancel={() => setConfirmDeleteSessionId(null)}
                        onConfirm={() => void handleDeleteProjectSession(session.session_id)}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
              {!loading && projectSessions.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-border bg-muted/12 px-4 py-5 text-sm text-muted-foreground">
                  当前项目还没有关联对话，从上方输入框发起第一条对话后会出现在这里。
                </div>
              ) : null}
            </div>
          </section>

          <aside className="min-w-0">
            <div className="space-y-1">
              <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
                <PanelBlock
                  title="项目约束"
                  icon={<Plus size={18} />}
                  actionLabel="添加说明"
                  body={(
                    <div className="rounded-[20px] border border-dashed border-border bg-muted/20 px-4 py-5 text-sm leading-6 text-muted-foreground">
                      {project?.description?.trim() || '暂无说明'}
                    </div>
                  )}
                />
              </div>

              <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
                <PanelBlock
                  title="Files"
                  icon={<FilePlus2 size={18} />}
                  actionLabel="添加文件"
                  body={(
                    <div className="rounded-[20px] bg-muted/20 px-5 py-5 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-border bg-background text-muted-foreground">
                        <FolderKanban size={20} />
                      </div>
                      <p className="mx-auto mt-3 max-w-[220px] text-sm leading-6 text-muted-foreground">
                        添加项目文件
                      </p>
                    </div>
                  )}
                />
              </div>

              <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
                <PanelBlock
                  title="LLM 使用量"
                  icon={<Plus size={22} strokeWidth={2.2} />}
                  actionLabel="查看用量详情"
                  actionButtonClassName="h-10 w-10"
                  sectionClassName="flex flex-col"
                  bodyClassName="mt-4"
                  body={(
                    <UsageChartCard />
                  )}
                />
              </div>

              <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
                <PanelBlock
                  title="Agents"
                  icon={<Plus size={18} />}
                  actionLabel="添加 Agent"
                  bodyClassName="mt-[2px]"
                  body={(
                    <ProjectAgentsCard />
                  )}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>

      {confirmingSession ? (
        <DangerConfirmMenu
          confirming
          title="确认删除对话？"
          disabled={deletingSessionId === confirmingSession.session_id}
          pending={deletingSessionId === confirmingSession.session_id}
          pendingLabel="删除中"
          onRequestConfirm={() => undefined}
          onCancel={() => setConfirmDeleteSessionId(null)}
          onConfirm={() => void handleDeleteProjectSession(confirmingSession.session_id)}
        />
      ) : null}
    </div>
  )
}

function UsageChartCard() {
  const width = 320
  const height = 180
  const paddingTop = 14
  const paddingRight = 10
  const paddingBottom = 24
  const paddingLeft = 36
  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom
  const todayValue = usageChartData[usageChartData.length - 1]?.value ?? 0
  const peakValue = Math.max(...usageChartData.map((item) => item.value))
  const maxValue = Math.ceil(peakValue / 10) * 10
  const yTicks = Array.from({ length: maxValue / 10 + 1 }, (_, index) => index * 10)
  const labelIndexes = [0, 2, 4, 6, 8]

  const points = usageChartData.map((point, index) => {
    const x = paddingLeft + (chartWidth / (usageChartData.length - 1)) * index
    const y = paddingTop + chartHeight - (point.value / maxValue) * chartHeight
    return { ...point, x, y }
  })

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1]?.x.toFixed(2)} ${(paddingTop + chartHeight).toFixed(2)} L ${points[0]?.x.toFixed(2)} ${(paddingTop + chartHeight).toFixed(2)} Z`
  const latestPoint = points[points.length - 1]

  return (
    <div className="rounded-[22px] border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">用量统计</p>
            <p className="mt-1 text-[11px] text-muted-foreground">近 14 天 token 趋势</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium text-muted-foreground">今日用量</p>
            <p className="text-[1.55rem] font-semibold tracking-tight text-foreground">
              {todayValue.toFixed(1)}M
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="w-full">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full overflow-visible">
              <defs>
                <linearGradient id="usage-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(29, 91, 230, 0.20)" />
                  <stop offset="100%" stopColor="rgba(29, 91, 230, 0.02)" />
                </linearGradient>
              </defs>

              {yTicks.map((tick) => {
                const y = paddingTop + chartHeight - (tick / maxValue) * chartHeight
                return (
                  <g key={tick}>
                    <line
                      x1={paddingLeft}
                      x2={width - paddingRight}
                      y1={y}
                      y2={y}
                      stroke="rgba(148,163,184,0.28)"
                      strokeDasharray="3 4"
                    />
                    <text
                      x={paddingLeft - 7}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {tick === 0 ? '0' : `${tick}M`}
                    </text>
                  </g>
                )
              })}

              <path d={areaPath} fill="url(#usage-fill)" />
              <path
                d={linePath}
                fill="none"
                stroke="#1d5be6"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((point, index) => (
                <circle
                  key={point.label}
                  cx={point.x}
                  cy={point.y}
                  r={index === points.length - 1 ? 4.5 : 3}
                  fill={index === points.length - 1 ? '#1d5be6' : '#ffffff'}
                  stroke="#1d5be6"
                  strokeWidth={index === points.length - 1 ? 2.5 : 1.8}
                />
              ))}
              {latestPoint ? (
                <line
                  x1={latestPoint.x}
                  x2={latestPoint.x}
                  y1={paddingTop}
                  y2={paddingTop + chartHeight}
                  stroke="rgba(29,91,230,0.14)"
                  strokeDasharray="3 4"
                />
              ) : null}

              {labelIndexes.map((tickIndex) => {
                const point = points[tickIndex]
                if (!point) return null

                return (
                  <text
                    key={point.label}
                    x={point.x}
                    y={height - 6}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {point.label}
                  </text>
                )
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectAgentsCard() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-[#fbfaf8] pl-[6px] pr-4 py-2 shadow-[0_18px_38px_rgba(15,23,42,0.08)]">
      <div className="pointer-events-none absolute inset-x-10 bottom-0 h-5 rounded-full bg-[rgba(161,127,255,0.18)] blur-xl" />
      <div className="relative flex items-center justify-start">
        <div className="flex items-center justify-start -space-x-3">
          {projectAgents.map((agent, index) => (
            <div
              key={agent.id}
              className={cn(
                'relative shrink-0 transition-transform',
                index % 2 === 0 ? 'translate-y-0' : 'translate-y-0.5'
              )}
              style={{ zIndex: projectAgents.length - index }}
            >
              <AgentPortrait palette={agent} size={54} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentPortrait({
  palette,
  size,
}: {
  palette: (typeof projectAgents)[number]
  size: number
}) {
  return (
    <div
      className="relative overflow-hidden rounded-full shadow-[0_10px_20px_rgba(15,23,42,0.10)]"
      style={{ width: size, height: size, background: palette.bg }}
    >
      <svg viewBox="0 0 54 54" className="h-full w-full" aria-hidden="true">
        <circle cx="27" cy="27" r="27" fill="transparent" />
        <ellipse cx="27" cy="60" rx="18" ry="16" fill={palette.shirt} />
        <path d="M18 32c1-8 5.8-13 9-13s8 5 9 13c-2.7 2.8-5.5 4.3-9 4.3s-6.2-1.5-9-4.3Z" fill={palette.skin} />
        <path d="M17 23c2-6.8 7.8-10.6 12-10.6 4.6 0 8.5 2.4 10.5 7.8l-2.8 4.7c-2.4-1.4-4.8-2.1-8.5-2.1-3.5 0-6.5.9-9 2.9L17 23Z" fill={palette.hair} />
        <circle cx="22.2" cy="26.5" r="1.2" fill="#1f2937" opacity="0.72" />
        <circle cx="31.4" cy="26.5" r="1.2" fill="#1f2937" opacity="0.72" />
        <path d="M22.4 31.4c1.6 1.5 3 2.1 4.9 2.1s3.5-.6 5.2-2.1" fill="none" stroke="#825b45" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
      </svg>
    </div>
  )
}

function PanelBlock({
  title,
  icon,
  actionLabel,
  actionButtonClassName,
  sectionClassName,
  bodyClassName,
  body,
}: {
  title: string
  icon: React.ReactNode
  actionLabel: string
  actionButtonClassName?: string
  sectionClassName?: string
  bodyClassName?: string
  body?: React.ReactNode
}) {
  return (
    <section className={cn('px-5 py-4 sm:px-6', sectionClassName)}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        <button
          type="button"
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            actionButtonClassName
          )}
          aria-label={actionLabel}
        >
          {icon}
        </button>
      </div>

      {body ? <div className={bodyClassName}>{body}</div> : null}
    </section>
  )
}
