import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FileText, X, Clipboard } from 'lucide-react'

export interface PastedBlock {
  id: string
  content: string
  lines: number
  ts: number
}

interface PastedBlocksBarProps {
  blocks: PastedBlock[]
  onRemove: (id: string) => void
  removable?: boolean
}

export function usePastedBlocks() {
  const [blocks, setBlocks] = useState<PastedBlock[]>([])
  const [preview, setPreview] = useState<{ content: string; lines: number } | null>(null)

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData?.getData('text/plain') || ''
    const lineCount = text.split('\n').length
    if (lineCount >= 3) {
      e.preventDefault()
      setBlocks((prev) => [
        ...prev,
        { id: `paste-${Date.now()}-${prev.length}`, content: text, lines: lineCount, ts: Date.now() },
      ])
    }
  }, [])

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const clearBlocks = useCallback(() => setBlocks([]), [])

  const buildPastedSuffix = useCallback(() => {
    if (blocks.length === 0) return ''
    return blocks.map((b) => b.content).join('\n\n')
  }, [blocks])

  return { blocks, setBlocks, preview, setPreview, handlePaste, removeBlock, clearBlocks, buildPastedSuffix }
}

export function PastedBlocksBar({ blocks, onRemove, removable = true }: PastedBlocksBarProps) {
  const [preview, setPreview] = useState<{ content: string; lines: number } | null>(null)

  useEffect(() => {
    if (!preview) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview])

  if (blocks.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {blocks.map((block) => (
          <div
            key={block.id}
            className="group flex h-10 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 pl-2.5 pr-1.5 transition-colors hover:border-primary/35 hover:bg-primary/8 dark:border-primary/15 dark:bg-primary/10"
          >
            <button
              type="button"
              onClick={() => setPreview({ content: block.content, lines: block.lines })}
              className="flex min-w-0 items-center gap-1.5"
            >
              <Clipboard size={13} className="flex-shrink-0 text-primary/70" />
              <span className="text-xs font-medium text-foreground">粘贴</span>
              <span className="text-[11px] text-muted-foreground">{block.lines} 行</span>
            </button>
            {removable && (
              <button
                type="button"
                onClick={() => onRemove(block.id)}
                aria-label="移除粘贴内容"
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-foreground"
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>

      {preview && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]" onClick={() => setPreview(null)} />
          <div className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">粘贴内容预览</span>
                <span className="rounded-full border border-border bg-accent/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {preview.lines} 行
                </span>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
                aria-label="关闭预览"
              >
                <X size={14} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-foreground">
                {preview.content.split('\n').map((line, i) => (
                  <div key={i} className="flex">
                    <span className="mr-4 inline-block w-8 flex-shrink-0 select-none text-right text-muted-foreground/50">{i + 1}</span>
                    <span className="min-w-0 flex-1">{line || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
