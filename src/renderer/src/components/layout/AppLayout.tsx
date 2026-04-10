import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { WelcomeModal } from '../WelcomeModal'

interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const showTopBar = location.pathname !== '/chat' && location.pathname !== '/skills'

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {showTopBar && <TopBar />}
        <main className="flex-1 overflow-auto" aria-label="主内容区域">
          {children}
        </main>
      </div>
      <WelcomeModal />
    </div>
  )
}
