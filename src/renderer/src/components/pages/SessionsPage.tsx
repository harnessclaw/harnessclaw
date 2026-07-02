import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Copy, FolderMinus, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProjectDisplayDescription, getProjectDisplayName } from '@/lib/projectDisplay'
import { ConfirmDeleteSessionDialog } from '../common/ConfirmDeleteSessionDialog'

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

/**
 * Pending destructive confirmation surfaced via ConfirmDeleteSessionDialog.
 * `single` deletes one session and reuses the dialog's default
 * "「{title}」的所有消息..." copy; `batch` deletes the current multi-select
 * and overrides the description to "所选的 X 条对话…".
 */
type PendingDeleteConfirm =
  | { kind: 'single'; sessionId: string; title: string }
  | { kind: 'batch'; count: number }

const FLOATING_MENU_WIDTH = 132
const FLOATING_MENU_HEIGHT = 120
const FLOATING_MENU_GAP = 6
const VIEWPORT_PADDING = 12

function getSessionLabel(title: string, sessionId: string, t: (key: string) => string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  return `${t('sessions.sessionLabel')} ${sessionId.slice(0, 8)}`
}

export function SessionsPage() {
  const { t, i18n } = useTranslation()
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
  const [deleteConfirm, setDeleteConfirm] = useState<PendingDeleteConfirm | null>(null)

  // 分页相关 state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)

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

  // 过滤 + 排序
  const filteredAndSortedSessions = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    let filtered = sessions

    if (keyword) {
      filtered = sessions.filter((session) => {
        const label = getSessionLabel(session.title, session.session_id, t).toLowerCase()
        return label.includes(keyword) || session.session_id.toLowerCase().includes(keyword)
      })
    }

    // 按更新时间倒序排列
    return filtered.sort((a, b) => {
      const timeA = new Date(a.updated_at || a.created_at).getTime()
      const timeB = new Date(b.updated_at || b.created_at).getTime()
      return timeB - timeA  // 倒序：最新的在前
    })
  }, [search, sessions, t])

  // 分页计算
  const totalCount = filteredAndSortedSessions.length
  const totalPages = Math.ceil(totalCount / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, totalCount)
  const paginatedSessions = filteredAndSortedSessions.slice(startIndex, endIndex)

  // 搜索时重置到第1页
  useEffect(() => {
    setCurrentPage(1)
  }, [search])

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
      `${index + 1}. ${getSessionLabel(session.title, session.session_id, t)}\nID: ${session.session_id}\n${t('sessions.header.session')}: ${session.messageCount} ${t('sessions.messageCount', { n: '' }).trim()}`
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
      <div className="flex h-full min-h-0 flex-col" style={{ paddingLeft: '38px', paddingRight: '38px', paddingTop: '46px', paddingBottom: '53px' }}>
        <div className="flex items-center justify-between gap-4" style={{ marginBottom: '20px' }}>
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t('sessions.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('sessions.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <input
                type="text"
                placeholder={t('sessions.searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-7 pl-9 pr-3 w-64 bg-background/50 border border-border rounded-[14px] text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>
            <button
              onClick={multiSelectMode ? exitMultiSelectMode : handleEnterMultiSelectMode}
              disabled={sessions.length === 0}
              className={cn(
                "flex items-center gap-1 px-3 h-7 rounded-[14px] text-sm font-medium transition-all",
                multiSelectMode
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-background/50 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                sessions.length === 0 && "cursor-not-allowed opacity-50"
              )}
            >
              {multiSelectMode ? (
                <>
                  <X className="h-4 w-4" />
                  {t('sessions.exitMultiSelect')}
                </>
              ) : (
                t('sessions.enterMultiSelect')
              )}
            </button>
            <button
              onClick={handleStartChat}
              className="flex items-center gap-1 bg-[#4E5969] text-white px-3 h-7 rounded-[14px] text-sm font-medium hover:opacity-90 transition-all active:scale-95 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              {t('sessions.newSession')}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">{t('sessions.loading')}</p>
          </div>
        ) : filteredAndSortedSessions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 rounded-full bg-accent/50 p-4">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                {search ? t('sessions.noMatch') : t('sessions.noHistory')}
              </h3>
              <p className="max-w-[280px] text-sm text-muted-foreground">
                {search ? t('sessions.noMatchDesc') : t('sessions.noHistoryDesc')}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
            {/* 表头 */}
            <div
              className={cn(
                'grid items-center font-medium',
                multiSelectMode
                  ? 'grid-cols-[52px_60px_minmax(0,0.5fr)_minmax(0,1.9fr)_140px_56px]'
                  : 'grid-cols-[60px_minmax(0,0.5fr)_minmax(0,1.9fr)_140px_56px]'
              )}
              style={{
                height: '48px',
                borderRadius: '10px 10px 0px 0px',
                paddingLeft: '20px',
                paddingRight: '32px',
                gap: '24px',
                background: 'rgba(226, 226, 226, 0.46)',
                borderBottom: '1px solid #F3F4F6',
                fontSize: '14px',
                lineHeight: '22px',
                color: 'rgba(0, 0, 0, 0.88)'
              }}
            >
              {multiSelectMode && <span className="text-center">{t('sessions.header.select')}</span>}
              <span>序号</span>
              <span>{t('sessions.header.project')}</span>
              <span>{multiSelectMode ? t('sessions.header.selectedSession') : t('sessions.header.session')}</span>
              <span>{t('sessions.header.lastUpdated')}</span>
              <span className="text-right">{t('sessions.header.actions')}</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {paginatedSessions.map((session, index) => {
                const isRenaming = renamingSessionId === session.session_id
                const isSelected = selectedSessionSet.has(session.session_id)
                const globalIndex = startIndex + index + 1  // 全局序号
                return (
                  <div
                    key={session.session_id}
                    ref={(el) => { if (el) sessionRowRefs.current.set(session.session_id, el); else sessionRowRefs.current.delete(session.session_id) }}
                    className={cn(
                      'relative grid px-4 py-2.5 transition-colors hover:bg-muted/20',
                      multiSelectMode
                        ? 'grid-cols-[52px_60px_minmax(0,0.5fr)_minmax(0,1.9fr)_140px_56px] select-none'
                        : 'grid-cols-[60px_minmax(0,0.5fr)_minmax(0,1.9fr)_140px_56px]',
                      multiSelectMode && isSelected && 'bg-accent/30'
                    )}
                    style={{
                      gap: '24px',
                      paddingLeft: '20px',
                      paddingRight: '32px',
                      height: '62px',
                      borderBottom: '1px solid #F3F4F6'
                    }}
                    onMouseDown={() => handleDragSelectStart(session.session_id)}
                    onMouseEnter={() => handleDragSelectMove(session.session_id)}
                  >
                    {multiSelectMode && (
                      <button
                        type="button"
                        onClick={() => toggleSessionSelection(session.session_id)}
                        className="absolute inset-y-0 left-0 z-10 w-[68px] rounded-l-lg"
                        aria-label={`${t('sessions.header.select')} ${getSessionLabel(session.title, session.session_id, t)}`}
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

                    {/* 序号列 */}
                    <div className="flex items-center" style={{ fontSize: '14px', lineHeight: '24px', color: '#111827' }}>
                      {globalIndex}
                    </div>

                    {/* 项目列 */}
                    <div className="flex items-center" style={{ fontSize: '14px', lineHeight: '24px' }}>
                      {session.project_id && projectMap.has(session.project_id) ? (
                        <span className="truncate" style={{ fontSize: '14px', color: '#111827' }}>
                          {projectMap.get(session.project_id)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40" style={{ fontSize: '14px' }}>—</span>
                      )}
                    </div>

                    {/* 对话列 */}
                    <button
                      onClick={() => {
                        if (multiSelectMode) {
                          toggleSessionSelection(session.session_id)
                          return
                        }

                        handleOpenChat(session.session_id)
                      }}
                      className="min-w-0 text-left flex items-center"
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
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 outline-none focus:border-primary"
                          style={{ fontSize: '14px', lineHeight: '24px' }}
                        />
                      ) : (
                        <p className="truncate" style={{ fontSize: '14px', lineHeight: '24px', color: '#111827', fontWeight: 'normal' }}>
                          {getSessionLabel(session.title, session.session_id, t)}
                        </p>
                      )}
                    </button>

                    {/* 更新时间列 */}
                    {multiSelectMode ? (
                      <button
                        type="button"
                        onClick={() => toggleSessionSelection(session.session_id)}
                        className="flex h-full w-full items-center rounded-lg text-left text-muted-foreground transition-colors hover:bg-accent/60"
                        style={{ fontSize: '14px', lineHeight: '24px' }}
                        aria-label={t('sessions.multiSelect.ariaTimeRegion', { name: getSessionLabel(session.title, session.session_id, t) })}
                      >
                        {new Date(session.updated_at).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).replace(/\//g, '-').replace(',', '')}
                      </button>
                    ) : (
                      <div className="flex items-center text-muted-foreground" style={{ fontSize: '14px', lineHeight: '24px' }}>
                        {new Date(session.updated_at).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).replace(/\//g, '-').replace(',', '')}
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
                        aria-label={t('sessions.actions.more')}
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
                    <span className="font-medium">{t('sessions.multiSelect.selectedCount', { n: selectedCount })}</span>
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
                    aria-label={t('sessions.multiSelect.copyTooltip')}
                    title={t('sessions.multiSelect.copy')}
                  >
                    <Copy size={14} />
                    {t('sessions.multiSelect.copy')}
                  </button>
                  <button
                    onClick={() => {
                      if (selectedCount === 0) return
                      setDeleteConfirm({ kind: 'batch', count: selectedCount })
                    }}
                    disabled={selectedCount === 0}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                      selectedCount === 0
                        ? 'cursor-not-allowed border-border text-muted-foreground opacity-50'
                        : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/30'
                    )}
                    aria-label={t('sessions.multiSelect.deleteTooltip')}
                    title={t('sessions.multiSelect.delete')}
                  >
                    <Trash2 size={14} />
                    {t('sessions.multiSelect.delete')}
                  </button>
                  <button
                    onClick={exitMultiSelectMode}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={t('sessions.multiSelect.closeTooltip')}
                    title={t('sessions.multiSelect.close')}
                  >
                    <X size={16} />
                  </button>
                  </div>
                </div>
              </div>
            )}
            </div>

            {/* 分页控件（独立于卡片，无分割线） */}
            {!loading && filteredAndSortedSessions.length > 0 && (
              <div className="flex h-8 items-center justify-between px-2">
                {/* 左侧：总条数 */}
                <div className="text-sm text-muted-foreground">
                  共{totalCount}条
                </div>

                {/* 中间：页码按钮（32×32，无边框，圆角 4px，选中灰底，无间距） */}
                <div className="flex items-center">
                  {/* 上一页 */}
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded text-sm transition-colors',
                      currentPage === 1
                        ? 'cursor-not-allowed text-muted-foreground/50'
                        : 'text-foreground hover:bg-accent'
                    )}
                  >
                    ‹
                  </button>

                  {/* 页码按钮 */}
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) {
                      pageNum = i + 1
                    } else if (currentPage <= 3) {
                      pageNum = i + 1
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i
                    } else {
                      pageNum = currentPage - 2 + i
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={cn(
                          'inline-flex h-8 w-8 items-center justify-center rounded text-sm transition-colors',
                          currentPage === pageNum
                            ? 'bg-[rgba(226,226,226,0.46)] text-foreground font-medium'
                            : 'text-foreground hover:bg-accent'
                        )}
                      >
                        {pageNum}
                      </button>
                    )
                  })}

                  {/* 省略号 + 最后一页 */}
                  {totalPages > 5 && currentPage < totalPages - 2 && (
                    <>
                      <span className="inline-flex h-8 w-8 items-center justify-center text-sm text-muted-foreground">...</span>
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded text-sm text-foreground transition-colors hover:bg-accent"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}

                  {/* 下一页 */}
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded text-sm transition-colors',
                      currentPage === totalPages
                        ? 'cursor-not-allowed text-muted-foreground/50'
                        : 'text-foreground hover:bg-accent'
                    )}
                  >
                    ›
                  </button>
                </div>

                {/* 右侧：每页条数选择 */}
                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value))
                      setCurrentPage(1)  // 切换每页条数时重置到第1页
                    }}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value={5}>5条/页</option>
                    <option value={10}>10条/页</option>
                    <option value={20}>20条/页</option>
                    <option value={50}>50条/页</option>
                  </select>
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
              setRenameValue(getSessionLabel(activeMenuSession.title, activeMenuSession.session_id, t))
              setMenuState(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Pencil size={14} />
            {t('sessions.actions.rename')}
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
              {t('sessions.actions.exitProject')}
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
              {t('sessions.actions.joinProject')}
            </button>
          )}
          <button
            onClick={() => {
              setDeleteConfirm({
                kind: 'single',
                sessionId: activeMenuSession.session_id,
                title: getSessionLabel(activeMenuSession.title, activeMenuSession.session_id, t),
              })
              setMenuState(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <Trash2 size={14} />
            {t('sessions.actions.delete')}
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
              <h3 className="mb-1 text-base font-semibold text-foreground">{t('sessions.assignProject.title')}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{t('sessions.assignProject.subtitle')}</p>

              {projects.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('sessions.assignProject.noProjects')}</p>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-border">
                  {projects.map((project) => {
                    const isCurrentProject = sessions.find((s) => s.session_id === assignDialog.sessionId)?.project_id === project.project_id
                    const displayName = getProjectDisplayName(project, t)
                    const displayDescription = getProjectDisplayDescription(project, t)
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
                          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                          {displayDescription && (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{displayDescription}</p>
                          )}
                        </div>
                        {isCurrentProject && (
                          <span className="mt-0.5 shrink-0 text-xs text-primary">{t('sessions.assignProject.current')}</span>
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

      <ConfirmDeleteSessionDialog
        open={deleteConfirm !== null}
        title={deleteConfirm?.kind === 'single' ? deleteConfirm.title : undefined}
        description={
          deleteConfirm?.kind === 'batch'
            ? t('sessions.multiSelect.deleteConfirm', { n: deleteConfirm.count })
            : undefined
        }
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (!deleteConfirm) return
          if (deleteConfirm.kind === 'single') {
            const sessionId = deleteConfirm.sessionId
            setDeleteConfirm(null)
            void handleDeleteSession(sessionId)
          } else {
            setDeleteConfirm(null)
            void handleDeleteSelectedSessions()
          }
        }}
      />
    </>
  )
}
