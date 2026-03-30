import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  House,
  Zap,
  Puzzle,
  Store,
  Settings,
  Moon,
  Sun,
  PanelLeft
} from 'lucide-react'
import { cn } from '../../lib/utils'

interface NavItem {
  icon: React.ElementType
  path: string
  label: string
}

const navItems: NavItem[] = [
  { icon: House, path: '/', label: '首页' },
  { icon: Zap, path: '/chat', label: '对话' },
  { icon: Puzzle, path: '/skills', label: '技能' },
  { icon: Store, path: '/clawhub', label: 'ClawHub' },
]

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sidebar-expanded') === 'true')
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

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const itemCls = (active: boolean) => cn(
    'flex items-center rounded-lg transition-colors flex-shrink-0',
    expanded ? 'w-full gap-3 px-3 py-2' : 'w-11 h-11 justify-center',
    active
      ? 'text-primary bg-accent'
      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
  )

  const bottomItemCls = cn(
    'flex items-center rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-accent',
    expanded ? 'w-full gap-3 px-3 py-2' : 'w-11 h-11 justify-center'
  )

  return (
    <nav
      aria-label="主导航"
      className={cn(
        'flex-shrink-0 bg-card border-r border-border flex flex-col pt-[52px] pb-3 gap-1 select-none transition-[width] duration-200 overflow-hidden',
        expanded ? 'w-44 items-start px-2' : 'w-[78px] items-center'
      )}
    >
      {/* Nav items */}
      {navItems.map((item) => (
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

      {/* Spacer */}
      <div className="flex-1" />

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
  )
}
