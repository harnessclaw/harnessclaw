import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CheckSquare, Copy, FolderMinus, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SessionRow extends DbSessionRow {
  messageCount: number
}

interface FloatingMenuState {
  sessionId: string
  top: number
  left: number
}

interface AssignProjectDialogState {
  sessionId: string
}

const FLOATING_MENU_WIDTH = 132
const FLOATING_MENU_HEIGHT = 120
const FLOATING_MENU_GAP = 6
const VIEWPORT_PADDING = 12

function getSessionLabel(title: string, sessionId: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  return `对话 ${sessionId.slice(0, 8)}`
}

export function SessionsPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [menuState, setMenuState] = useState<FloatingMenuState | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [projects, setProjects] = useState<DbProjectRow[]>([])
  const [assignDialog, setAssignDialog] = useState<AssignProjectDialogState | null>(null)
  const skipNextReloadCountRef = useRef(0)
  const floatingMenuRef = useRef<HTMLDivElement | null>(null)
  const dragSelectRef = useRef<{ active: boolean; adding: boolean; visited: Set<string> }>({ active: false, adding: true, visited: new Set() })
  const sessionRowRefs = useRef<Map<string, HTMLElement>>(new Map())

  const exitMultiSelectMode = () => {
    setMultiSelectMode(false)
    setSelectedSessionIds([])
    setMenuState(null)
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const loadSessions = async () => {
    setLoading(true)
    try {
      const rows = await window.db.listSessions()
      const rowsWithCounts = await Promise.all(
        rows.map(async (row) => {
          const messages = await window.db.getMessages(row.session_id)
          const messageCount = messages.filter((message) => message.role !== 'system').length
          return { ...row, messageCount }
        })
      )
      setSessions(rowsWithCounts)
    } finally {
      setLoading(false)
    }
  }

  const loadProjects = async () => {
    try {
      const rows = await window.db.listProjects()
      setProjects(rows)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadSessions()
    void loadProjects()
  }, [])

  useEffect(() => {
    const offSessionsChanged = window.db.onSessionsChanged(() => {
      if (skipNextReloadCountRef.current > 0) {
        skipNextReloadCountRef.current -= 1
        return
      }
      void loadSessions()
    })
    return () => offSessionsChanged()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (multiSelectMode) {
          exitMultiSelectMode()
          return
        }
        setMenuState(null)
        setRenamingSessionId(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [multiSelectMode])

  useEffect(() => {
    if (!menuState) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (floatingMenuRef.current?.contains(target)) return
      setMenuState(null)
    }

    const handleViewportChange = () => {
      setMenuState(null)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [menuState])

  const filteredSessions = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((session) => {
      const label = getSessionLabel(session.title, session.session_id).toLowerCase()
      return label.includes(keyword) || session.session_id.toLowerCase().includes(keyword)
    })
  }, [search, sessions])

  const projectMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.project_id, p.name)
    return map
  }, [projects])

  const selectedSessionSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds])
  const selectedCount = selectedSessionIds.length

  useEffect(() => {
    setSelectedSessionIds((prev) => prev.filter((sessionId) => sessions.some((session) => session.session_id === sessionId)))
  }, [sessions])

  const handleStartChat = () => {
    navigate('/chat', { state: { createSession: true } })
  }

  const handleOpenChat = (sessionId: string) => {
    navigate('/chat', { state: { sessionId } })
  }

  const handleDeleteSession = async (sessionId: string) => {
    skipNextReloadCountRef.current += 1
    const result = await window.db.deleteSession(sessionId)
    if (!result.ok) {
      skipNextReloadCountRef.current = Math.max(0, skipNextReloadCountRef.current - 1)
      return
    }
    setSessions((prev) => prev.filter((session) => session.session_id !== sessionId))
    setSelectedSessionIds((prev) => prev.filter((id) => id !== sessionId))
    setMenuState(null)
    if (renamingSessionId === sessionId) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }

  const handleRenameSession = async (sessionId: string) => {
    const nextTitle = renameValue.trim()
    if (!nextTitle) {
      setRenamingSessionId(null)
      setRenameValue('')
      return
    }

    skipNextReloadCountRef.current += 1
    const result = await window.db.updateSessionTitle(sessionId, nextTitle)
    if (!result.ok) {
      skipNextReloadCountRef.current = Math.max(0, skipNextReloadCountRef.current - 1)
      return
    }

    setSessions((prev) => prev.map((session) => (
      session.session_id === sessionId
        ? { ...session, title: nextTitle, updated_at: Date.now() }
        : session
    )))
    setRenamingSessionId(null)
    setRenameValue('')
    setMenuState(null)
  }

  const handleAssignProject = async (sessionId: string, projectId: string | null) => {
    skipNextReloadCountRef.current += 1
    const result = await window.db.updateSessionProject(sessionId, projectId)
    if (!result.ok) {
      skipNextReloadCountRef.current = Math.max(0, skipNextReloadCountRef.current - 1)
      return
    }
    setSessions((prev) => prev.map((session) => (
      session.session_id === sessionId
        ? { ...session, project_id: projectId, updated_at: Date.now() }
        : session
    )))
    setAssignDialog(null)
  }

  const getFloatingMenuPosition = (rect: DOMRect): { top: number; left: number } => {
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - FLOATING_MENU_WIDTH - VIEWPORT_PADDING)
    const preferredLeft = rect.right - FLOATING_MENU_WIDTH
    const left = Math.min(Math.max(VIEWPORT_PADDING, preferredLeft), maxLeft)

    const preferredTop = rect.bottom + FLOATING_MENU_GAP
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - FLOATING_MENU_HEIGHT - VIEWPORT_PADDING)
    const fallbackTop = rect.top - FLOATING_MENU_HEIGHT - FLOATING_MENU_GAP
    const top = preferredTop <= maxTop ? preferredTop : Math.max(VIEWPORT_PADDING, fallbackTop)

    return { top, left }
  }

  const activeMenuSession = menuState
    ? sessions.find((session) => session.session_id === menuState.sessionId) ?? null
    : null

  const handleEnterMultiSelectMode = () => {
    setMultiSelectMode(true)
    setSelectedSessionIds([])
    setMenuState(null)
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const toggleSessionSelection = (sessionId: string) => {
    setSelectedSessionIds((prev) => (
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId]
    ))
  }

  const handleDragSelectStart = useCallback((sessionId: string) => {
    if (!multiSelectMode) return
    const adding = !selectedSessionSet.has(sessionId)
    // Only prepare — don't toggle yet. The first item is toggled by the
    // existing onClick handler. If the user drags into another row,
    // mouseenter will retroactively toggle the origin row too.
    dragSelectRef.current = { active: true, adding, visited: new Set([sessionId]) }
  }, [multiSelectMode, selectedSessionSet])

  const handleDragSelectMove = useCallback((sessionId: string) => {
    const drag = dragSelectRef.current
    if (!drag.active) return
    // On the first move into a second row, also apply the toggle to the
    // origin row (which the click handler would have toggled, but since
    // we're now dragging, the click won't fire on the origin).
    if (drag.visited.size === 1) {
      const originId = drag.visited.values().next().value as string
      setSelectedSessionIds((prev) =>
        drag.adding
          ? prev.includes(originId) ? prev : [...prev, originId]
          : prev.filter((id) => id !== originId)
      )
    }
    if (drag.visited.has(sessionId)) return
    drag.visited.add(sessionId)
    setSelectedSessionIds((prev) =>
      drag.adding
        ? prev.includes(sessionId) ? prev : [...prev, sessionId]
        : prev.filter((id) => id !== sessionId)
    )
  }, [])

  useEffect(() => {
    const handleMouseUp = () => { dragSelectRef.current.active = false }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const handleCopySelectedSessions = async () => {
    const selectedSessions = sessions.filter((session) => selectedSessionSet.has(session.session_id))
    if (selectedSessions.length === 0) return

    const text = selectedSessions.map((session, index) => (
      `${index + 1}. ${getSessionLabel(session.title, session.session_id)}\nID: ${session.session_id}\n消息: ${session.messageCount} 条`
    )).join('\n\n')

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard writes can fail on unsupported platforms or denied permissions.
    }
  }

  const handleDeleteSelectedSessions = async () => {
    if (selectedSessionIds.length === 0) return

    const targetIds = [...selectedSessionIds]
    skipNextReloadCountRef.current += targetIds.length
    const results = await Promise.all(targetIds.map(async (sessionId) => ({
      sessionId,
      result: await window.db.deleteSession(sessionId),
    })))

    const deletedIds = results.filter(({ result }) => result.ok).map(({ sessionId }) => sessionId)
    const failedCount = results.length - deletedIds.length

    if (failedCount > 0) {
      skipNextReloadCountRef.current = Math.max(0, skipNextReloadCountRef.current - failedCount)
    }

    if (deletedIds.length === 0) return

    const deletedSet = new Set(deletedIds)
    setSessions((prev) => prev.filter((session) => !deletedSet.has(session.session_id)))
    setSelectedSessionIds((prev) => prev.filter((id) => !deletedSet.has(id)))
    setMenuState((prev) => (prev && deletedSet.has(prev.sessionId) ? null : prev))

    if (renamingSessionId && deletedSet.has(renamingSessionId)) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col px-6 pt-6 pb-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">对话</h2>
            <p className="mt-1 text-sm text-muted-foreground">查看历史会话，或继续最近的上下文。</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索对话..."
                className="w-52 rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none transition-colors focus:border-primary"
              />
            </div>
            <button
              onClick={multiSelectMode ? exitMultiSelectMode : handleEnterMultiSelectMode}
              disabled={sessions.length === 0}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-medium transition-colors',
                multiSelectMode
                  ? 'border-foreground/10 bg-accent text-foreground hover:bg-accent/80'
                  : 'border-border bg-background text-foreground hover:bg-accent',
                sessions.length === 0 && 'cursor-not-allowed opacity-50'
              )}
              aria-label={multiSelectMode ? '退出多选' : '选择多个'}
              title={multiSelectMode ? '退出多选' : '选择多个'}
            >
              <CheckSquare size={14} />
            </button>
            <button
              onClick={handleStartChat}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 dark:bg-primary dark:text-primary-foreground"
            >
              <Plus size={14} />
              新建对话
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                <MessageSquare size={20} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-foreground">
                {sessions.length === 0 ? '还没有对话记录' : '没有匹配的对话'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {sessions.length === 0 ? '开始一次新的对话后，这里会出现历史记录。' : '换个关键词再试试。'}
              </p>
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <div
              className={cn(
                'grid gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground',
                multiSelectMode
                  ? 'grid-cols-[52px_minmax(0,1.6fr)_minmax(0,0.8fr)_140px_56px]'
                  : 'grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_140px_56px]'
              )}
            >
              {multiSelectMode && <span className="text-center">选择</span>}
              <span>{multiSelectMode ? '已选对话' : '对话'}</span>
              <span>项目</span>
              <span>最近更新</span>
              <span className="text-right">操作</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border">
              {filteredSessions.map((session) => {
                const isRenaming = renamingSessionId === session.session_id
                const isSelected = selectedSessionSet.has(session.session_id)
                return (
                  <div
                    key={session.session_id}
                    ref={(el) => { if (el) sessionRowRefs.current.set(session.session_id, el); else sessionRowRefs.current.delete(session.session_id) }}
                    className={cn(
                      'relative grid gap-4 px-4 py-2.5 transition-colors hover:bg-muted/20',
                      multiSelectMode
                        ? 'grid-cols-[52px_minmax(0,1.6fr)_minmax(0,0.8fr)_140px_56px] select-none'
                        : 'grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_140px_56px]',
                      multiSelectMode && isSelected && 'bg-accent/30'
                    )}
                    onMouseDown={() => handleDragSelectStart(session.session_id)}
                    onMouseEnter={() => handleDragSelectMove(session.session_id)}
                  >
                    {multiSelectMode && (
                      <button
                        type="button"
                        onClick={() => toggleSessionSelection(session.session_id)}
                        className="absolute inset-y-0 left-0 z-10 w-[68px] rounded-l-lg"
                        aria-label={`选择 ${getSessionLabel(session.title, session.session_id)}`}
                      />
                    )}

                    {multiSelectMode && (
                      <div className="pointer-events-none flex h-full w-full items-center justify-center rounded-lg">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="h-5 w-5 rounded border-border text-primary focus:ring-primary"
                          tabIndex={-1}
                          aria-hidden="true"
                        />
                      </div>
                    )}

                    <button
                      onClick={() => {
                        if (multiSelectMode) {
                          toggleSessionSelection(session.session_id)
                          return
                        }

                        handleOpenChat(session.session_id)
                      }}
                      className="min-w-0 text-left"
                    >
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => void handleRenameSession(session.session_id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void handleRenameSession(session.session_id)
                            }
                            if (event.key === 'Escape') {
                              setRenamingSessionId(null)
                              setRenameValue('')
                            }
                          }}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium text-foreground">
                            {getSessionLabel(session.title, session.session_id)}
                          </p>
                          <div className="mt-0.5 flex items-center text-xs text-muted-foreground">
                            <span>{session.messageCount} 条消息</span>
                          </div>
                        </>
                      )}
                    </button>

                    <div className="flex items-center">
                      {session.project_id && projectMap.has(session.project_id) ? (
                        <span className="truncate rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                          {projectMap.get(session.project_id)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </div>

                    {multiSelectMode ? (
                      <button
                        type="button"
                        onClick={() => toggleSessionSelection(session.session_id)}
                        className="flex h-full w-full items-center rounded-lg text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60"
                        aria-label={`选择 ${getSessionLabel(session.title, session.session_id)} 的时间区域`}
                      >
                        {new Date(session.updated_at).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </button>
                    ) : (
                      <div className="flex items-center text-xs text-muted-foreground">
                        {new Date(session.updated_at).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}

                    <div className="relative flex items-center justify-end">
                      <button
                        disabled={multiSelectMode}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          const nextPosition = getFloatingMenuPosition(rect)
                          setMenuState((prev) => prev?.sessionId === session.session_id
                            ? null
                            : {
                                sessionId: session.session_id,
                                top: nextPosition.top,
                                left: nextPosition.left,
                              })
                        }}
                        className={cn(
                          'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
                          multiSelectMode
                            ? 'cursor-not-allowed opacity-35'
                            : 'hover:bg-accent hover:text-foreground'
                        )}
                        aria-label="更多操作"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {multiSelectMode && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4">
                <div className="pointer-events-auto flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)]">
                  <div className="text-sm text-foreground">
                    <span className="font-medium">已选择 {selectedCount} 个对话</span>
                  </div>

                  <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleCopySelectedSessions()}
                    disabled={selectedCount === 0}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      selectedCount === 0
                        ? 'cursor-not-allowed border-border text-muted-foreground opacity-50'
                        : 'border-border bg-background text-foreground hover:bg-accent'
                    )}
                    aria-label="复制所选对话"
                    title="复制"
                  >
                    <Copy size={14} />
                    复制
                  </button>
                  <button
                    onClick={() => void handleDeleteSelectedSessions()}
                    disabled={selectedCount === 0}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      selectedCount === 0
                        ? 'cursor-not-allowed border-border text-muted-foreground opacity-50'
                        : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/30'
                    )}
                    aria-label="删除所选对话"
                    title="删除"
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                  <button
                    onClick={exitMultiSelectMode}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="关闭多选模式"
                    title="关闭"
                  >
                    <X size={16} />
                  </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {menuState && activeMenuSession && createPortal(
        <div
          ref={floatingMenuRef}
          className="fixed z-[80] min-w-[120px] rounded-xl border border-border bg-card p-1 shadow-lg"
          style={{ top: menuState.top, left: menuState.left }}
        >
          <button
            onClick={() => {
              setRenamingSessionId(activeMenuSession.session_id)
              setRenameValue(getSessionLabel(activeMenuSession.title, activeMenuSession.session_id))
              setMenuState(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Pencil size={14} />
            重命名
          </button>
          {activeMenuSession.project_id ? (
            <button
              onClick={() => {
                void handleAssignProject(activeMenuSession.session_id, null)
                setMenuState(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <FolderMinus size={14} />
              退出项目
            </button>
          ) : (
            <button
              onClick={() => {
                setAssignDialog({ sessionId: activeMenuSession.session_id })
                setMenuState(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <FolderPlus size={14} />
              加入项目
            </button>
          )}
          <button
            onClick={() => void handleDeleteSession(activeMenuSession.session_id)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>,
        document.body
      )}

      {assignDialog && createPortal(
        <div className="fixed inset-0 z-[90]">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'brightness(0.75)' }}
            onClick={() => setAssignDialog(null)}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
              <h3 className="mb-1 text-base font-semibold text-foreground">加入项目</h3>
              <p className="mb-3 text-xs text-muted-foreground">选择要将此对话归入的项目</p>

              {projects.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">暂无可用项目</p>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-border">
                  {projects.map((project) => {
                    const isCurrentProject = sessions.find((s) => s.session_id === assignDialog.sessionId)?.project_id === project.project_id
                    return (
                      <button
                        key={project.project_id}
                        onClick={() => void handleAssignProject(
                          assignDialog.sessionId,
                          isCurrentProject ? null : project.project_id,
                        )}
                        className={cn(
                          'flex w-full items-start gap-3 border-b border-border px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/60',
                          isCurrentProject && 'bg-accent'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
                          {project.description && (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{project.description}</p>
                          )}
                        </div>
                        {isCurrentProject && (
                          <span className="mt-0.5 shrink-0 text-xs text-primary">当前</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
