import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  House,
  Zap,
  Puzzle,
  FlaskConical,
  Search,
  FolderKanban,
  FolderMinus,
  FolderPlus,
  Users,
  MessageSquareText,
  Pencil,
  Trash2,
  Plus,
  Clock,
  MoreHorizontal,
  SquarePen,
  ChevronDown,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { getProjectDisplayDescription, getProjectDisplayName } from '../../lib/projectDisplay'
import {
  clearProjectCwd,
  PROJECT_CWDS_CHANGED_EVENT,
  readProjectCwds,
  sessionBelongsToProjectByCwd,
  setProjectCwd,
} from '../../lib/projectCwds'
import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'
import { trackSearchUsed } from '../../lib/telemetry'
import emmaLogo from '../../assets/emma-logo.png'
import sidebarAvatar from '../../assets/sidebar-avatar.svg'
import betaBadge from '../../assets/beta-badge.svg'
import iconNewTask from '../../assets/icon-new-task.svg'
import iconScheduler from '../../assets/icon-scheduler.svg'
import iconSkills from '../../assets/icon-skills.svg'
import iconProjects from '../../assets/icon-projects.svg'
import iconXlab from '../../assets/icon-xlab.svg'
import iconChat from '../../assets/icon-chat.svg'
import iconSettings from '../../assets/icon-settings.svg'
import iconMore from '../../assets/icon-more.svg'
import iconQuestion from '../../assets/icon-question.svg'
import iconRecentArrow from '../../assets/icon-recent-arrow.svg'
import iconSidebarOpen from '../../assets/icon-sidebar-open.svg'
import iconSidebarCollapse from '../../assets/icon-sidebar-collapse.svg'
import { ConfirmDeleteSessionDialog } from '../common/ConfirmDeleteSessionDialog'
import { SearchChatPlaceholder } from '../common/SearchChatPlaceholder'
import { NewChatItem } from '../common/NewChatItem'
import { NewTaskIcon } from '../common/NewTaskIcon'
import { RecentChatLabel } from '../common/RecentChatLabel'

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
  project_context_json?: string | null
  cwd?: string | null
  updated_at: number
}

interface FloatingMenuState {
  sessionId: string
  top: number
  left: number
}

interface ProjectFloatingMenuState {
  projectId: string
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

const isMac = navigator.platform.toUpperCase().includes('MAC')
const RECENT_WINDOW_SIZE = 8
const PROJECT_THREAD_PREVIEW_SIZE = 5
const FLOATING_MENU_WIDTH = 132
const FLOATING_MENU_HEIGHT = 120
const FLOATING_MENU_GAP = 6
const VIEWPORT_PADDING = 12
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 440
const DEFAULT_SIDEBAR_WIDTH = 288

function SidebarTooltip({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null)

  const showTooltip = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltipPosition({
      left: rect.left + rect.width / 2,
      top: Math.max(8, rect.top - 6),
    })
  }

  const hideTooltip = () => {
    setTooltipPosition(null)
  }

  return (
    <span
      ref={triggerRef}
      className={cn('inline-flex min-w-0', className)}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocusCapture={showTooltip}
      onBlurCapture={hideTooltip}
    >
      {children}
      {tooltipPosition && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[1000] whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs leading-4 text-foreground shadow-lg"
          style={{
            left: tooltipPosition.left,
            top: tooltipPosition.top,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {label}
        </span>,
        document.body
      )}
    </span>
  )
}

export function Sidebar() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  const navGroups: NavGroup[] = useMemo(() => [
    {
      items: [
        { icon: Plus, path: '/', label: t('sidebar.newTask') },
        // 暂隐藏(功能未完成,保留代码勿删):定时任务 / 团队
        // { icon: Clock, path: '/scheduler', label: t('sidebar.scheduler') },
        { icon: MessageSquareText, path: '/sessions', label: t('sidebar.chat') },
        { icon: Puzzle, path: '/skills', label: t('sidebar.skills') },
        // 暂隐藏(保留代码勿删):项目导航入口
        // { icon: FolderKanban, path: '/projects', label: t('sidebar.projects') },
        // { icon: Users, path: '/team', label: t('sidebar.team') },
        { icon: FlaskConical, path: '/x-lab', label: t('sidebar.xLab') },
      ],
    },
  ], [t])

  const harnessclawStatus = useHarnessclawStatus()
  const selectedRecentSessionId = typeof location.state?.sessionId === 'string' ? location.state.sessionId : ''
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sidebar-expanded') === 'true')
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('sidebar-width'))
    if (Number.isFinite(saved) && saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH) {
      return saved
    }
    return DEFAULT_SIDEBAR_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
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
  const [projectsExpanded, setProjectsExpanded] = useState(() => localStorage.getItem('sidebar-projects-expanded') !== 'false')
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('sidebar-expanded-project-ids')
      const ids = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const [showAllProjectThreadIds, setShowAllProjectThreadIds] = useState<Set<string>>(new Set())
  const [projectMenuState, setProjectMenuState] = useState<ProjectFloatingMenuState | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<{ projectId: string; name: string } | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [projectActionError, setProjectActionError] = useState('')
  const [projectCwds, setProjectCwds] = useState<Record<string, string>>(() => readProjectCwds())
  const [assignDialog, setAssignDialog] = useState<AssignProjectDialogState | null>(null)
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<{ sessionId: string; title: string } | null>(null)
  const [attentionSessions, setAttentionSessions] = useState<Set<string>>(new Set())
  const floatingMenuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const recentScrollRef = useRef<HTMLDivElement | null>(null)
  const projectExpansionInitializedRef = useRef(false)
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

  // Sync initial theme and language from app config (the same store the Settings page reads),
  // so the sidebar toggles and Settings UI never drift apart.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const cfg = await window.appConfig.read()
        if (!active) return
        const ui = (cfg?.ui || {}) as { theme?: string; language?: string }
        const themeVal = typeof ui.theme === 'string' ? ui.theme : ''
        if (themeVal === 'dark') {
          document.documentElement.classList.add('dark')
          localStorage.setItem('theme', 'dark')
          setIsDark(true)
        } else if (themeVal === 'light') {
          document.documentElement.classList.remove('dark')
          localStorage.setItem('theme', 'light')
          setIsDark(false)
        } else if (themeVal === 'system') {
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
          document.documentElement.classList.toggle('dark', prefersDark)
          localStorage.removeItem('theme')
          setIsDark(prefersDark)
        }

        if (ui.language) {
          void i18n.changeLanguage(ui.language)
        }
      } catch {
        // ignore — keep initial state
      }
    })()
    return () => { active = false }
  }, [])

  // Listen for theme changes triggered elsewhere (e.g., the Settings UI page)
  // so the sun/moon icon reflects the current state immediately.
  useEffect(() => {
    const handler = () => {
      setIsDark(document.documentElement.classList.contains('dark'))
    }
    window.addEventListener('theme-changed', handler)
    return () => window.removeEventListener('theme-changed', handler)
  }, [])

  // 监听会话 attention 状态变化（问答节点待操作提醒）
  useEffect(() => {
    if (!window.chatApi) return

    // 初始加载
    window.chatApi.getAttentionSessions()
      .then((sessions: string[]) => setAttentionSessions(new Set(sessions)))
      .catch((err) => console.error('[Sidebar] getAttentionSessions failed:', err))

    // 监听变化
    const unsubscribe = window.chatApi.onAttentionChanged((sessionId: string, needsAttention: boolean) => {
      setAttentionSessions((prev) => {
        const next = new Set(prev)
        if (needsAttention) {
          next.add(sessionId)
        } else {
          next.delete(sessionId)
        }
        return next
      })
    })

    return unsubscribe
  }, [])

  const toggleTheme = async () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    // Persist to app config so the Settings page reads the same value and
    // doesn't revert the theme on mount.
    try {
      const cfg = await window.appConfig.read()
      const ui = (cfg?.ui || {}) as Record<string, unknown>
      await window.appConfig.save({ ...cfg, ui: { ...ui, theme: next ? 'dark' : 'light' } })
    } catch {
      // ignore — DOM and localStorage already updated
    }
    window.dispatchEvent(new CustomEvent('theme-changed'))
  }

  const toggleExpanded = () => {
    const next = !expanded
    setExpanded(next)
    localStorage.setItem('sidebar-expanded', String(next))
  }

  useEffect(() => {
    localStorage.setItem('sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (!isResizing) return

    const handleMove = (event: MouseEvent) => {
      const next = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, event.clientX))
      setSidebarWidth(next)
    }
    const handleUp = () => setIsResizing(false)

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
    }
  }, [isResizing])

  const toggleRecentExpanded = () => {
    const next = !recentExpanded
    setRecentExpanded(next)
    localStorage.setItem('sidebar-recent-expanded', String(next))
  }

  const toggleProjectsExpanded = () => {
    const next = !projectsExpanded
    setProjectsExpanded(next)
    localStorage.setItem('sidebar-projects-expanded', String(next))
  }

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      localStorage.setItem('sidebar-expanded-project-ids', JSON.stringify(Array.from(next)))
      return next
    })
  }

  const showAllProjectThreads = (projectId: string) => {
    setShowAllProjectThreadIds((current) => {
      const next = new Set(current)
      next.add(projectId)
      return next
    })
  }

  const openSearch = () => {
    setSearchOpen(true)
    setSearchQuery('')
    setSearchActiveIndex(0)
    setRecentWindowStart(0)
    trackSearchUsed()
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
        setProjectCwds(readProjectCwds())
      } catch {
        if (!active) return
        setRecentSessions([])
        setProjectCwds(readProjectCwds())
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
    const refreshProjectCwds = () => {
      setProjectCwds(readProjectCwds())
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'harnessclaw-project-cwds') {
        refreshProjectCwds()
      }
    }
    window.addEventListener(PROJECT_CWDS_CHANGED_EVENT, refreshProjectCwds)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(PROJECT_CWDS_CHANGED_EVENT, refreshProjectCwds)
      window.removeEventListener('storage', handleStorage)
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

      // ⌘/Ctrl + N — new session. Handled here (rather than in
      // App.tsx) so we can close the search palette first when it's
      // open; otherwise the navigation would land on the homepage
      // with the overlay still mounted on top.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        closeSearch()
        navigate('/', { state: { focusComposer: true } })
        return
      }

      if (event.key === 'Escape') {
        setMenuState(null)
        setRenamingSessionId(null)
        setRenameValue('')
        closeSearch()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  useEffect(() => {
    if (!searchOpen) return
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen])

  useEffect(() => {
    if (!menuState && !projectMenuState) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (floatingMenuRef.current?.contains(target)) return
      setMenuState(null)
      setProjectMenuState(null)
    }

    const handleViewportChange = () => {
      setMenuState(null)
      setProjectMenuState(null)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [menuState, projectMenuState])

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    if (path === '/sessions') return location.pathname.startsWith(path)
    return location.pathname.startsWith(path)
  }

  const recentItems = useMemo(() => {
    return recentSessions
      .filter((session) => !projects.some((project) => sessionBelongsToProjectByCwd(session, project, projectCwds)))
      .map((session) => ({
        id: session.session_id,
        title: session.title,
        updatedAt: session.updated_at,
        label: session.title.trim() || t('sidebar.untitledSession'),
      }))
  }, [projectCwds, projects, recentSessions, t])

  const formatSessionAge = (updatedAt: number) => {
    const elapsed = Math.max(0, Date.now() - updatedAt)
    const minutes = Math.max(1, Math.floor(elapsed / 60_000))
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return t('sidebar.ageDays', { count: days })
    if (hours > 0) return t('sidebar.ageHours', { count: hours })
    return t('sidebar.ageMinutes', { count: minutes })
  }

  const projectItems = useMemo(() => {
    return projects.map((project) => {
      const sessions = recentSessions
        .filter((session) => sessionBelongsToProjectByCwd(session, project, projectCwds))
        .map((session) => ({
          id: session.session_id,
          title: session.title,
          updatedAt: session.updated_at,
          label: session.title.trim() || t('sidebar.untitledSession'),
        }))

      return {
        project,
        displayName: getProjectDisplayName(project, t),
        sessions,
      }
    })
  }, [projectCwds, projects, recentSessions, t])

  useEffect(() => {
    if (projectExpansionInitializedRef.current) return
    if (projects.length === 0 || recentSessions.length === 0) return
    if (localStorage.getItem('sidebar-expanded-project-ids')) {
      projectExpansionInitializedRef.current = true
      return
    }

    const projectIdsWithSessions = projects
      .filter((project) => recentSessions.some((session) => sessionBelongsToProjectByCwd(session, project, projectCwds)))
      .map((project) => project.project_id)

    if (projectIdsWithSessions.length === 0) return
    projectExpansionInitializedRef.current = true
    setExpandedProjectIds(new Set(projectIdsWithSessions))
  }, [projectCwds, projects, recentSessions])

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
    // If the deleted session is the one currently open in the chat
    // view, the chat page would otherwise keep showing a stale session
    // (its activeSessionId is sourced from location.state.sessionId).
    // Navigate back to home so the user lands on a clean state.
    if (selectedRecentSessionId === sessionId) {
      navigate('/', { state: { focusComposer: true } })
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
    setRecentSessions((prev) => prev.map((session) => (
      session.session_id === sessionId
        ? { ...session, project_id: projectId, updated_at: Date.now() }
        : session
    )))
    if (projectId) {
      const session = recentSessions.find((item) => item.session_id === sessionId)
      if (session?.cwd) setProjectCwd(projectId, session.cwd)
    }
    setProjectCwds(readProjectCwds())
    setAssignDialog(null)
  }

  const handleOpenProjectNewConversation = (project: DbProjectRow) => {
    setProjectMenuState(null)
    closeSearch()
    navigate('/', {
      state: {
        focusComposer: true,
        hideRecommendations: true,
        selectedProjectId: project.project_id,
        selectedProject: project,
      },
    })
  }

  const handleDeleteProject = async (projectId: string) => {
    setProjectActionError('')
    setDeletingProjectId(projectId)
    try {
      const deletedSessionIds = new Set(
        recentSessions
          .filter((session) => {
            const project = projects.find((item) => item.project_id === projectId)
            return project ? sessionBelongsToProjectByCwd(session, project, projectCwds) : false
          })
          .map((session) => session.session_id),
      )
      const result = await window.db.deleteProject(projectId)
      if (!result.ok) {
        setProjectActionError(result.error || t('projects.errors.deleteFailed'))
        return
      }

      setProjects((current) => current.filter((project) => project.project_id !== projectId))
      const project = projects.find((item) => item.project_id === projectId)
      setRecentSessions((current) => current.filter((session) => (
        project ? !sessionBelongsToProjectByCwd(session, project, projectCwds) : true
      )))
      setProjectCwds(clearProjectCwd(projectId))
      setExpandedProjectIds((current) => {
        const next = new Set(current)
        next.delete(projectId)
        localStorage.setItem('sidebar-expanded-project-ids', JSON.stringify(Array.from(next)))
        return next
      })
      setShowAllProjectThreadIds((current) => {
        const next = new Set(current)
        next.delete(projectId)
        return next
      })
      setProjectMenuState(null)
      setConfirmDeleteProject(null)
      if (deletedSessionIds.has(selectedRecentSessionId)) {
        navigate('/', { state: { focusComposer: true } })
      } else if (location.pathname === `/projects/${projectId}`) {
        navigate('/projects')
      }
    } finally {
      setDeletingProjectId(null)
    }
  }

  const itemCls = (active: boolean) => cn(
    'flex items-center transition-colors flex-shrink-0',
    expanded ? 'w-full gap-2.5 px-3 py-2.5 rounded-lg' : 'h-10 w-8 justify-center rounded-[10px]',
    active
      ? 'bg-[rgba(226,226,226,0.46)] text-[#222529]'
      : 'text-[#222529]/78 hover:text-[#222529] hover:bg-[rgba(226,226,226,0.20)]'
  )

  const bottomItemCls = cn(
    'flex items-center rounded-lg transition-colors text-foreground/78 hover:text-foreground hover:bg-accent',
    expanded ? 'w-full gap-3 px-3 py-2' : 'w-11 h-11 justify-center'
  )

  const activeMenuItem = menuState
    ? recentItems.find((item) => item.id === menuState.sessionId) || null
    : null
  const activeMenuProject = projectMenuState
    ? projectItems.find((item) => item.project.project_id === projectMenuState.projectId) || null
    : null

  const searchKeyword = searchQuery.trim().toLowerCase()
  const quickActions = useMemo<SearchResultItem[]>(() => {
    const items: SearchResultItem[] = [
      {
        id: 'new-session',
        type: 'action',
        label: t('search.newSession'),
        description: t('search.newSessionDesc'),
        onSelect: () => {
          closeSearch()
          navigate('/', { state: { focusComposer: true } })
        },
      },
    ]

    if (!searchKeyword) return items
    return items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(searchKeyword))
  }, [navigate, searchKeyword, t])

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
      title={expanded ? undefined : t('sidebar.search')}
      aria-label={expanded ? undefined : t('sidebar.search')}
      className={itemCls(searchOpen)}
    >
      <Search size={18} className="flex-shrink-0" aria-hidden="true" />
      {expanded && (
        <span className="text-sm font-medium leading-5">{t('sidebar.search')}</span>
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
        aria-label={t('sidebar.mainNavigationAria')}
        style={expanded ? { width: `${sidebarWidth}px` } : undefined}
        className={cn(
          'relative flex-shrink-0 bg-card border-r border-border flex flex-col pt-8 pb-3 select-none overflow-hidden',
          !isResizing && 'transition-[width] duration-200',
          expanded ? 'items-start px-2' : 'w-[78px] items-center'
        )}
      >
        <div className={cn('flex min-h-0 w-full flex-1 flex-col', !expanded && 'items-center')}>
          <div className={cn('flex w-full flex-col flex-shrink-0', expanded ? 'gap-4' : 'items-center gap-4')}>
            <div className={cn('mt-2 flex w-full flex-shrink-0', expanded ? 'pl-1' : 'justify-center')}>
              {expanded ? (
                <div className="flex w-full items-center justify-center py-1">
                  <img src={emmaLogo} alt="Emma" className="h-6 object-contain" />
                </div>
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center">
                    <img src={sidebarAvatar} alt="Emma" className="h-12 w-12 object-contain" />
                  </div>
                )}
            </div>

            {navGroups.map((group, index) => (
              <div
                key={index}
                className={cn('mt-4 flex w-full flex-col gap-2', !expanded && 'items-center')}
              >
                {group.items.map((item, itemIndex) => (
                  <div key={item.path} className={cn('flex w-full flex-col gap-2', !expanded && 'items-center')}>
                    <button
                      onClick={() => navigate(item.path)}
                      title={expanded ? undefined : item.label}
                      aria-label={expanded ? undefined : item.label}
                      aria-current={isActive(item.path) ? 'page' : undefined}
                      className={itemCls(isActive(item.path))}
                    >
                      {(() => {
                        const customIcons: Record<string, string> = {
                          '/': iconNewTask,
                          '/scheduler': iconScheduler,
                          '/sessions': iconChat,
                          '/skills': iconSkills,
                          '/projects': iconProjects,
                          '/x-lab': iconXlab,
                        }
                        const src = customIcons[item.path]
                        if (!src) {
                          return <item.icon size={18} className="flex-shrink-0" aria-hidden="true" />
                        }
                        // 新任务 SVG 自带阴影滤镜,viewBox 37x37 比内容大,所以用更大渲染尺寸 + 负 margin 居中,
                        // 视觉上和其他 18x18 图标对齐
                        if (item.path === '/') {
                          return (
                            <span className="relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center" aria-hidden="true">
                              <img src={src} alt="" className="h-[42px] w-[42px] max-w-none" />
                            </span>
                          )
                        }
                        // X-LAB 图标原始尺寸为 13x15,用 18x18 容器居中,避免被拉伸放大
                        if (item.path === '/x-lab') {
                          return (
                            <span className="relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center" aria-hidden="true">
                              <img src={src} alt="" className="h-[15px] w-[13px] max-w-none" />
                            </span>
                          )
                        }
                        return (
                          <img src={src} alt="" className="h-[18px] w-[18px] flex-shrink-0" aria-hidden="true" />
                        )
                      })()}
                      {expanded && (
                        <span className="flex flex-1 items-center text-sm font-medium leading-5 tracking-[0px]">
                          {item.label}
                          {item.path === '/x-lab' && (
                            <img src={betaBadge} alt="BETA" className="ml-auto h-4 object-contain" />
                          )}
                        </span>
                      )}
                    </button>
                    {/* 搜索按钮放在新任务（第一项）后面 */}
                    {index === 0 && itemIndex === 0 && renderSearchButton()}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {expanded && (
            <div className="mt-6 flex min-h-0 w-full flex-1 flex-col gap-3 pb-3">
              <section className="flex max-h-[46%] min-h-0 flex-col">
                <div
                  className="group/module mb-2 flex max-w-full items-center justify-start gap-2 rounded-lg px-3 py-1.5 text-xs font-normal text-[#767676] transition-colors hover:bg-accent/50 hover:text-[#767676]"
                  style={{ lineHeight: '24px' }}
                >
                  <button
                    onClick={toggleProjectsExpanded}
                    className="flex min-w-0 items-center gap-2 text-left"
                    aria-expanded={projectsExpanded}
                    aria-label={projectsExpanded ? t('sidebar.projectsCollapseAria') : t('sidebar.projectsExpandAria')}
                  >
                    <FolderKanban size={13} />
                    <span className="text-left">{t('sidebar.projects')}</span>
                  </button>
                  <SidebarTooltip label={projectsExpanded ? t('common.collapse') : t('common.expand')}>
                    <button
                      type="button"
                      onClick={toggleProjectsExpanded}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-all duration-200 hover:bg-background/80 group-hover/module:opacity-100 focus-visible:opacity-100"
                      aria-expanded={projectsExpanded}
                      aria-label={projectsExpanded ? t('sidebar.projectsCollapseAria') : t('sidebar.projectsExpandAria')}
                    >
                      <img
                        src={iconRecentArrow}
                        alt=""
                        aria-hidden="true"
                        className={cn('transition-transform duration-200', !projectsExpanded && 'rotate-180')}
                      />
                    </button>
                  </SidebarTooltip>
                </div>

                {projectsExpanded && (
                  <div className="-mr-1 min-h-0 space-y-1 overflow-x-hidden overflow-y-auto pr-1">
                    {projectItems.length === 0 ? (
                      <div className="px-3 py-2 text-xs leading-5 text-[#767676]">
                        {t('sidebar.noProjects')}
                      </div>
                    ) : (
                      projectItems.map((item) => {
                        const projectOpen = expandedProjectIds.has(item.project.project_id)
                        const activeProject = item.sessions.some((session) => session.id === selectedRecentSessionId)
                        const showAllThreads = showAllProjectThreadIds.has(item.project.project_id)
                        const visibleSessions = showAllThreads
                          ? item.sessions
                          : item.sessions.slice(0, PROJECT_THREAD_PREVIEW_SIZE)
                        return (
                          <div key={item.project.project_id} className="space-y-0.5">
                            <div
                              className={cn(
                                'group/project flex w-full items-center rounded-xl px-2.5 py-1.5 transition-colors',
                                activeProject
                                  ? 'bg-accent text-[#222529]'
                                  : 'text-[#222529] hover:bg-accent'
                              )}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <button
                                  onClick={() => toggleProjectExpanded(item.project.project_id)}
                                  className="flex min-w-0 items-center gap-2 text-left"
                                  aria-expanded={projectOpen}
                                  aria-label={projectOpen ? t('common.collapse') : t('common.expand')}
                                >
                                  <FolderKanban size={16} className="flex-shrink-0 text-[#4b4f55]" />
                                  <span className="min-w-0 truncate text-sm font-[350] leading-6 tracking-[0px]">
                                    {item.displayName}
                                  </span>
                                </button>
                                <SidebarTooltip label={projectOpen ? t('common.collapse') : t('common.expand')}>
                                  <button
                                    type="button"
                                    onClick={() => toggleProjectExpanded(item.project.project_id)}
                                    className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg opacity-0 transition-all duration-200 hover:bg-background/80 group-hover/project:opacity-100 focus-visible:opacity-100"
                                    aria-expanded={projectOpen}
                                    aria-label={projectOpen ? t('common.collapse') : t('common.expand')}
                                  >
                                  <ChevronDown
                                    size={16}
                                    aria-hidden="true"
                                    className={cn(
                                      'flex-shrink-0 text-[#4b4f55] opacity-80 transition-transform duration-200',
                                      !projectOpen && '-rotate-90'
                                    )}
                                  />
                                  </button>
                                </SidebarTooltip>
                              </div>

                              <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">
                                <SidebarTooltip label={t('sidebar.more')}>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setProjectActionError('')
                                      const rect = event.currentTarget.getBoundingClientRect()
                                      const nextPosition = getFloatingMenuPosition(rect)
                                      setProjectMenuState((prev) => prev?.projectId === item.project.project_id
                                        ? null
                                        : {
                                            projectId: item.project.project_id,
                                            top: nextPosition.top,
                                            left: nextPosition.left,
                                          })
                                    }}
                                    className={cn(
                                      'pointer-events-none inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#4b4f55] opacity-0 transition-all hover:bg-background/80 hover:opacity-100 group-hover/project:pointer-events-auto group-hover/project:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
                                      projectMenuState?.projectId === item.project.project_id && 'pointer-events-auto bg-background/80 opacity-100'
                                    )}
                                    aria-label={t('projects.actions.openAria', { name: item.displayName })}
                                    aria-expanded={projectMenuState?.projectId === item.project.project_id}
                                  >
                                    <MoreHorizontal size={16} aria-hidden="true" />
                                  </button>
                                </SidebarTooltip>
                                <SidebarTooltip label={t('search.newConversation')}>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleOpenProjectNewConversation(item.project)
                                    }}
                                    className="pointer-events-none inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#4b4f55] opacity-0 transition-all hover:bg-background/80 hover:opacity-100 group-hover/project:pointer-events-auto group-hover/project:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                                    aria-label={t('sidebar.newProjectConversation', { name: item.displayName })}
                                  >
                                    <SquarePen size={15} aria-hidden="true" />
                                  </button>
                                </SidebarTooltip>
                              </div>
                            </div>

                            {projectOpen && visibleSessions.length > 0 && (
                              <div className="ml-7 space-y-0.5">
                                {visibleSessions.map((session) => (
                                  <button
                                    key={session.id}
                                    onClick={() => handleOpenRecentSession(session.id)}
                                    className={cn(
                                      'group relative flex w-full items-center gap-2 rounded-lg py-1 pl-2.5 pr-2 text-left transition-colors',
                                      selectedRecentSessionId === session.id
                                        ? 'bg-accent text-[#222529]'
                                        : 'text-[#222529] hover:bg-accent'
                                    )}
                                  >
                                    <span className="min-w-0 flex-1 truncate text-xs font-[350] leading-6">
                                      {session.label}
                                    </span>
                                    <span className="flex-shrink-0 text-xs leading-6 text-[#8c9095]">
                                      {formatSessionAge(session.updatedAt)}
                                    </span>
                                    {attentionSessions.has(session.id) && (
                                      <img
                                        src={iconQuestion}
                                        alt=""
                                        title={t('sidebar.awaitingReply')}
                                        className="h-3 w-3 flex-shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </button>
                                ))}
                                {!showAllThreads && item.sessions.length > PROJECT_THREAD_PREVIEW_SIZE && (
                                  <button
                                    onClick={() => showAllProjectThreads(item.project.project_id)}
                                    className="w-full rounded-lg px-2.5 py-1 text-left text-xs font-medium leading-6 text-[#8c9095] transition-colors hover:bg-accent/60 hover:text-[#767676]"
                                  >
                                    {t('sidebar.showMore')}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </section>

              <section className="flex min-h-0 flex-1 flex-col">
                <div
                  className="group/module mb-2 flex max-w-full items-center justify-start gap-2 rounded-lg px-3 py-1.5 text-xs font-normal text-[#767676] transition-colors hover:bg-accent/50 hover:text-[#767676]"
                  style={{ lineHeight: '24px' }}
                >
                  <button
                    onClick={toggleRecentExpanded}
                    className="flex min-w-0 items-center gap-2 text-left"
                    aria-expanded={recentExpanded}
                    aria-label={recentExpanded ? t('sidebar.recentCollapseAria') : t('sidebar.recentExpandAria')}
                  >
                    <MessageSquareText size={13} />
                    <span className="text-left">{t('sidebar.recent')}</span>
                  </button>
                  <SidebarTooltip label={recentExpanded ? t('common.collapse') : t('common.expand')}>
                    <button
                      type="button"
                      onClick={toggleRecentExpanded}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-all duration-200 hover:bg-background/80 group-hover/module:opacity-100 focus-visible:opacity-100"
                      aria-expanded={recentExpanded}
                      aria-label={recentExpanded ? t('sidebar.recentCollapseAria') : t('sidebar.recentExpandAria')}
                    >
                      <img
                        src={iconRecentArrow}
                        alt=""
                        aria-hidden="true"
                        className={cn('transition-transform duration-200', !recentExpanded && 'rotate-180')}
                      />
                    </button>
                  </SidebarTooltip>
                </div>
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
                      'recent-session-scroll -mr-1 min-h-0 flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto pb-5',
                      recentScrollFade.top && recentScrollFade.bottom && 'recent-session-scroll-fade-both',
                      recentScrollFade.top && !recentScrollFade.bottom && 'recent-session-scroll-fade-top',
                      !recentScrollFade.top && recentScrollFade.bottom && 'recent-session-scroll-fade-bottom',
                    )}
                  >
                    {recentItems.length === 0 ? (
                      <div className="px-3 py-2 text-xs leading-5 text-[#767676]">
                        {t('sidebar.noRecent')}
                      </div>
                    ) : (
                      recentItems.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            'group rounded-xl px-1 py-0.5 transition-colors',
                          selectedRecentSessionId === item.id
                            ? 'bg-accent text-[#222529]'
                            : 'text-[#222529] hover:bg-accent'
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
                              className="relative min-w-0 flex-1 rounded-lg px-2 py-1 text-left"
                            >
                              <p className="truncate pr-4 text-xs text-[#222529]" style={{ fontWeight: 350, lineHeight: '24px' }}>{item.label}</p>
                              {/* 问号提醒：有待回复的问答节点 */}
                              {attentionSessions.has(item.id) && (
                                <img
                                  src={iconQuestion}
                                  alt=""
                                  title={t('sidebar.awaitingReply')}
                                  className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          )}

                          <SidebarTooltip label={t('sidebar.more')}>
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
                                // Hidden by default; revealed on row hover / keyboard focus, or while its menu is open.
                                'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-background/80 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100',
                                menuState?.sessionId === item.id && 'bg-background/80 text-foreground opacity-100'
                              )}
                              aria-label={t('sidebar.more')}
                            >
                              <img src={iconMore} alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
                            </button>
                          </SidebarTooltip>
                        </div>
                      </div>
                      ))
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Settings + Collapse/Expand toggle */}
        {expanded ? (
          <div className="flex w-full items-center gap-1">
            <button
              onClick={() => navigate('/settings')}
              aria-current={isActive('/settings') ? 'page' : undefined}
              className={cn(
                'flex flex-1 items-center gap-1.5 rounded-lg px-3 py-2 transition-colors',
                isActive('/settings')
                  ? 'bg-accent text-foreground'
                  : 'text-foreground/78 hover:text-foreground hover:bg-accent'
              )}
            >
              <img src={iconSettings} alt="" className="h-[18px] w-[18px] flex-shrink-0" aria-hidden="true" />
              <span className="text-sm font-[350] leading-5 tracking-[0px] text-[#222529]">{t('sidebar.settings')}</span>
            </button>

            <button
              onClick={toggleExpanded}
              title={t('sidebar.collapseAria')}
              aria-label={t('sidebar.collapseAria')}
              className="-mr-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent"
            >
              <img src={iconSidebarCollapse} alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-1.5">
            {/* Collapse/expand toggle sits directly above 设置, 6px gap. */}
            <button
              onClick={toggleExpanded}
              title={t('sidebar.expandAria')}
              aria-label={t('sidebar.expandAria')}
              className={itemCls(false)}
            >
              <img src={iconSidebarOpen} alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            <button
              onClick={() => navigate('/settings')}
              title={t('sidebar.settings')}
              aria-label={t('sidebar.settings')}
              aria-current={isActive('/settings') ? 'page' : undefined}
              className={itemCls(isActive('/settings'))}
            >
              <img src={iconSettings} alt="" className="h-[18px] w-[18px] flex-shrink-0" aria-hidden="true" />
            </button>
          </div>
        )}

        {expanded && (
          <div
            onMouseDown={(event) => {
              event.preventDefault()
              setIsResizing(true)
            }}
            onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sidebar.resizeAria')}
            title={t('sidebar.resizeTitle')}
            className={cn(
              'absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors',
              isResizing ? 'bg-primary/60' : 'hover:bg-primary/40'
            )}
          />
        )}
      </nav>

      {projectMenuState && activeMenuProject && createPortal(
        <div
          ref={floatingMenuRef}
          className="fixed z-[80] min-w-[120px] rounded-xl border border-border bg-card p-1 shadow-lg"
          style={{ top: projectMenuState.top, left: projectMenuState.left }}
        >
          <button
            type="button"
            disabled={deletingProjectId === activeMenuProject.project.project_id}
            onClick={() => {
              setConfirmDeleteProject({
                projectId: activeMenuProject.project.project_id,
                name: activeMenuProject.displayName,
              })
              setProjectMenuState(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-950/20"
          >
            <Trash2 size={14} />
            {t('sidebar.delete')}
          </button>
        </div>,
        document.body
      )}

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
            {t('sidebar.rename')}
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
              {t('sessions.assignProject.exit')}
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
              {t('sessions.assignProject.join')}
            </button>
          )}
          <button
            onClick={() => {
              setConfirmDeleteSession({
                sessionId: activeMenuItem.id,
                title: activeMenuItem.title.trim() || activeMenuItem.label,
              })
              setMenuState(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <Trash2 size={14} />
            {t('sidebar.delete')}
          </button>
        </div>,
        document.body
      )}

      {confirmDeleteProject && createPortal(
        <div className="fixed inset-0 z-[95]">
          <div
            className="absolute inset-0 bg-black/35"
            onClick={() => {
              if (deletingProjectId) return
              setConfirmDeleteProject(null)
              setProjectActionError('')
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
              <h3 className="text-base font-semibold text-foreground">{t('projects.deleteConfirm.title')}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('projects.deleteConfirm.desc', { name: confirmDeleteProject.name })}
              </p>
              {projectActionError ? (
                <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/20">
                  {projectActionError}
                </p>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={Boolean(deletingProjectId)}
                  onClick={() => {
                    setConfirmDeleteProject(null)
                    setProjectActionError('')
                  }}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  disabled={Boolean(deletingProjectId)}
                  onClick={() => void handleDeleteProject(confirmDeleteProject.projectId)}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingProjectId ? t('projects.actions.deleting') : t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {searchOpen && createPortal(
        <div className="fixed inset-0 z-[140]">
          <button
            type="button"
            aria-label={t('search.close')}
            onClick={closeSearch}
            className="absolute inset-0 bg-white/28 backdrop-blur-[10px] dark:bg-slate-950/24"
          />

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-5">
            <div className="pointer-events-auto w-full max-w-[640px] overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.16)] dark:border-slate-800 dark:bg-slate-950">
              <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/82 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80">
                  <div className="relative min-w-0 flex-1">
                    {searchQuery.length === 0 && (
                      <SearchChatPlaceholder className="pointer-events-none absolute left-0 top-1/2 h-[26px] w-auto -translate-y-1/2" />
                    )}
                    <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      // ⌘/Ctrl + N is handled by the window listener
                      // in the parent effect — it closes the palette
                      // and navigates in one shot, so we don't need
                      // a duplicate path here.

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
                    placeholder=""
                    className="w-full bg-transparent text-[15px] text-foreground outline-none"
                  />
                  </div>
                  <span className="rounded-[9px] px-2.5 py-1 text-[11px] text-white" style={{ backgroundColor: '#9CA3AF' }}>
                    {isMac ? '⌘K' : 'Win+K'}
                  </span>
                </div>
              </div>

              <div className="max-h-[520px] overflow-y-auto px-4 py-4">
                <section>
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
                          <div className="flex min-w-0 items-center">
                            {item.id === 'new-session' ? (
                              <span className="flex items-center gap-2">
                                <NewTaskIcon className="h-[18px] w-[18px] flex-shrink-0" />
                                <NewChatItem className="block h-[24px] w-auto flex-shrink-0" />
                              </span>
                            ) : (
                              <p className="truncate text-sm font-medium" style={{ color: 'rgba(0, 0, 0, 0.8)' }}>{item.label}</p>
                            )}
                          </div>
                          <span className="rounded-[9px] px-2 py-0.5 text-[11px] text-white" style={{ backgroundColor: '#9CA3AF' }}>
                            {item.id === 'new-session' ? `${isMac ? '⌘' : 'Win'} + N` : 'Enter'}
                          </span>
                        </button>
                      )
                    }) : (
                      <div className="rounded-2xl px-3 py-3 text-sm text-muted-foreground">{t('search.noMatchActions')}</div>
                    )}
                  </div>
                </section>

                <section className="mt-2.5">
                  <div className="mb-1 px-2">
                    <RecentChatLabel className="h-[30px] w-auto text-[#9CA3AF]" />
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
                            <p className="truncate text-sm font-medium" style={{ color: 'rgba(0, 0, 0, 0.8)' }}>{item.label}</p>
                          </div>
                          <span className="ml-4 flex-shrink-0 rounded-[9px] px-2 py-0.5 text-[11px] text-white" style={{ backgroundColor: '#9CA3AF' }}>
                            {shortcut}
                          </span>
                        </button>
                      )
                    })}
                      </div>
                    ) : (
                      <div className="rounded-2xl px-3 py-3 text-sm text-muted-foreground">{t('search.noRecent')}</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
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
              <p className="mb-3 text-xs text-muted-foreground">{t('sessions.assignProject.desc')}</p>

              {projects.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('sessions.assignProject.noProjects')}</p>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-border">
                  {projects.map((project) => {
                    const currentSession = recentSessions.find((s) => s.session_id === assignDialog.sessionId)
                    const isCurrentProject = currentSession?.project_id === project.project_id
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
        open={confirmDeleteSession !== null}
        title={confirmDeleteSession?.title || ''}
        onCancel={() => setConfirmDeleteSession(null)}
        onConfirm={() => {
          if (!confirmDeleteSession) return
          const sessionId = confirmDeleteSession.sessionId
          setConfirmDeleteSession(null)
          void handleDeleteRecentSession(sessionId)
        }}
      />
    </>
  )
}
