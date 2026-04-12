import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { WelcomeModal } from '../WelcomeModal'

interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const isHome = location.pathname === '/'
  const showTopBar = location.pathname !== '/chat'
    && location.pathname !== '/skills'
    && location.pathname !== '/settings'
    && !isHome

  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      <div className="titlebar-drag pointer-events-none absolute inset-x-0 top-0 z-40 h-8 bg-transparent" aria-hidden="true" />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          {showTopBar && <TopBar />}
          <main className="flex-1 overflow-auto" aria-label="主内容区域">
            {children}
          </main>
        </div>
      </div>
      <WelcomeModal />
    </div>
  )
}
