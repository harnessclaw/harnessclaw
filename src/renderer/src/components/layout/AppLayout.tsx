import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './Sidebar'
import { WindowControls } from './WindowControls'
import { WindowResizeHandles } from './WindowResizeHandles'
import { useWindowMaximized } from '../../hooks/useWindowMaximized'
import { WelcomeModal } from '../WelcomeModal'
import { UpdateModal } from '../common/UpdateModal'

interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const { t } = useTranslation()
  const isSettingsPage = location.pathname === '/settings'
  const maximized = useWindowMaximized()

  return (
    <div
      className={`relative flex h-screen overflow-hidden bg-background ${
        maximized ? 'rounded-none' : 'rounded-[22px]'
      }`}
    >
      <div className="titlebar-drag pointer-events-none absolute inset-x-0 top-0 z-40 h-8 bg-transparent" aria-hidden="true" />
      <div className="flex min-h-0 flex-1">
        {!isSettingsPage && <Sidebar />}
        <div className="flex flex-1 flex-col min-w-0">
          <main className="flex-1 overflow-y-auto overflow-x-hidden" aria-label={t('sidebar.mainContentAria')}>
            {children}
          </main>
        </div>
      </div>
      {/* 必须在页面内容之后渲染:-webkit-app-region 的拖拽/非拖拽区域按 DOM 顺序
          叠加计算,后出现的覆盖先出现的。若放在 children 之前,页面自身的拖拽区
          (如 ChatPage 顶部 75px 标题栏拖拽层)会把这里的 no-drag 重新盖成 drag,
          导致最小化/最大化/关闭按钮的点击被系统拦去拖窗口而失效。 */}
      <WindowControls />
      <WindowResizeHandles />
      <WelcomeModal />
      <UpdateModal />
    </div>
  )
}
