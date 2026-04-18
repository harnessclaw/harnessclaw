import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  House,
  Zap,
  Puzzle,
  FolderKanban,
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
  updated_at: number
}

interface FloatingMenuState {
  sessionId: string
  top: number
  left: number
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

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const selectedRecentSessionId = typeof location.state?.sessionId === 'string' ? location.state.sessionId : ''
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sidebar-expanded') === 'true')
  const [recentExpanded, setRecentExpanded] = useState(() => localStorage.getItem('sidebar-recent-expanded') !== 'false')
  const [recentSessions, setRecentSessions] = useState<RecentSessionItem[]>([])
  const [menuState, setMenuState] = useState<FloatingMenuState | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const floatingMenuRef = useRef<HTMLDivElement | null>(null)
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

    void loadRecentSessions()
    const offSessionsChanged = window.db.onSessionsChanged(() => {
      void loadRecentSessions()
    })

    return () => {
      active = false
      offSessionsChanged()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuState(null)
        setRenamingSessionId(null)
        setRenameValue('')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
      label: session.title.trim() || '未命名对话',
    }))
  }, [recentSessions])

  const handleOpenRecentSession = (sessionId: string) => {
    navigate('/chat', { state: { sessionId } })
  }

  const handleDeleteRecentSession = async (sessionId: string) => {
    const result = await window.db.deleteSession(sessionId)
    if (!result.ok) return

    setRecentSessions((prev) => prev.filter((session) => session.session_id !== sessionId))
    setMenuState(null)
    if (renamingSessionId === sessionId) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
    if (selectedRecentSessionId === sessionId) {
      navigate('/sessions')
    }
  }

  const handleRenameRecentSession = async (sessionId: string) => {
    const nextTitle = renameValue.trim()
    if (!nextTitle) {
      setRenamingSessionId(null)
      setRenameValue('')
      return
    }

    const result = await window.db.updateSessionTitle(sessionId, nextTitle)
    if (!result.ok) return

    setRecentSessions((prev) => prev.map((session) => (
      session.session_id === sessionId
        ? { ...session, title: nextTitle, updated_at: Date.now() }
        : session
    )))
    setMenuState(null)
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const itemCls = (active: boolean) => cn(
    'flex items-center rounded-lg transition-colors flex-shrink-0',
    expanded ? 'w-full gap-3 px-3 py-2' : 'w-11 h-11 justify-center',
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

  return (
    <>
      <nav
        aria-label="主导航"
        className={cn(
          'flex-shrink-0 bg-card border-r border-border flex flex-col pt-[52px] pb-3 select-none transition-[width] duration-200 overflow-hidden',
          expanded ? 'w-72 items-start px-2' : 'w-[78px] items-center'
        )}
      >
        <div className={cn('flex min-h-0 w-full flex-1 flex-col', !expanded && 'items-center')}>
          <div className={cn('flex w-full flex-col flex-shrink-0', expanded ? 'gap-7' : 'items-center gap-8')}>
            {navGroups.map((group, index) => (
              <div
                key={index}
                className={cn('flex w-full flex-col gap-1', !expanded && 'items-center')}
              >
                {group.items.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    title={expanded ? undefined : item.label}
                    aria-label={expanded ? undefined : item.label}
                    aria-current={isActive(item.path) ? 'page' : undefined}
                    className={itemCls(isActive(item.path))}
                  >
                    <item.icon size={18} className="flex-shrink-0" aria-hidden="true" />
                    {expanded && <span className="text-sm font-medium">{item.label}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {expanded && (
            <div className="mt-6 flex w-full flex-shrink-0 flex-col">
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
                <div className="recent-session-scroll max-h-72 space-y-0.5 overflow-y-auto pr-1 pb-2">
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
                              setMenuState((prev) => prev?.sessionId === item.id
                                ? null
                                : {
                                    sessionId: item.id,
                                    top: rect.bottom + 6,
                                    left: rect.right - 132,
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

        {/* Expand / collapse toggle */}
        <button
          onClick={toggleExpanded}
          title={expanded ? '收起侧边栏' : '展开侧边栏'}
          aria-label={expanded ? '收起侧边栏' : '展开侧边栏'}
          className={bottomItemCls}
        >
          <PanelLeft
            size={18}
            className={cn('flex-shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
            aria-hidden="true"
          />
          {expanded && <span className="text-sm font-medium">收起</span>}
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
    </>
  )
}
