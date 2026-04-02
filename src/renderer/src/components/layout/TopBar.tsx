import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'

function StatusPill({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) {
  if (status === 'connected') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-status-connected" />
        已连接
      </span>
    )
  }

  if (status === 'connecting') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-600 border border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
        连接中...
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-500 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700">
      <span className="w-1.5 h-1.5 rounded-full bg-status-disconnected" />
      未连接
    </span>
  )
}

export function TopBar() {
  const harnessclawStatus = useHarnessclawStatus()

  return (
    <div className="titlebar-drag h-[52px] flex items-end pb-2 px-4 border-b border-border bg-transparent flex-shrink-0">
      {/* Left: name + status */}
      <div className="titlebar-no-drag flex items-center gap-2">
        <span className="text-base" aria-hidden="true">🤖</span>
        <span className="text-base font-semibold text-foreground">Harnessclaw</span>
        <StatusPill status={harnessclawStatus} />
      </div>

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  )
}
