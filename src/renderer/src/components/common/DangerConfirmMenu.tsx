import { Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'

interface DangerConfirmMenuProps {
  confirming: boolean
  disabled?: boolean
  pending?: boolean
  actionLabel?: string
  title?: string
  cancelLabel?: string
  confirmLabel?: string
  pendingLabel?: string
  className?: string
  onRequestConfirm: () => void
  onCancel: () => void
  onConfirm: () => void
}

export function DangerConfirmMenu({
  confirming,
  disabled = false,
  pending = false,
  actionLabel = '删除',
  title = '确认删除？',
  cancelLabel = '取消',
  confirmLabel = '确认',
  pendingLabel = '处理中',
  className,
  onRequestConfirm,
  onCancel,
  onConfirm,
}: DangerConfirmMenuProps) {
  if (confirming) {
    return (
      <div
        data-danger-confirm-dialog
        className={cn('absolute inset-0 z-[70] flex items-center justify-center bg-black/16 px-4', className)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            onCancel()
          }
        }}
      >
        <div className="w-full max-w-[260px] rounded-2xl border border-border bg-popover p-3 shadow-[0_18px_48px_rgba(15,23,42,0.18)]">
          <div className="space-y-3">
            <p className="text-center text-sm font-medium text-foreground">{title}</p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex min-h-10 min-w-20 items-center justify-center rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={disabled || pending}
                onClick={onConfirm}
                className="inline-flex min-h-10 min-w-20 items-center justify-center rounded-xl border border-border bg-card px-3 py-2 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? pendingLabel : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('w-28 rounded-xl border border-border bg-popover p-1 shadow-lg', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={onRequestConfirm}
        className="flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-2 text-center text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Trash2 size={14} className="text-destructive" />
        <span>{actionLabel}</span>
      </button>
    </div>
  )
}
