import { useEffect } from 'react'
import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './components/pages/HomePage'
import { AgentsPage } from './components/pages/AgentsPage'
import { SessionsPage } from './components/pages/SessionsPage'
import { ChatPage } from './components/pages/ChatPage'
import { ProjectsPage } from './components/pages/ProjectsPage'
import { ProjectWorkspacePage } from './components/pages/ProjectWorkspacePage'
import { SkillsPage } from './components/pages/SkillsPage'
import { SettingsPage } from './components/pages/SettingsPage'
import { TeamPage } from './components/pages/TeamPage'
import { XLabPage } from './components/pages/XLabPage'
import { SchedulerPage } from './components/pages/SchedulerPage'

function RouteLogger() {
  const location = useLocation()

  useEffect(() => {
    void window.appRuntime.trackUsage({
      category: 'navigation',
      action: 'route_change',
      status: 'ok',
      details: { path: location.pathname },
    })
  }, [location.pathname])

  return null
}

/**
 * Global keyboard shortcuts. Mounted once inside the Router so it has
 * access to `useNavigate`.
 *
 * - **Cmd+,** (macOS) / **Ctrl+,** (Windows / Linux): open Settings.
 *   Mirrors the conventional "open Preferences" shortcut used by
 *   macOS apps, Chrome, VS Code, etc. The comma key here is matched
 *   by `event.key === ','` (which also covers Shift-comma rendering)
 *   so the binding works regardless of layout-specific key code.
 *   We deliberately skip the binding when the user is typing into an
 *   editable element (input / textarea / contenteditable) so we don't
 *   hijack literal "," input inside the composer or settings forms.
 */
/**
 * Bridges the quick-launcher window with the main app. When the user
 * submits a prompt in the Alfred-style launcher (Alt+Space), main
 * sends `launcher:question` to this renderer; we navigate to /chat
 * with the prompt as `initialMessage`. ChatPage's existing
 * `pendingInitialTurn` plumbing then auto-sends it as the first turn
 * of the new session.
 */
function LauncherBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = window.launcherApi?.onQuestion?.((prompt: string) => {
      const text = (prompt || '').trim()
      if (!text) return
      navigate('/chat', {
        state: {
          initialMessage: text,
          initialAttachments: [],
        },
      })
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [navigate])

  return null
}

/**
 * Bridges system notification clicks with navigation. When the user
 * clicks a notification for a pending question, main sends
 * `chat:navigate-to-session` to this renderer; we navigate to /chat
 * with the target sessionId.
 */
function ChatNavigationBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = window.chatApi?.onNavigateToSession?.((sessionId: string) => {
      if (!sessionId) return
      navigate('/chat', { state: { sessionId } })
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [navigate])

  return null
}

function GlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      if (event.altKey || event.shiftKey) return
      if (event.key !== ',') return

      // Don't override "," typed inside a composer / input / editable.
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }

      event.preventDefault()
      event.stopPropagation()
      if (location.pathname !== '/settings') {
        navigate('/settings')
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [navigate, location.pathname])

  return null
}

/**
 * Renders the routed pages.
 *
 * `ChatPage` is intentionally rendered here at the top level (rather than as a
 * `<Route>` element) and only hidden via CSS when the active route is not
 * `/chat`. This keeps the WebSocket event listeners, in-memory `sessionMap`,
 * pending streaming state, and the connection status alive across navigation,
 * so leaving the chat for the home page and returning does not lose the live
 * conversation state until the next event arrives.
 */
function RoutedContent() {
  const location = useLocation()
  const isChatRoute = location.pathname === '/chat'

  return (
    <>
      <div className={isChatRoute ? 'h-full' : 'hidden'} aria-hidden={!isChatRoute}>
        <ChatPage />
      </div>
      <div className={isChatRoute ? 'hidden' : 'h-full'} aria-hidden={isChatRoute}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          {/* /chat is rendered above as an always-mounted view; this route
              entry exists so navigation to /chat is still recognised but
              renders nothing inside the hidden Routes container. */}
          <Route path="/chat" element={null} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
          <Route path="/x-lab" element={<XLabPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/team" element={<TeamPage />} />
        </Routes>
      </div>
    </>
  )
}

function App() {
  useEffect(() => {
    void window.appRuntime.logRenderer('info', 'Renderer started')
    void window.appRuntime.trackUsage({
      category: 'app',
      action: 'renderer_start',
      status: 'ok',
    })
  }, [])

  return (
    <Router>
      <RouteLogger />
      <GlobalShortcuts />
      <LauncherBridge />
      <ChatNavigationBridge />
      <AppLayout>
        <RoutedContent />
      </AppLayout>
    </Router>
  )
}

export default App
