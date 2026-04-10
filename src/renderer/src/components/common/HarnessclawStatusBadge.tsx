import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'
import { cn } from '@/lib/utils'

export function HarnessclawStatusBadge({ className }: { className?: string }) {
  const status = useHarnessclawStatus()
  const label = status === 'connected' ? 'Online' : status === 'connecting' ? 'Connecting' : 'Offline'
  const dotClass =
    status === 'connected'
      ? 'bg-emerald-500'
      : status === 'connecting'
        ? 'bg-amber-500 animate-pulse'
        : 'bg-rose-500'
  const textClass =
    status === 'connected'
      ? 'text-emerald-600'
      : status === 'connecting'
        ? 'text-amber-600'
        : 'text-rose-600'

  return (
    <span
      className={cn(
        'flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium shadow-[0_8px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/80',
        className
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', dotClass)} />
      <span className={textClass}>{label}</span>
    </span>
  )
}
