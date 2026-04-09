import { Bot } from 'lucide-react'
import { useAppRuntimeStatus } from '../../hooks/useAppRuntimeStatus'

function StatusPill({ status }: { status: 'ready' | 'starting' | 'degraded' }) {
  if (status === 'ready') {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-status-connected" />
        已连接
      </span>
    )
  }

  if (status === 'starting') {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-600 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
        连接中
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400">
      <span className="h-1.5 w-1.5 rounded-full bg-status-disconnected" />
      未就绪
    </span>
  )
}

export function TopBar() {
  const runtimeStatus = useAppRuntimeStatus()

  return (
    <div className="titlebar-drag flex h-[52px] flex-shrink-0 items-end border-b border-border bg-transparent px-4 pb-2">
      <div className="titlebar-no-drag flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-primary" aria-hidden="true">
          <Bot size={16} />
        </span>
        <span className="text-base font-semibold text-foreground">Harnessclaw</span>
        <StatusPill status={runtimeStatus.localService} />
      </div>

      <div className="flex-1" />
    </div>
  )
}
