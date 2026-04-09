import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, HelpCircle, Image, Paperclip, Pencil, Puzzle, Send } from 'lucide-react'
import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'

const isMac = navigator.platform.toUpperCase().includes('MAC')

type AttachmentItem = LocalAttachmentItem

export function HomePage() {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const navigate = useNavigate()
  const maxLength = 2000
  const harnessclawStatus = useHarnessclawStatus()
  const shortcutHint = useMemo(() => (isMac ? 'Command + Enter 发送' : 'Ctrl + Enter 发送'), [])

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

  const quickActions = [
    { icon: Image, label: '创作图片', prompt: '帮我创作一张图片' },
    { icon: BookOpen, label: '学习知识', prompt: '帮我学习一个知识点' },
    { icon: Pencil, label: '编辑文本', prompt: '帮我编辑以下文本' },
    { icon: HelpCircle, label: '操作帮助', prompt: '我需要操作帮助' },
  ]

  return (
    <div className="flex min-h-full flex-col items-center justify-start px-6 pb-8 pt-12">
      <div className="w-full max-w-[720px]">
        <h1 className="mb-8 text-center text-2xl font-semibold text-foreground">
          我们先从哪里开始呢？
        </h1>

        <div
          className={`relative mb-4 overflow-hidden rounded-2xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.1)] ${isDragOver ? 'border-primary shadow-[0_0_0_3px_rgba(37,99,235,0.16)]' : 'border-border'}`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 text-sm text-primary">
              松开即可添加文件
            </div>
          )}

          <div className="p-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, maxLength))}
              onKeyDown={handleKeyDown}
              placeholder="+ 有问题，尽管问"
              aria-label="输入您的问题"
              className="min-h-[80px] max-h-[200px] w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              rows={3}
            />

            <AttachmentPreviewPanel
              attachments={attachments}
              onRemove={handleRemoveAttachment}
            />

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handlePickFiles}
                disabled={harnessclawStatus !== 'connected'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                title="选择本地文件"
              >
                <Paperclip size={12} />
                <span>添加文件</span>
              </button>
              <span className="text-xs text-muted-foreground">也可直接拖拽文件到输入框</span>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{shortcutHint}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{input.length}/{maxLength}</span>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                  aria-label="发送"
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-send-btn transition-colors hover:opacity-80 disabled:opacity-50"
                >
                  <Send size={13} className="text-white" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => setInput(action.prompt)}
              className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
            >
              <action.icon size={14} aria-hidden="true" />
              {action.label}
            </button>
          ))}
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <Puzzle size={14} aria-hidden="true" />
            推荐技能
          </div>
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {harnessclawStatus === 'connected' ? '暂无推荐技能' : '连接 Harnessclaw 后显示推荐技能'}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
