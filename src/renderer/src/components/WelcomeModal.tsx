import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowRight } from 'lucide-react'

const features = [
  { title: '安全可靠', desc: '本地部署，数据不离开您的设备' },
  { title: '高效稳定', desc: '低延迟通信，多会话并行处理' },
  { title: '权限管控', desc: '工具调用白名单，操作可审计追溯' },
  { title: '多模型支持', desc: '灵活对接多种 AI 后端' },
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
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-[420px] bg-card rounded-2xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-8 pt-8 pb-2 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-foreground/5 mb-4">
            <span className="text-3xl" aria-hidden="true">🤖</span>
          </div>
          <h2 id="welcome-title" className="text-xl font-semibold text-foreground">欢迎使用 Harnessclaw</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            您的本地 AI 助手，安全、高效、可控
          </p>
        </div>

        {/* Features — simple list, no colored icons */}
        <div className="px-8 py-5">
          <ul className="space-y-2.5">
            {features.map((f) => (
              <li key={f.title} className="flex items-baseline gap-2 text-sm">
                <span className="w-1 h-1 rounded-full bg-foreground/40 flex-shrink-0 translate-y-[-1px]" aria-hidden="true" />
                <span>
                  <span className="font-medium text-foreground">{f.title}</span>
                  <span className="text-muted-foreground"> — {f.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 pt-2">
          <button
            onClick={handleClose}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            开始使用
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
