import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowRight, Bot } from 'lucide-react'

const features = [
  { title: '本地优先', desc: '配置、日志和数据库都保存在你的设备上。' },
  { title: '稳定工作流', desc: '内置运行时会自动启动，常用流程打开即可用。' },
  { title: '工具可追踪', desc: '关键调用和运行日志会被记录，便于排查问题。' },
  { title: '灵活接入模型', desc: '填写 API Key、API Base 和默认模型后即可开始使用。' },
]

export function WelcomeModal() {
  const [visible, setVisible] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    window.appBridge.isFirstLaunch().then((isFirst) => {
      if (isFirst) {
        previousFocusRef.current = document.activeElement as HTMLElement
        setVisible(true)
      }
    })
  }, [])

  useEffect(() => {
    if (visible && modalRef.current) {
      modalRef.current.focus()
    }
  }, [visible])

  const handleClose = useCallback(() => {
    setVisible(false)
    window.appBridge.markLaunched()
    previousFocusRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose()
      return
    }

    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else if (document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
  }, [handleClose])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      ref={modalRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-[420px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-8 pb-2 pt-8 text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/5">
            <Bot size={30} className="text-primary" aria-hidden="true" />
          </div>
          <h2 id="welcome-title" className="text-xl font-semibold text-foreground">欢迎使用 Harnessclaw</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            本地桌面 AI 助手已经就绪，保存模型配置后即可开始使用。
          </p>
        </div>

        <div className="px-8 py-5">
          <ul className="space-y-2.5">
            {features.map((feature) => (
              <li key={feature.title} className="flex items-baseline gap-2 text-sm">
                <span className="w-1 h-1 translate-y-[-1px] flex-shrink-0 rounded-full bg-foreground/40" aria-hidden="true" />
                <span>
                  <span className="font-medium text-foreground">{feature.title}</span>
                  <span className="text-muted-foreground">：{feature.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-8 pb-8 pt-2">
          <button
            onClick={handleClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            开始使用
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
