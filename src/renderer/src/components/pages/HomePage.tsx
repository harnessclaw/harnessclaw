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
import { WelcomeShaderBackground } from '../WelcomeShaderBackground'
import { HOME_HERO_SHADER } from '../../lib/homeHeroShader'
import { FilePreviewModal } from '../attachments/FilePreviewModal'
import type { FilePreviewData } from './ChatPage'
import { HOME_CASES, HOME_CATEGORIES } from '../../data/homeCases'
import iconAttachFile from '../../assets/icon-attach-file.svg'
import iconPlanMode from '../../assets/icon-plan-mode.svg'
import iconStatusConnected from '../../assets/status-connected.svg'
import iconStatusConnecting from '../../assets/status-connecting.svg'
import iconStatusOffline from '../../assets/status-offline.svg'
import sendIconActive from '../../assets/send-icon-active.svg'
import sendIcon from '../../assets/send-icon.svg'

type AttachmentItem = LocalAttachmentItem

// 推荐分类（id 同时是 HOME_CASES 的数据键，label 渲染时走 i18n）
const categories = [
  { id: 'recommend' },
  { id: '办公提效' },
  { id: '电脑设置' },
  { id: '学习助手' },
  { id: '日常生活' },
  { id: '休息娱乐' },
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
  // 顶部动态背景铺到「推荐区顶部」:背景高 = 推荐顶到主内容顶的距离;
  // 同时实测「输入框顶」的位置占比(heroFadePct),遮罩据此让上部保留橙色、
  // 到输入框一带渐隐到很淡、直至推荐顶完全透明。随窗口/内容变化重测
  // (内容 my-auto 垂直居中,位置会变,不能写死)。
  const heroRootRef = useRef<HTMLDivElement | null>(null)
  const composerBoxRef = useRef<HTMLDivElement | null>(null)
  const recommendRef = useRef<HTMLDivElement | null>(null)
  const [heroBgHeight, setHeroBgHeight] = useState(460)
  const [heroFadePct, setHeroFadePct] = useState(60)
  useEffect(() => {
    const root = heroRootRef.current
    const box = composerBoxRef.current
    const rec = recommendRef.current
    if (!root || !box || !rec) return
    const measure = () => {
      const rootTop = root.getBoundingClientRect().top
      const inputTop = box.getBoundingClientRect().top - rootTop
      const recTop = rec.getBoundingClientRect().top - rootTop
      if (recTop > 0) {
        setHeroBgHeight(Math.round(recTop))
        setHeroFadePct(Math.max(10, Math.min(90, Math.round((inputTop / recTop) * 100))))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    ro.observe(box)
    ro.observe(rec)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  const navigate = useNavigate()
  const maxLength = 2000
  const harnessclawStatus = useHarnessclawStatus()
  const shortcutHint = t('home.shortcutHint')
  const currentStatus = statusMeta[harnessclawStatus]
  // 标题右侧状态徽标:按客户端连接状态动态切换(已连接 / 连接中 / 离线)。
  const statusIcon = {
    connected: iconStatusConnected,
    connecting: iconStatusConnecting,
    disconnected: iconStatusOffline,
  }[harnessclawStatus]

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

    // DEBUG: 检查 planMode 状态
    console.log('[HomePage] handleSend - planMode:', planMode)
    console.log('[HomePage] navigate state:', {
      coordinatorMode: planMode ? 'plan' : undefined,
      planConfirmation: planMode ? 'required' : undefined,
    })

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

  const handleCaseClick = (caseItem: { prompt: string }) => {
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

  // 各分类案例数不一(如「日常生活」只有 1 条),切过去会让案例区从多行塌成
  // 一行、页面高度跳动。取所有 tab 里最多的条数,后面用隐形占位格把当前分类
  // 补齐到同样的格子数,保证案例区高度恒定、下方位置不变。
  const maxCaseCount = useMemo(() => {
    const featuredCount = HOME_CATEGORIES.reduce(
      (n, key) => n + HOME_CASES[key].filter((c) => c.featured).length,
      0,
    )
    const perCategoryMax = Math.max(...HOME_CATEGORIES.map((key) => HOME_CASES[key].length))
    return Math.max(featuredCount, perCategoryMax)
  }, [])

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

  // 遮罩:顶部实橙 → 上半(输入框顶之上)保留橙 → 输入框顶一带降到很淡(0.14)
  //  → 推荐顶完全透明。heroFadePct = 输入框顶在背景中的高度占比(实测)。
  const heroMask = `linear-gradient(to bottom, #000 0%, #000 ${Math.round(heroFadePct * 0.5)}%, rgba(0,0,0,0.14) ${heroFadePct}%, transparent 100%)`

  return (
    <div ref={heroRootRef} className="relative flex flex-col min-h-full overflow-hidden">
      {/* 动态橙色 shader 背景:全宽通铺主内容区顶部,铺到「推荐区顶部」
          (高度实测 heroBgHeight);输入框顶~推荐顶一段渐隐到很淡,秘书 / 文案 /
          输入框都浮在其上(更高 z,输入框自带不透明卡片底,背景不会透进去)。 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-0"
        style={{
          height: heroBgHeight,
          maskImage: heroMask,
          WebkitMaskImage: heroMask,
        }}
      >
        <WelcomeShaderBackground
          fragmentSrc={HOME_HERO_SHADER}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      </div>

      <div
        className="relative z-10 flex flex-1 flex-col pt-[90px] pb-[68px]"
        style={{ paddingLeft: '7%', paddingRight: '7%' }}
      >
      <div className="w-full relative my-auto">

        {/* 秘书图像 - 右上角，保持原始形状 */}
        <div className="absolute right-16 top-[-50px] w-[160px] h-[260px] pointer-events-none z-0">
          {/* 秘书人物 - 单独裁切：顶部向上扩展露出头部，底部维持裁切线 */}
          <div className="absolute inset-x-0 bottom-0 top-[-80px] overflow-hidden">
            <img
              src={new URL('../../assets/secretary-corner.svg', import.meta.url).href}
              alt="Emma Assistant"
              className="relative w-full h-[260px] object-contain object-top z-10 scale-[1.75] translate-y-[152px]"
            />
          </div>
          {/* hi Emma~ 图片 - 耳朵右边 */}
          <img
            src={new URL('../../assets/hi-emma.png', import.meta.url).href}
            alt="hi Emma~"
            className="absolute top-8 left-[140px] z-20 h-auto pointer-events-auto"
          />
        </div>

        {/* 顶部欢迎区域 - 纯文本 */}
        <div className="relative z-10">
          {/* 文字内容 */}
          <div className="relative z-10 max-w-[500px]">
            <div className="flex items-center gap-6 mb-[6px]">
              <h1 className="text-2xl font-bold text-[#222529]" style={{ fontFamily: 'Source Han Sans CN' }}>{t('home.title')}</h1>
              <img src={statusIcon} alt={currentStatus.label} className="h-7" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t('home.welcomeHint')}
            </p>
          </div>
        </div>

        {/* 输入框区域 */}
        <div
          ref={composerBoxRef}
          className={cn(
            'relative overflow-hidden rounded-[28px] border bg-card transition-[border-color,box-shadow,transform] duration-200 mt-[45px]',
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

              <div className="px-4 pt-3 pb-4">
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

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handlePickFiles}
                      disabled={harnessclawStatus !== 'connected'}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                      title={t('home.addFiles')}
                    >
                      <img src={iconAttachFile} alt="" className="h-3 w-3" aria-hidden="true" />
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
                      <img src={iconPlanMode} alt="" className="h-3 w-3" aria-hidden="true" />
                      <span>{t('home.planMode')}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={handleSend}
                      disabled={!buildSkillComposerPayload(input, selectedSkills) && attachments.length === 0 && pasted.blocks.length === 0}
                      className={cn(
                        "inline-flex items-center justify-center w-7 h-7 rounded-full transition-all active:scale-95 disabled:opacity-50",
                        (input.length > 0 || attachments.length > 0 || pasted.blocks.length > 0)
                          ? "bg-[#4E5969] hover:opacity-90"
                          : "bg-[#EEEEEE] hover:opacity-80"
                      )}
                    >
                      <img
                        src={
                          (input.length > 0 || attachments.length > 0 || pasted.blocks.length > 0)
                            ? sendIconActive
                            : sendIcon
                        }
                        alt={t('home.send')}
                        className="w-full h-full"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

        {/* 推荐区域 */}
        <div ref={recommendRef} className="mt-[45px]">
          {/* 分类标签 */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
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
                {t(`home.categories.${category.id}`)}
              </button>
            ))}
          </div>

          {/* 案例卡片网格 - 纯文本格式 */}
          <div className="grid grid-cols-3 gap-3">
            {displayedCases.map((caseItem) => (
              <button
                key={caseItem.id}
                onClick={() => handleCaseClick(caseItem)}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all hover:shadow-md min-h-[120px]"
              >
                {/* 标题 */}
                <h3 className="text-base font-medium text-foreground">
                  {t(`home.cases.${caseItem.id}.title`)}
                </h3>

                {/* 描述 */}
                <p className="text-sm text-muted-foreground line-clamp-4">
                  {t(`home.cases.${caseItem.id}.content`)}
                </p>
              </button>
            ))}
            {/* 隐形占位格:把当前分类补齐到最大条数,保证案例区高度恒定、
                切分类时下方内容不上移(只占位,不显示任何内容)。 */}
            {Array.from({ length: Math.max(0, maxCaseCount - displayedCases.length) }).map((_, i) => (
              <div key={`case-placeholder-${i}`} aria-hidden="true" className="invisible min-h-[120px]" />
            ))}
          </div>
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
