import { useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Paperclip, Send, ListChecks } from 'lucide-react'
import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'
import { cn } from '../../lib/utils'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'
import {
  buildSkillComposerPayload,
  SkillComposerInput,
  type SelectedSkillChip,
} from '../common/SkillComposerInput'
import { PastedBlocksBar, usePastedBlocks } from '../common/PastedBlocksBar'
import { FilePreviewModal } from '../attachments/FilePreviewModal'
import type { FilePreviewData } from './ChatPage'
import { HOME_CASES, HOME_CATEGORIES } from '../../data/homeCases'

type AttachmentItem = LocalAttachmentItem

// 推荐分类
const categories = [
  { id: 'recommend', label: '推荐' },
  { id: '办公提效', label: '办公提效' },
  { id: '电脑设置', label: '电脑设置' },
  { id: '学习助手', label: '学习助手' },
  { id: '日常生活', label: '日常生活' },
  { id: '休息娱乐', label: '休息娱乐' },
]

export function HomePage() {
  const { t } = useTranslation()
  const location = useLocation()
  const [input, setInput] = useState('')

  const statusMeta = useMemo(() => ({
    connected: {
      label: t('home.status.connected'),
      description: t('home.status.connectedDesc'),
    },
    connecting: {
      label: t('home.status.connecting'),
      description: t('home.status.connectingDesc'),
    },
    disconnected: {
      label: t('home.status.disconnected'),
      description: t('home.status.disconnectedDesc'),
    },
  }), [t])

  const [selectedSkills, setSelectedSkills] = useState<SelectedSkillChip[]>([])
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('recommend')
  // v1.14: opt-in Plan mode pin for the upcoming turn. When false the engine
  // picks ReAct/Plan automatically via its ModeSelector heuristic.
  const [planMode, setPlanMode] = useState(false)
  // 附件预览抽屉的 state。点击 AttachmentPreviewPanel 里的卡片会先调
  // window.files.read 把内容/二进制标记拿回来，然后塞进 filePreview，
  // FilePreviewDrawer 接到非 null 值即显示。
  const [filePreview, setFilePreview] = useState<FilePreviewData | null>(null)
  const pasted = usePastedBlocks()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const navigate = useNavigate()
  const maxLength = 2000
  const harnessclawStatus = useHarnessclawStatus()
  const shortcutHint = t('home.shortcutHint')
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

  useEffect(() => {
    if (location.state?.focusComposer !== true) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [location.key, location.state])

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
    const payload = buildSkillComposerPayload(input, selectedSkills)
    if (!payload && attachments.length === 0 && pasted.blocks.length === 0) return
    const pastedSuffix = pasted.buildPastedSuffix()
    const fullMessage = [payload, pastedSuffix].filter(Boolean).join('\n\n')
    navigate('/chat', {
      state: {
        initialMessage: fullMessage,
        initialAttachments: attachments,
        // v1.14: only forward when explicitly enabled, so the engine keeps
        // its automatic ModeSelector heuristic in the default case.
        coordinatorMode: planMode ? 'plan' : undefined,
        // v1.15: opting into Plan mode also implies the user wants to
        // review the draft step DAG before execution. This couples the two
        // toggles so the user only has to flip one switch.
        planConfirmation: planMode ? 'required' : undefined,
      },
    })
    setInput('')
    setSelectedSkills([])
    setAttachments([])
    pasted.clearBlocks()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
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

  const handleCaseClick = (caseItem: { title: string; content: string; prompt: string }) => {
    setInput(caseItem.prompt)
    inputRef.current?.focus()
  }

  // 获取当前分类的案例
  const displayedCases = useMemo(() => {
    if (selectedCategory === 'recommend') {
      // 推荐：取所有 featured=true 的案例
      return HOME_CATEGORIES.flatMap((categoryKey) =>
        HOME_CASES[categoryKey].filter((c) => c.featured)
      )
    } else {
      // 具体分类：取对应分类下的所有案例
      return HOME_CASES[selectedCategory] || []
    }
  }, [selectedCategory])

  // Paste hand-off: clipboard images go to the attachments pipeline
  // (same shape as drag/drop), everything else falls through to the
  // pasted-text bar via the existing hook. Both flows can fire in a
  // single paste event (e.g. screenshot + selected text), so we don't
  // short-circuit text handling when an image is found.
  const handleComposerPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (harnessclawStatus !== 'connected') {
      pasted.handlePaste(e)
      return
    }
    const items = e.clipboardData?.items
    const imageFiles: File[] = []
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) imageFiles.push(f)
        }
      }
    }
    if (imageFiles.length === 0) {
      pasted.handlePaste(e)
      return
    }
    // Suppress the textarea inserting an image-shaped "filename" string,
    // but still let the pasted-text hook scan for any text payload that
    // came along in the same event.
    e.preventDefault()
    pasted.handlePaste(e)
    const saved: AttachmentItem[] = []
    for (const f of imageFiles) {
      try {
        const buf = await f.arrayBuffer()
        const res = await window.files.saveClipboardImage(buf, f.type || 'image/png')
        if (res.ok) saved.push({ ...res.file, id: res.file.path })
      } catch (err) {
        console.error('Failed to save pasted image:', err)
      }
    }
    if (saved.length) appendAttachments(saved)
  }

  return (
    <div className="flex min-h-full justify-center px-6 pb-6 pt-12">
      <div className="w-full max-w-[860px] relative">
        {/* 橙色背景 - 从秘书原位置斜着延伸到窗口右上角 */}
        <div className="absolute right-16 top-0 w-[224px] h-[260px] pointer-events-none z-0">
          <img
            src={new URL('../../assets/secretary-bg.png', import.meta.url).href}
            alt=""
            className="w-full h-full object-cover scale-[2]"
            style={{ objectPosition: 'left center' }}
          />
        </div>

        {/* 秘书图像 - 右上角，保持原始形状 */}
        <div className="absolute right-16 top-0 w-[160px] h-[260px] pointer-events-none z-0">
          {/* 秘书人物 - 单独裁切 */}
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={new URL('../../assets/secretary-corner.svg', import.meta.url).href}
              alt="Emma Assistant"
              className="relative w-full h-full object-contain object-top z-10 scale-[1.8] translate-y-20"
            />
          </div>
          {/* hi Emma~ 图片 - 耳朵右边 */}
          <img
            src={new URL('../../assets/hi-emma.png', import.meta.url).href}
            alt="hi Emma~"
            className="absolute top-12 left-[140px] z-20 h-auto pointer-events-auto"
          />
        </div>

        {/* 顶部欢迎区域 - 纯文本，下移 */}
        <div className="mb-8 relative pt-[60px] z-10">
          {/* 文字内容 */}
          <div className="relative z-10 max-w-[500px]">
            <div className="flex items-center gap-6 mb-2">
              <h1 className="text-2xl font-bold text-foreground">Emma 超好用</h1>
              <span className="inline-flex items-center gap-1.5 text-sm font-normal leading-5 text-[#02B578]">
                <span className="h-2 w-2 rounded-full bg-[#02B578]" />
                24h Online
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              把问题、目标或文件放这来，然后直接开始一次新对话。
            </p>
          </div>
        </div>

        {/* 输入框区域 */}
        <div
          className={cn(
            'relative overflow-hidden rounded-[28px] border bg-card transition-[border-color,box-shadow,transform] duration-200 mt-12',
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
                  {t('home.dropToFiles')}
                </div>
              )}

              <div className="p-4">
                {pasted.blocks.length > 0 && (
                  <div className="mb-2">
                    <PastedBlocksBar
                      blocks={pasted.blocks}
                      onRemove={pasted.removeBlock}
                      onUpdate={pasted.updateBlock}
                    />
                  </div>
                )}
                <SkillComposerInput
                  textareaRef={inputRef}
                  value={input}
                  onChange={setInput}
                  selectedSkills={selectedSkills}
                  onSelectedSkillsChange={setSelectedSkills}
                  onKeyDown={handleKeyDown}
                  onPaste={handleComposerPaste}
                  placeholder={t('home.inputPlaceholder')}
                  maxLength={maxLength}
                  className="text-sm"
                  rows={1}
                />

                <AttachmentPreviewPanel
                  attachments={attachments}
                  onRemove={handleRemoveAttachment}
              // 点击附件即开预览。预读走主进程的 files:read：图片/音频/视频
              // 不依赖 content；docx/pdf/xlsx/pptx 走富预览；纯文本/Markdown
              // 直接拿到字符串；其它二进制保留占位 + 导出原文件。
              onPreview={async (attachment) => {
                try {
                  const result = await window.files.read(attachment.path)
                  setFilePreview({
                    path: result?.path || attachment.path,
                    fileName: attachment.name || attachment.path.split(/[\\/]/).pop() || attachment.path,
                    operation: 'read_file',
                    content: result?.ok && typeof result.content === 'string' ? result.content : '',
                    isBinary: result?.ok ? Boolean(result.isBinary) : false,
                    previewKind:
                      result?.ok && (result.previewKind === 'html' || result.previewKind === 'text')
                        ? result.previewKind
                        : undefined,
                  })
                } catch (err) {
                  console.error('Failed to preview attachment:', err)
                  setFilePreview({
                    path: attachment.path,
                    fileName: attachment.name || attachment.path,
                    operation: 'read_file',
                    content: '',
                  })
                }
              }}
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handlePickFiles}
                      disabled={harnessclawStatus !== 'connected'}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                      title={t('home.addFiles')}
                    >
                      <Paperclip size={12} />
                      <span>{t('home.addFiles')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlanMode((v) => !v)}
                      aria-pressed={planMode}
                      title={planMode ? t('home.planModeEnabled') : t('home.planModeDisabled')}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs transition-colors',
                        planMode
                          ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                          : 'border-border text-muted-foreground hover:border-primary hover:text-foreground'
                      )}
                    >
                      <ListChecks size={12} />
                      <span>{t('home.planMode')}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {input.length > 0 && (
                      <span className="text-xs text-muted-foreground">{input.length}/{maxLength}</span>
                    )}
                    <button
                      onClick={handleSend}
                      disabled={!buildSkillComposerPayload(input, selectedSkills) && attachments.length === 0 && pasted.blocks.length === 0}
                      className="inline-flex items-center justify-center rounded-full bg-gray-200 p-2.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <img
                        src={new URL('../../assets/navigation-line.svg', import.meta.url).href}
                        alt={t('home.send')}
                        className="h-5 w-5"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

        {/* 推荐区域 */}
        <div className="mt-12">
          {/* 分类标签 */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  'rounded-full px-1.5 py-1 text-xs leading-5 transition-colors',
                  selectedCategory === category.id
                    ? 'font-semibold'
                    : 'font-medium text-muted-foreground hover:text-foreground'
                )}
                style={selectedCategory === category.id ? { color: '#222529' } : undefined}
              >
                {category.label}
              </button>
            ))}
          </div>

          {/* 案例卡片网格 - 纯文本格式 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayedCases.map((caseItem, index) => (
              <button
                key={`${selectedCategory}-${index}`}
                onClick={() => handleCaseClick(caseItem)}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md min-h-[120px]"
              >
                {/* 标题 */}
                <h3 className="text-base font-medium text-foreground group-hover:text-primary transition-colors">
                  {caseItem.title}
                </h3>

                {/* 描述 */}
                <p className="text-sm text-muted-foreground line-clamp-4">
                  {caseItem.content}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 附件预览弹窗。首页是轻量入口，不再使用与对话页相同的右侧抽屉，
          改用 FilePreviewModal —— 居中 modal、点击遮罩或 Esc 关闭。
          内部 createPortal 到 body，不受当前容器 overflow / transform
          影响。 */}
      <FilePreviewModal preview={filePreview} onClose={() => setFilePreview(null)} />
    </div>
  )
}
