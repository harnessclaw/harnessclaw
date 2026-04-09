import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { WelcomeModal } from '../WelcomeModal'

interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto" aria-label="主内容区域">
          {children}
        </main>
      </div>
      <WelcomeModal />
    </div>
  )
}
