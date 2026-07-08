import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FilePlus2, FolderKanban, MoreHorizontal, Plus, SendHorizontal } from 'lucide-react'
import { DangerConfirmMenu } from '../common/DangerConfirmMenu'
import { ProjectOpenWithControl } from '../common/ProjectOpenWithControl'
import { cn } from '../../lib/utils'
import { getProjectDisplayDescription, getProjectDisplayName } from '../../lib/projectDisplay'
import { getProjectCwd, readProjectCwds, setProjectCwd } from '../../lib/projectCwds'

function getProjectSessionLabel(t: any, session: DbSessionRow): string {
  const trimmed = session.title.trim()
  if (trimmed) return trimmed
  return t('projects.workspace.unnamedSession', { id: session.session_id.slice(-6) })
}

export function ProjectWorkspacePage() {
  const { t } = useTranslation()
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
    const cwd = getProjectCwd(project, readProjectCwds())
    if (cwd) setProjectCwd(project.project_id, cwd)

    navigate('/chat', {
      state: {
        createSession: true,
        initialMessage: message,
        cwd: cwd || undefined,
        projectContext: {
          projectId: project.project_id,
          name: displayProjectName,
          description: displayProjectDescription,
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
  const displayProjectName = project ? getProjectDisplayName(project, t) : ''
  const displayProjectDescription = project ? getProjectDisplayDescription(project, t) : ''
  const projectCwd = project ? getProjectCwd(project, readProjectCwds()) : ''

  const handleDeleteProjectSession = async (sessionId: string) => {
    setSessionActionError('')
    setDeletingSessionId(sessionId)
    try {
      const result = await window.db.deleteSession(sessionId)
      if (!result.ok) {
        setSessionActionError(result.error || t('projects.workspace.deleteSessionError'))
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
      <div className="flex h-full min-h-0 justify-center overflow-hidden px-4 pb-4 pt-10 sm:px-6 sm:pb-5 sm:pt-11 lg:px-8">
        <div className="w-full max-w-[1180px]">
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} />
            <span>{t('projects.workspace.back')}</span>
          </button>

          <div className="mt-6 rounded-[24px] border border-dashed border-border bg-card px-6 py-10 text-center">
            <h1 className="text-lg font-semibold text-foreground">{t('projects.workspace.notExist')}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('projects.workspace.notExistDesc')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 justify-center overflow-hidden px-4 pb-4 pt-10 sm:px-6 sm:pb-5 sm:pt-11 lg:px-8">
      <div className="flex h-full min-h-0 w-full max-w-[1320px] flex-col">
        <div className="mb-4 flex items-center text-sm text-muted-foreground">
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="-ml-2 inline-flex min-h-10 items-center gap-2 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft size={16} />
            <span>{t('projects.workspace.allProjects')}</span>
          </button>
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
              {loading ? t('common.loading') : displayProjectName}
            </h1>
          </div>

          <div className="hidden items-center gap-2 text-muted-foreground md:flex">
            <ProjectOpenWithControl cwd={projectCwd} />
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted"
              aria-label={t('common.actions.more')}
            >
              <span className="text-xl leading-none">⋮</span>
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="flex min-h-0 flex-col">
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
                placeholder={t('projects.workspace.inputPlaceholder')}
                className="min-h-[56px] max-h-[112px] w-full resize-none border-0 bg-transparent p-0 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground/90"
              />

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.focus()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    aria-label={t('projects.workspace.addFile')}
                  >
                    <Plus size={12} />
                    <span>{t('projects.workspace.addFile')}</span>
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
                    <span>{t('projects.workspace.send')}</span>
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
                    <p className="text-[0.98rem] font-medium text-foreground">{getProjectSessionLabel(t, session)}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {new Date(session.updated_at).toLocaleString(t('common.locale'), {
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
                      aria-label={t('common.actions.more')}
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
                        pendingLabel={t('common.processing')}
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
                  {t('projects.workspace.noSessions')}
                </div>
              ) : null}
            </div>
          </section>

          <aside className="min-w-0 lg:min-w-[280px]">
            <div className="space-y-1">
              <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_14px_38px_rgba(15,23,42,0.05)]">
                <PanelBlock
                  title={t('projects.workspace.panels.files')}
                  icon={<FilePlus2 size={18} />}
                  actionLabel={t('projects.workspace.panels.addFile')}
                  body={(
                    <div className="rounded-[20px] bg-muted/20 px-5 py-5 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-border bg-background text-muted-foreground">
                        <FolderKanban size={20} />
                      </div>
                      <p className="mx-auto mt-3 max-w-[220px] text-sm leading-6 text-muted-foreground">
                        {t('projects.workspace.panels.addFile')}
                      </p>
                    </div>
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
          title={t('sessions.delete.title')}
          disabled={deletingSessionId === confirmingSession.session_id}
          pending={deletingSessionId === confirmingSession.session_id}
          pendingLabel={t('common.processing')}
          onRequestConfirm={() => undefined}
          onCancel={() => setConfirmDeleteSessionId(null)}
          onConfirm={() => void handleDeleteProjectSession(confirmingSession.session_id)}
        />
      ) : null}
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
