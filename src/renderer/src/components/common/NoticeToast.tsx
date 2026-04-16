import { cn } from '@/lib/utils'

export type NoticeTone = 'error' | 'info' | 'success'

export interface NoticeToastProps {
  tone: NoticeTone
  message: string
  position?: 'top' | 'bottom'
  anchor?: 'container' | 'viewport'
  className?: string
}

function tipToneClass(tone: NoticeTone): string {
  if (tone === 'error') return 'border-red-200 bg-white text-red-600'
  if (tone === 'success') return 'border-emerald-200 bg-white text-emerald-700'
  return 'border-border bg-white text-muted-foreground'
}

export function NoticeToast({
  tone,
  message,
  position = 'top',
  anchor = 'container',
  className,
}: NoticeToastProps) {
  return (
    <div
      className={cn(
        'pointer-events-none inset-x-0 z-30 flex justify-center px-4',
        anchor === 'viewport' ? 'fixed' : 'absolute',
        position === 'top' ? 'top-4' : 'bottom-5',
        className
      )}
    >
      <div className={cn('max-w-[min(36rem,92vw)] rounded-xl border px-4 py-2 text-sm shadow-lg', tipToneClass(tone))}>
        {message}
      </div>
    </div>
  )
}
