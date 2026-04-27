import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  House,
  Zap,
  Puzzle,
  Search,
  FolderKanban,
  FolderMinus,
  FolderPlus,
  Users,
  Settings,
  Moon,
  Sun,
  PanelLeft,
  MessageSquareText,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'
import sidebarLogo from '../../assets/sidebar-logo.png'

interface NavItem {
  icon: React.ElementType
  path: string
  label: string
}

interface NavGroup {
  items: NavItem[]
}

interface RecentSessionItem {
  session_id: string
  title: string
  project_id?: string | null
  updated_at: number
}

interface FloatingMenuState {
  sessionId: string
  top: number
  left: number
}

interface SearchResultItem {
  id: string
  type: 'action' | 'recent'
  label: string
  description?: string
  onSelect: () => void
}

interface AssignProjectDialogState {
  sessionId: string
}

const navGroups: NavGroup[] = [
  {
    items: [
      { icon: House, path: '/', label: '首页' },
      { icon: Puzzle, path: '/skills', label: '技能' },
    ],
  },
  {
    items: [
      { icon: Zap, path: '/sessions', label: '对话' },
      { icon: FolderKanban, path: '/projects', label: '项目' },
      { icon: Users, path: '/team', label: 'Team' },
    ],
  },
]

const isMac = navigator.platform.toUpperCase().includes('MAC')
const RECENT_WINDOW_SIZE = 8
const FLOATING_MENU_WIDTH = 132
const FLOATING_MENU_HEIGHT = 120
const FLOATING_MENU_GAP = 6
const VIEWPORT_PADDING = 12

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const harnessclawStatus = useHarnessclawStatus()
  const selectedRecentSessionId = typeof location.state?.sessionId === 'string' ? location.state.sessionId : ''
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sidebar-expanded') === 'true')
  const [recentExpanded, setRecentExpanded] = useState(() => localStorage.getItem('sidebar-recent-expanded') !== 'false')
  const [recentSessions, setRecentSessions] = useState<RecentSessionItem[]>([])
  const [menuState, setMenuState] = useState<FloatingMenuState | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActiveIndex, setSearchActiveIndex] = useState(0)
  const [recentWindowStart, setRecentWindowStart] = useState(0)
  const [recentScrollFade, setRecentScrollFade] = useState({ top: false, bottom: false })
  const [projects, setProjects] = useState<DbProjectRow[]>([])
  const [assignDialog, setAssignDialog] = useState<AssignProjectDialogState | null>(null)
  const [logoPreview, setLogoPreview] = useState(false)
  const floatingMenuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const recentScrollRef = useRef<HTMLDivElement | null>(null)
  const skipNextRecentReloadRef = useRef(0)
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme')
    if (saved) {
      const dark = saved === 'dark'
      document.documentElement.classList.toggle('dark', dark)
      return dark
    }
    return document.documentElement.classList.contains('dark')
  })

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  const toggleExpanded = () => {
    const next = !expanded
    setExpanded(next)
    localStorage.setItem('sidebar-expanded', String(next))
  }

  const toggleRecentExpanded = () => {
    const next = !recentExpanded
    setRecentExpanded(next)
    localStorage.setItem('sidebar-recent-expanded', String(next))
  }

  const openSearch = () => {
    setSearchOpen(true)
    setSearchQuery('')
    setSearchActiveIndex(0)
    setRecentWindowStart(0)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchActiveIndex(0)
    setRecentWindowStart(0)
  }

  useEffect(() => {
    let active = true

    const loadRecentSessions = async () => {
      try {
        const rows = await window.db.listSessions()
        if (!active) return
        setRecentSessions(rows)
      } catch {
        if (!active) return
        setRecentSessions([])
      }
    }

    const loadProjects = async () => {
      try {
        const rows = await window.db.listProjects()
        if (!active) return
        setProjects(rows)
      } catch {
        // ignore
      }
    }

    void loadRecentSessions()
    void loadProjects()
    const offSessionsChanged = window.db.onSessionsChanged(() => {
      if (skipNextRecentReloadRef.current > 0) {
        skipNextRecentReloadRef.current -= 1
        return
      }
      void loadRecentSessions()
    })

    return () => {
      active = false
      offSessionsChanged()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((prev) => {
          const next = !prev
          if (next) {
            setSearchQuery('')
            setSearchActiveIndex(0)
          }
          return next
        })
        return
      }

      if (event.key === 'Escape') {
        setMenuState(null)
        setRenamingSessionId(null)
        setRenameValue('')
        setLogoPreview(false)
        closeSearch()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen])

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

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    if (path === '/sessions') return location.pathname.startsWith(path)
    return location.pathname.startsWith(path)
  }

  const recentItems = useMemo(() => {
    return recentSessions.map((session) => ({
      id: session.session_id,
      title: session.title,
      updatedAt: session.updated_at,
      label: session.title.trim() || '未命名对话',
    }))
  }, [recentSessions])

  const handleOpenRecentSession = (sessionId: string) => {
    closeSearch()
    navigate('/chat', { state: { sessionId } })
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

  const handleDeleteRecentSession = async (sessionId: string) => {
    skipNextRecentReloadRef.current += 1
    const result = await window.db.deleteSession(sessionId)
    if (!result.ok) {
      skipNextRecentReloadRef.current = Math.max(0, skipNextRecentReloadRef.current - 1)
      return
    }

    setRecentSessions((prev) => prev.filter((session) => session.session_id !== sessionId))
    setMenuState(null)
    if (renamingSessionId === sessionId) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }

  const handleRenameRecentSession = async (sessionId: string) => {
    const nextTitle = renameValue.trim()
    if (!nextTitle) {
      setRenamingSessionId(null)
      setRenameValue('')
      return
    }

    skipNextRecentReloadRef.current += 1
    const result = await window.db.updateSessionTitle(sessionId, nextTitle)
    if (!result.ok) {
      skipNextRecentReloadRef.current = Math.max(0, skipNextRecentReloadRef.current - 1)
      return
    }

    setRecentSessions((prev) => prev.map((session) => (
      session.session_id === sessionId
        ? { ...session, title: nextTitle, updated_at: Date.now() }
        : session
    )))
    setMenuState(null)
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const handleAssignProject = async (sessionId: string, projectId: string | null) => {
    skipNextRecentReloadRef.current += 1
    const result = await window.db.updateSessionProject(sessionId, projectId)
    if (!result.ok) {
      skipNextRecentReloadRef.current = Math.max(0, skipNextRecentReloadRef.current - 1)
      return
    }
    setAssignDialog(null)
  }

  const itemCls = (active: boolean) => cn(
    'flex items-center rounded-lg transition-colors flex-shrink-0',
    expanded ? 'w-full gap-1.5 px-3 py-2' : 'w-11 h-11 justify-center',
    active
      ? 'bg-accent text-foreground'
      : 'text-foreground/78 hover:text-foreground hover:bg-accent'
  )

  const bottomItemCls = cn(
    'flex items-center rounded-lg transition-colors text-foreground/78 hover:text-foreground hover:bg-accent',
    expanded ? 'w-full gap-3 px-3 py-2' : 'w-11 h-11 justify-center'
  )

  const activeMenuItem = menuState
    ? recentItems.find((item) => item.id === menuState.sessionId) || null
    : null

  const searchKeyword = searchQuery.trim().toLowerCase()
  const quickActions = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [
      {
        id: 'new-session',
        type: 'action',
        label: '新建会话',
        description: '跳转到首页，直接开始输入新的任务。',
        onSelect: () => {
          closeSearch()
          navigate('/', { state: { focusComposer: true } })
        },
      },
    ]

    if (!searchKeyword) return items
    return items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(searchKeyword))
  }, [navigate, searchKeyword])

  const recentSearchItems = useMemo<SearchResultItem[]>(() => {
    const filtered = recentItems.filter((item) => {
      if (!searchKeyword) return true
      return item.label.toLowerCase().includes(searchKeyword) || item.id.toLowerCase().includes(searchKeyword)
    })

    return filtered.map((item) => ({
      id: item.id,
      type: 'recent',
      label: item.label,
      onSelect: () => handleOpenRecentSession(item.id),
    }))
  }, [recentItems, searchKeyword])

  const maxRecentWindowStart = Math.max(recentSearchItems.length - RECENT_WINDOW_SIZE, 0)
  const visibleRecentSearchItems = useMemo(
    () => recentSearchItems.slice(recentWindowStart, recentWindowStart + RECENT_WINDOW_SIZE),
    [recentSearchItems, recentWindowStart],
  )
  const quickActionCount = quickActions.length

  const searchResults = useMemo(
    () => [...quickActions, ...visibleRecentSearchItems],
    [quickActions, visibleRecentSearchItems],
  )

  useEffect(() => {
    setSearchActiveIndex(0)
    setRecentWindowStart(0)
  }, [searchKeyword, searchOpen])

  useEffect(() => {
    if (searchActiveIndex < searchResults.length) return
    setSearchActiveIndex(Math.max(searchResults.length - 1, 0))
  }, [searchActiveIndex, searchResults.length])

  useEffect(() => {
    if (recentWindowStart <= maxRecentWindowStart) return
    setRecentWindowStart(maxRecentWindowStart)
  }, [maxRecentWindowStart, recentWindowStart])

  useEffect(() => {
    const container = recentScrollRef.current
    if (!container || !expanded || !recentExpanded) {
      setRecentScrollFade({ top: false, bottom: false })
      return
    }

    const updateRecentScrollFade = () => {
      const canScroll = container.scrollHeight - container.clientHeight > 6
      if (!canScroll) {
        setRecentScrollFade({ top: false, bottom: false })
        return
      }

      const top = container.scrollTop > 6
      const bottom = container.scrollTop + container.clientHeight < container.scrollHeight - 6
      setRecentScrollFade({ top, bottom })
    }

    updateRecentScrollFade()

    const observer = new ResizeObserver(() => {
      updateRecentScrollFade()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [expanded, recentExpanded, recentItems.length])

  const renderSearchButton = () => (
    <button
      onClick={openSearch}
      title={expanded ? undefined : '搜索'}
      aria-label={expanded ? undefined : '搜索'}
      className={itemCls(searchOpen)}
    >
      <Search size={18} className="flex-shrink-0" aria-hidden="true" />
      {expanded && (
        <>
          <span className="flex-1 text-left text-sm font-medium">搜索</span>
          <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {isMac ? '⌘K' : 'Win+K'}
          </span>
        </>
      )}
    </button>
  )

  const searchItemCls = (active: boolean, compact = false) => cn(
    'flex w-full items-center justify-between rounded-2xl border text-left transition-colors',
    compact ? 'px-3 py-2' : 'px-3 py-3',
    active
      ? 'border-slate-300 bg-slate-200 text-slate-950 dark:border-slate-600 dark:bg-slate-700'
      : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-900/70'
  )

  return (
    <>
      <nav
        aria-label="主导航"
        className={cn(
          'flex-shrink-0 bg-card border-r border-border flex flex-col pt-[44px] pb-3 select-none transition-[width] duration-200 overflow-hidden',
          expanded ? 'w-72 items-start px-2' : 'w-[78px] items-center'
        )}
      >
        <div className={cn('flex min-h-0 w-full flex-1 flex-col', !expanded && 'items-center')}>
          <div className={cn('flex w-full flex-col flex-shrink-0', expanded ? 'gap-4' : 'items-center gap-4')}>
            <div className={cn('flex w-full flex-shrink-0', expanded ? 'px-1' : 'justify-center')}>
              {expanded ? (
                <div className="flex w-full items-center gap-2 px-2 py-1">
                  <div className="min-w-0 flex flex-1 items-center gap-2">
                    <img
                      src={sidebarLogo}
                      alt="HarnessClaw"
                      className="h-9 w-9 flex-shrink-0 cursor-pointer object-contain transition-opacity hover:opacity-80"
                      onClick={() => setLogoPreview(true)}
                    />
                  </div>

                  <div
                    className="group relative flex h-8 w-5 flex-shrink-0 items-center justify-center"
                    aria-label={
                      harnessclawStatus === 'connected'
                        ? '当前状态：已连接'
                        : harnessclawStatus === 'connecting'
                          ? '当前状态：连接中'
                          : '当前状态：未连接'
                    }
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        harnessclawStatus === 'connected'
                          ? 'bg-emerald-500'
                          : harnessclawStatus === 'connecting'
                            ? 'bg-amber-500 animate-pulse'
                            : 'bg-rose-500'
                      )}
                      aria-hidden="true"
                    />
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md group-hover:block">
                      {harnessclawStatus === 'connected'
                        ? '已连接'
                        : harnessclawStatus === 'connecting'
                          ? '连接中'
                          : '未连接'}
                    </span>
                  </div>

                  <button
                    onClick={toggleExpanded}
                    title="收起侧边栏"
                    aria-label="收起侧边栏"
                    className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-foreground/78 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <PanelLeft size={18} className="rotate-180" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={toggleExpanded}
                  title="展开侧边栏"
                  aria-label="展开侧边栏"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground/78 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <PanelLeft size={18} aria-hidden="true" />
                </button>
              )}
            </div>

            {navGroups.map((group, index) => (
              <div
                key={index}
                className={cn('flex w-full flex-col gap-1', !expanded && 'items-center')}
              >
                {group.items.map((item) => (
                  <div key={item.path} className={cn('flex w-full flex-col gap-1', !expanded && 'items-center')}>
                    <button
                      onClick={() => navigate(item.path)}
                      title={expanded ? undefined : item.label}
                      aria-label={expanded ? undefined : item.label}
                      aria-current={isActive(item.path) ? 'page' : undefined}
                      className={itemCls(isActive(item.path))}
                    >
                      <item.icon size={18} className="flex-shrink-0" aria-hidden="true" />
                      {expanded && <span className="text-sm font-medium">{item.label}</span>}
                    </button>
                    {item.path === '/' && renderSearchButton()}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {expanded && (
            <div className="mt-6 flex min-h-0 w-full flex-1 flex-col pb-3">
              <button
                onClick={toggleRecentExpanded}
                className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                aria-expanded={recentExpanded}
                aria-label={recentExpanded ? '收起最近聊天' : '展开最近聊天'}
              >
                <MessageSquareText size={13} />
                <span className="flex-1 text-left">最近</span>
                <ChevronDown
                  size={13}
                  className={cn('transition-transform duration-200', recentExpanded && 'rotate-180')}
                />
              </button>
              {recentExpanded && (
                <div
                  ref={recentScrollRef}
                  onScroll={() => {
                    const container = recentScrollRef.current
                    if (!container) return
                    const top = container.scrollTop > 6
                    const bottom = container.scrollTop + container.clientHeight < container.scrollHeight - 6
                    setRecentScrollFade({ top, bottom })
                  }}
                  className={cn(
                    'recent-session-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 pb-5',
                    recentScrollFade.top && recentScrollFade.bottom && 'recent-session-scroll-fade-both',
                    recentScrollFade.top && !recentScrollFade.bottom && 'recent-session-scroll-fade-top',
                    !recentScrollFade.top && recentScrollFade.bottom && 'recent-session-scroll-fade-bottom',
                  )}
                >
                  {recentItems.length === 0 ? (
                    <div className="px-3 py-2 text-xs leading-5 text-muted-foreground">
                      暂无最近聊天
                    </div>
                  ) : (
                    recentItems.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            'group rounded-xl px-1 py-0.5 transition-colors',
                          selectedRecentSessionId === item.id
                            ? 'bg-accent text-foreground'
                            : 'text-foreground hover:bg-accent'
                        )}
                      >
                        <div className="flex items-center gap-1">
                          {renamingSessionId === item.id ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onBlur={() => void handleRenameRecentSession(item.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void handleRenameRecentSession(item.id)
                                }
                                if (event.key === 'Escape') {
                                  setRenamingSessionId(null)
                                  setRenameValue('')
                                }
                              }}
                              className="mx-2 h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                            />
                          ) : (
                            <button
                              onClick={() => handleOpenRecentSession(item.id)}
                              className="min-w-0 flex-1 rounded-lg px-2 py-1 text-left"
                            >
                              <p className="truncate text-sm text-foreground">{item.label}</p>
                            </button>
                          )}

                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              const rect = event.currentTarget.getBoundingClientRect()
                              const nextPosition = getFloatingMenuPosition(rect)
                              setMenuState((prev) => prev?.sessionId === item.id
                                ? null
                                : {
                                    sessionId: item.id,
                                    top: nextPosition.top,
                                    left: nextPosition.left,
                                  })
                            }}
                            className={cn(
                              'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-background/80 hover:text-foreground',
                              menuState?.sessionId === item.id
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                            )}
                            aria-label="更多操作"
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Settings */}
        <button
          onClick={() => navigate('/settings')}
          title={expanded ? undefined : '设置'}
          aria-label={expanded ? undefined : '设置'}
          aria-current={isActive('/settings') ? 'page' : undefined}
          className={itemCls(isActive('/settings'))}
        >
          <Settings size={18} className="flex-shrink-0" aria-hidden="true" />
          {expanded && <span className="text-sm font-medium">设置</span>}
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={expanded ? undefined : isDark ? '切换亮色' : '切换暗色'}
          aria-label={isDark ? '切换亮色模式' : '切换暗色模式'}
          className={bottomItemCls}
        >
          {isDark
            ? <Sun size={18} className="flex-shrink-0" aria-hidden="true" />
            : <Moon size={18} className="flex-shrink-0" aria-hidden="true" />}
          {expanded && <span className="text-sm font-medium">{isDark ? '亮色模式' : '暗色模式'}</span>}
        </button>
      </nav>

      {menuState && activeMenuItem && createPortal(
        <div
          ref={floatingMenuRef}
          className="fixed z-[80] min-w-[120px] rounded-xl border border-border bg-card p-1 shadow-lg"
          style={{ top: menuState.top, left: menuState.left }}
        >
          <button
            onClick={() => {
              setRenamingSessionId(activeMenuItem.id)
              setRenameValue(activeMenuItem.title.trim() || activeMenuItem.label)
              setMenuState(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Pencil size={14} />
            重命名
          </button>
          {recentSessions.find((s) => s.session_id === activeMenuItem.id)?.project_id ? (
            <button
              onClick={() => {
                void handleAssignProject(activeMenuItem.id, null)
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
                setAssignDialog({ sessionId: activeMenuItem.id })
                setMenuState(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <FolderPlus size={14} />
              加入项目
            </button>
          )}
          <button
            onClick={() => void handleDeleteRecentSession(activeMenuItem.id)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>,
        document.body
      )}

      {searchOpen && createPortal(
        <div className="fixed inset-0 z-[140]">
          <button
            type="button"
            aria-label="关闭搜索"
            onClick={closeSearch}
            className="absolute inset-0 bg-white/28 backdrop-blur-[10px] dark:bg-slate-950/24"
          />

          <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-5 pt-20">
            <div className="pointer-events-auto w-full max-w-[720px] overflow-hidden rounded-[30px] border border-white/70 bg-white/86 shadow-[0_30px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75">
              <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/82 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80">
                  <Search size={16} className="text-slate-400" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.metaKey && event.key === '0') {
                        const newSessionAction = quickActions.find((item) => item.id === 'new-session')
                        if (newSessionAction) {
                          event.preventDefault()
                          newSessionAction.onSelect()
                          return
                        }
                      }

                      const quickSelectMatch = event.key.match(/^[1-8]$/)
                      if (event.metaKey && quickSelectMatch) {
                        const quickIndex = Number(quickSelectMatch[0]) - 1
                        const targetItem = visibleRecentSearchItems[quickIndex]
                        if (targetItem) {
                          event.preventDefault()
                          targetItem.onSelect()
                          return
                        }
                      }

                      if (searchResults.length > 0 && event.key === 'ArrowDown') {
                        event.preventDefault()
                        setSearchActiveIndex((current) => {
                          const lastVisibleIndex = searchResults.length - 1
                          const lastRecentIndex = quickActionCount + visibleRecentSearchItems.length - 1
                          const canScrollRecentDown =
                            visibleRecentSearchItems.length > 0
                            && current >= quickActionCount
                            && current === lastRecentIndex
                            && recentWindowStart < maxRecentWindowStart

                          if (canScrollRecentDown) {
                            setRecentWindowStart((prev) => Math.min(prev + 1, maxRecentWindowStart))
                            return Math.min(current, lastVisibleIndex)
                          }

                          return Math.min(current + 1, lastVisibleIndex)
                        })
                        return
                      }

                      if (searchResults.length > 0 && event.key === 'ArrowUp') {
                        event.preventDefault()
                        setSearchActiveIndex((current) => {
                          const firstRecentIndex = quickActionCount
                          const canScrollRecentUp =
                            visibleRecentSearchItems.length > 0
                            && current === firstRecentIndex
                            && recentWindowStart > 0

                          if (canScrollRecentUp) {
                            setRecentWindowStart((prev) => Math.max(prev - 1, 0))
                            return Math.max(current, firstRecentIndex)
                          }

                          return Math.max(current - 1, 0)
                        })
                        return
                      }

                      if (event.key === 'Enter') {
                        event.preventDefault()
                        searchResults[searchActiveIndex]?.onSelect()
                      }
                    }}
                    placeholder="搜索操作或最近对话..."
                    className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {navigator.platform.toUpperCase().includes('MAC') ? '⌘K' : 'Win+K'}
                  </span>
                </div>
              </div>

              <div className="max-h-[520px] overflow-y-auto px-4 py-4">
                <section>
                  <div className="mb-2 px-2">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Quick actions
                    </span>
                  </div>
                  <div className="space-y-1">
                    {quickActions.length > 0 ? quickActions.map((item) => {
                      const activeIndex = searchResults.findIndex((result) => result.id === item.id)
                      const active = activeIndex === searchActiveIndex
                      return (
                        <button
                          key={item.id}
                          onMouseEnter={() => setSearchActiveIndex(activeIndex)}
                          onClick={item.onSelect}
                          className={searchItemCls(active)}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                          </div>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {item.id === 'new-session' ? `${isMac ? '⌘' : 'Win'} + 0` : 'Enter'}
                          </span>
                        </button>
                      )
                    }) : (
                      <div className="rounded-2xl px-3 py-3 text-sm text-muted-foreground">没有匹配的快捷操作</div>
                    )}
                  </div>
                </section>

                <section className="mt-2.5">
                  <div className="mb-1 px-2">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      最近
                    </span>
                  </div>
                  <div className="space-y-1">
                    {recentSearchItems.length > 0 ? (
                      <div
                        className="space-y-1 overflow-hidden"
                        onWheel={(event) => {
                          if (recentSearchItems.length <= RECENT_WINDOW_SIZE) return
                          if (Math.abs(event.deltaY) < 4) return
                          event.preventDefault()
                          setRecentWindowStart((current) => {
                            if (event.deltaY > 0) return Math.min(current + 1, maxRecentWindowStart)
                            return Math.max(current - 1, 0)
                          })
                        }}
                      >
                        {visibleRecentSearchItems.map((item, index) => {
                      const resultIndex = searchResults.findIndex((result) => result.id === item.id)
                      const shortcut = `${isMac ? '⌘' : 'Win'} + ${index + 1}`
                      const active = resultIndex === searchActiveIndex
                      return (
                        <button
                          key={`recent-slot-${index}`}
                          onMouseEnter={() => setSearchActiveIndex(resultIndex)}
                          onClick={item.onSelect}
                          className={searchItemCls(active, true)}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                          </div>
                          <span className="ml-4 flex-shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {shortcut}
                          </span>
                        </button>
                      )
                    })}
                      </div>
                    ) : (
                      <div className="rounded-2xl px-3 py-3 text-sm text-muted-foreground">没有匹配的最近对话</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {logoPreview && createPortal(
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setLogoPreview(false)}
        >
          <img
            src={sidebarLogo}
            alt="HarnessClaw"
            className="max-h-[80vh] max-w-[80vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
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
                    const currentSession = recentSessions.find((s) => s.session_id === assignDialog.sessionId)
                    const isCurrentProject = currentSession?.project_id === project.project_id
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
