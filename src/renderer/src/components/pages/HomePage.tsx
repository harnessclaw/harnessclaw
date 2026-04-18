import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paperclip, Send } from 'lucide-react'
import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'
import { cn } from '../../lib/utils'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'

const isMac = navigator.platform.toUpperCase().includes('MAC')

type AttachmentItem = LocalAttachmentItem

const statusMeta = {
  connected: {
    label: '已连接',
    description: '把问题、目标或文件放进来，然后直接开始一次新对话。',
  },
  connecting: {
    label: '连接中',
    description: '连接正在建立。你可以先整理输入，准备好后立即发送。',
  },
  disconnected: {
    label: '未连接',
    description: '先写下想法也没关系，连接完成后就能继续处理。',
  },
} as const

export function HomePage() {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const navigate = useNavigate()
  const maxLength = 2000
  const harnessclawStatus = useHarnessclawStatus()
  const shortcutHint = isMac ? 'Cmd + Enter 发送' : 'Ctrl + Enter 发送'
  const currentStatus = statusMeta[harnessclawStatus]

  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => {
      event.preventDefault()
    }

    window.addEventListener('dragover', preventWindowDrop)
    window.addEventListener('drop', preventWindowDrop)

    return () => {
      window.removeEventListener('dragover', preventWindowDrop)
      window.removeEventListener('drop', preventWindowDrop)
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const appendAttachments = (items: AttachmentItem[]) => {
    if (!items.length) return

    setAttachments((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]))
      for (const item of items) {
        byId.set(item.path, { ...item, id: item.path })
      }
      return [...byId.values()]
    })
  }

  const handleSend = () => {
    if (!input.trim() && attachments.length === 0) return
    navigate('/chat', { state: { initialMessage: input, initialAttachments: attachments } })
    setInput('')
    setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend()
    }
  }

  const handlePickFiles = async () => {
    if (harnessclawStatus !== 'connected') return

    const picked = await window.files.pick()
    if (!picked.length) return
    appendAttachments(picked.map((item) => ({ ...item, id: item.path })))
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (harnessclawStatus !== 'connected') return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (harnessclawStatus !== 'connected') return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const droppedPaths = Array.from(e.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path || '')
      .filter(Boolean)

    if (!droppedPaths.length) return
    const resolved = await window.files.resolve(droppedPaths)
    appendAttachments(resolved.map((item) => ({ ...item, id: item.path })))
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  return (
    <div className="flex min-h-full justify-center px-6 pb-10 pt-[clamp(3rem,9vh,6rem)]">
      <div className="w-full max-w-[760px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                harnessclawStatus === 'connected'
                  ? 'bg-status-connected'
                  : harnessclawStatus === 'connecting'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-status-disconnected'
              )}
            />
            <span>HarnessClaw {currentStatus.label}</span>
          </div>

          <h1 className="font-pixel-arcade text-[clamp(2.6rem,7vw,4.25rem)] leading-none text-foreground">
            HarnessClaw
          </h1>

          <p className="max-w-[520px] text-sm leading-6 text-muted-foreground">
            {currentStatus.description}
          </p>
        </div>

        <div
          className={cn(
            'relative overflow-hidden rounded-[28px] border bg-card transition-[border-color,box-shadow,transform] duration-200',
            'focus-within:border-primary focus-within:shadow-[0_18px_54px_rgba(15,23,42,0.08)]',
            isDragOver
              ? 'border-primary shadow-[0_20px_60px_rgba(37,99,235,0.12)]'
              : 'border-border shadow-[0_12px_40px_rgba(15,23,42,0.04)]'
          )}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-card text-sm text-primary">
              松开即可添加文件
            </div>
          )}

          <div className="p-5 sm:p-6">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, maxLength))}
              onKeyDown={handleKeyDown}
              placeholder="+ 输入问题、目标或下一步，我来接手。"
              aria-label="输入你的问题"
              className="min-h-[56px] max-h-[112px] w-full resize-none bg-transparent text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground"
              rows={3}
            />

            <AttachmentPreviewPanel
              attachments={attachments}
              onRemove={handleRemoveAttachment}
            />

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handlePickFiles}
                  disabled={harnessclawStatus !== 'connected'}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                  title="选择本地文件"
                >
                  <Paperclip size={12} />
                  <span>添加文件</span>
                </button>
                <span className="text-xs text-muted-foreground">
                  支持拖拽，{shortcutHint}
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                {input.length > 0 && (
                  <span className="text-xs text-muted-foreground">{input.length}/{maxLength}</span>
                )}
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-primary dark:text-primary-foreground"
                >
                  <span>发送</span>
                  <Send size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
