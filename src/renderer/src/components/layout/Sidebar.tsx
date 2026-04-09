import { useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  House,
  Moon,
  PanelLeft,
  Puzzle,
  Settings,
  Shield,
  Store,
  Sun,
  Zap,
} from 'lucide-react'
import { cn } from '../../lib/utils'

interface NavItem {
  icon: React.ElementType
  path: string
  label: string
}

const navItems: NavItem[] = [
  { icon: House, path: '/', label: '首页' },
  { icon: Zap, path: '/chat', label: '聊天' },
  { icon: Puzzle, path: '/skills', label: '技能' },
  { icon: Store, path: '/clawhub', label: 'ClawHub' },
  { icon: Shield, path: '/doctor', label: 'Doctor' },
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
    'flex flex-shrink-0 items-center rounded-lg transition-colors',
    expanded ? 'w-full gap-3 px-3 py-2' : 'h-11 w-11 justify-center',
    active
      ? 'bg-accent text-primary'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  )

  const bottomItemCls = cn(
    'flex items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
    expanded ? 'w-full gap-3 px-3 py-2' : 'h-11 w-11 justify-center'
  )

  return (
    <nav
      aria-label="主导航"
      className={cn(
        'flex flex-shrink-0 select-none flex-col gap-1 overflow-hidden border-r border-border bg-card pb-3 pt-[52px] transition-[width] duration-200',
        expanded ? 'w-44 items-start px-2' : 'w-[78px] items-center'
      )}
    >
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

      <div className="flex-1" />

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

      <button
        onClick={toggleTheme}
        title={expanded ? undefined : isDark ? '切换到浅色模式' : '切换到深色模式'}
        aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
        className={bottomItemCls}
      >
        {isDark
          ? <Sun size={18} className="flex-shrink-0" aria-hidden="true" />
          : <Moon size={18} className="flex-shrink-0" aria-hidden="true" />}
        {expanded && <span className="text-sm font-medium">{isDark ? '浅色模式' : '深色模式'}</span>}
      </button>

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
