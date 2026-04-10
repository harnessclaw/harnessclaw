import { useEffect } from 'react'
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './components/pages/HomePage'
import { AgentsPage } from './components/pages/AgentsPage'
import { SessionsPage } from './components/pages/SessionsPage'
import { ChatPage } from './components/pages/ChatPage'
import { SkillsPage } from './components/pages/SkillsPage'
import { SettingsPage } from './components/pages/SettingsPage'

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
      <AppLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppLayout>
    </Router>
  )
}

export default App
