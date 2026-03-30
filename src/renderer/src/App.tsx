import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './components/pages/HomePage'
import { AgentsPage } from './components/pages/AgentsPage'
import { SessionsPage } from './components/pages/SessionsPage'
import { ChatPage } from './components/pages/ChatPage'
import { SkillsPage } from './components/pages/SkillsPage'
import { ClawHubPage } from './components/pages/ClawHubPage'
import { SettingsPage } from './components/pages/SettingsPage'

function App() {
  return (
    <Router>
      <AppLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/clawhub" element={<ClawHubPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppLayout>
    </Router>
  )
}

export default App
