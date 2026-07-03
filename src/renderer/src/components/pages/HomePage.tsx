import { useEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronRight, Folder, Hand, NotebookText, Plus, Search, Shield, ShieldCheck, X } from 'lucide-react'
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
import { getProjectDisplayDescription, getProjectDisplayName } from '../../lib/projectDisplay'
import iconAttachFile from '../../assets/icon-attach-file.svg'
import iconStatusConnected from '../../assets/status-connected.svg'
import iconStatusConnecting from '../../assets/status-connecting.svg'
import iconStatusOffline from '../../assets/status-offline.svg'
import sendIconActive from '../../assets/send-icon-active.svg'
import sendIcon from '../../assets/send-icon.svg'

type AttachmentItem = LocalAttachmentItem
type PermissionMode = 'request' | 'auto' | 'full'
const PERMISSION_MODE_STORAGE_KEY = 'home-permission-mode'

interface HomeProject {
  project_id: string
  name: string
  description: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

const PERMISSION_MODES: Array<{
  id: PermissionMode
  icon: typeof Hand
  approvalsReviewer?: 'user' | 'auto_review'
  approvalPolicy?: 'on-request' | 'never'
  sandbox?: 'danger-full-access'
}> = [
  { id: 'request', icon: Hand, approvalsReviewer: 'user', approvalPolicy: 'on-request' },
  { id: 'auto', icon: Shield, approvalsReviewer: 'auto_review', approvalPolicy: 'on-request' },
  { id: 'full', icon: ShieldCheck, approvalsReviewer: 'user', approvalPolicy: 'never', sandbox: 'danger-full-access' },
]

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'request' || value === 'auto' || value === 'full'
}

function getProjectCwd(project: HomeProject | null): string | undefined {
  const value = project?.description?.trim()
  if (!value) return undefined
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return value
  return undefined
}

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
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    if (typeof window === 'undefined') return 'request'
    const saved = window.localStorage.getItem(PERMISSION_MODE_STORAGE_KEY)
    return isPermissionMode(saved) ? saved : 'request'
  })
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false)
  const [permissionMenuPosition, setPermissionMenuPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [projects, setProjects] = useState<HomeProject[]>([])
  const [selectedProject, setSelectedProject] = useState<HomeProject | null>(null)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [projectMenuPosition, setProjectMenuPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const [newProjectOptionsOpen, setNewProjectOptionsOpen] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [projectFolderDraft, setProjectFolderDraft] = useState<string | null>(null)
  const [projectError, setProjectError] = useState('')
  const [isSending, setIsSending] = useState(false)
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
  const permissionButtonRef = useRef<HTMLButtonElement | null>(null)
  const permissionMenuRef = useRef<HTMLDivElement | null>(null)
  const projectButtonRef = useRef<HTMLButtonElement | null>(null)
  const projectMenuRef = useRef<HTMLDivElement | null>(null)
  const projectNameInputRef = useRef<HTMLInputElement | null>(null)
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
  const currentPermission = PERMISSION_MODES.find((mode) => mode.id === permissionMode) || PERMISSION_MODES[0]
  const CurrentPermissionIcon = currentPermission.icon
  const filteredProjects = projects.filter((project) => {
    const query = projectSearch.trim().toLowerCase()
    if (!query) return true
    return project.name.toLowerCase().includes(query) || project.description.toLowerCase().includes(query)
  })

  const updatePermissionMenuPosition = () => {
    const button = permissionButtonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 330
    const margin = 12
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - menuWidth - margin)
    setPermissionMenuPosition({
      left,
      bottom: Math.max(margin, window.innerHeight - rect.top + 8),
    })
  }

  const updateProjectMenuPosition = () => {
    const button = projectButtonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 340
    const margin = 12
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - menuWidth - margin)
    setProjectMenuPosition({
      left,
      bottom: Math.max(margin, window.innerHeight - rect.top + 8),
    })
  }

  useEffect(() => {
    void window.db.listProjects().then((rows) => setProjects(rows as HomeProject[])).catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PERMISSION_MODE_STORAGE_KEY, permissionMode)
  }, [permissionMode])

  useEffect(() => {
    if (!permissionMenuOpen) return
    updatePermissionMenuPosition()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (permissionButtonRef.current?.contains(target)) return
      if (permissionMenuRef.current?.contains(target)) return
      setPermissionMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPermissionMenuOpen(false)
    }

    window.addEventListener('resize', updatePermissionMenuPosition)
    window.addEventListener('scroll', updatePermissionMenuPosition, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', updatePermissionMenuPosition)
      window.removeEventListener('scroll', updatePermissionMenuPosition, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [permissionMenuOpen])

  useEffect(() => {
    if (!projectMenuOpen) return
    updateProjectMenuPosition()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (projectButtonRef.current?.contains(target)) return
      if (projectMenuRef.current?.contains(target)) return
      setProjectMenuOpen(false)
      setNewProjectOptionsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectMenuOpen(false)
        setNewProjectOptionsOpen(false)
      }
    }

    window.addEventListener('resize', updateProjectMenuPosition)
    window.addEventListener('scroll', updateProjectMenuPosition, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', updateProjectMenuPosition)
      window.removeEventListener('scroll', updateProjectMenuPosition, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [projectMenuOpen])

  useEffect(() => {
    if (!createProjectOpen) return
    requestAnimationFrame(() => projectNameInputRef.current?.focus())
  }, [createProjectOpen])

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

  const selectProject = (project: HomeProject | null) => {
    setSelectedProject(project)
    setProjectMenuOpen(false)
    setNewProjectOptionsOpen(false)
    setProjectSearch('')
  }

  const validateProjectName = (name: string): string => {
    const trimmed = name.trim()
    if (!trimmed) return t('home.project.nameRequired')
    if (trimmed.length > 40) return t('home.project.nameTooLong')
    if (projects.some((project) => project.name === trimmed)) return t('home.project.nameConflict')
    return ''
  }

  const handleCreateProject = async () => {
    const nextError = validateProjectName(projectNameDraft)
    if (nextError) {
      setProjectError(nextError)
      return
    }

    const name = projectNameDraft.trim()
    const result = projectFolderDraft
      ? await window.db.createProject({
          projectId: `project-${globalThis.crypto.randomUUID()}`,
          name,
          description: projectFolderDraft,
        })
      : await window.db.createBlankProject({ name })
    if (!result.ok || !result.project) {
      setProjectError(result.error || t('home.project.createFailed'))
      return
    }

    const project = result.project as HomeProject
    setProjects((current) => [project, ...current])
    selectProject(project)
    setCreateProjectOpen(false)
    setProjectNameDraft('')
    setProjectFolderDraft(null)
    setProjectError('')
  }

  const handleUseExistingFolder = async () => {
    setProjectMenuOpen(false)
    setNewProjectOptionsOpen(false)
    const picked = await window.files.pickDirectory()
    if (!picked.ok || picked.cancelled || !picked.path) return
    const name = picked.name || picked.path.split(/[\\/]/).pop() || t('home.project.untitled')
    const nextError = validateProjectName(name)
    if (nextError) {
      setProjectError(nextError)
      setCreateProjectOpen(true)
      setProjectNameDraft(name)
      setProjectFolderDraft(picked.path)
      return
    }
    const result = await window.db.createProject({
      projectId: `project-${globalThis.crypto.randomUUID()}`,
      name,
      description: picked.path,
    })
    if (!result.ok || !result.project) {
      setProjectError(result.error || t('home.project.createFailed'))
      setCreateProjectOpen(true)
      setProjectNameDraft(name)
      setProjectFolderDraft(picked.path)
      return
    }
    const project = result.project as HomeProject
    setProjects((current) => [project, ...current])
    selectProject(project)
  }

  const handleSend = async () => {
    if (isSending) return
    const payload = buildSkillComposerPayload(input, selectedSkills)
    if (!payload && attachments.length === 0 && pasted.blocks.length === 0) return
    const pastedSuffix = pasted.buildPastedSuffix()
    const fullMessage = [payload, pastedSuffix].filter(Boolean).join('\n\n')
    const selectedPermission = PERMISSION_MODES.find((mode) => mode.id === permissionMode) || PERMISSION_MODES[0]

    setIsSending(true)
    try {
      let resolvedCwd = getProjectCwd(selectedProject)
      if (!resolvedCwd) {
        const result = await window.workspace.createDefaultCwd()
        if (!result.ok) {
          console.error('[HomePage] failed to create default cwd:', result.error)
          setIsSending(false)
          return
        }
        resolvedCwd = result.path
      }

      console.log('[HomePage] navigate state:', {
        permissionMode,
        approvalsReviewer: selectedPermission.approvalsReviewer,
        sandbox: selectedPermission.sandbox,
        cwd: resolvedCwd,
      })

      navigate('/chat', {
        state: {
          initialMessage: fullMessage,
          initialAttachments: attachments,
          permissionMode,
          approvalPolicy: selectedPermission.approvalPolicy,
          approvalsReviewer: selectedPermission.approvalsReviewer,
          sandbox: selectedPermission.sandbox,
          projectContext: selectedProject
            ? {
                projectId: selectedProject.project_id,
                name: selectedProject.name,
                description: selectedProject.description,
                createdAt: selectedProject.created_at,
              }
            : undefined,
          cwd: resolvedCwd,
        },
      })
      setInput('')
      setSelectedSkills([])
      setAttachments([])
      pasted.clearBlocks()
      setPermissionMenuOpen(false)
      setIsSending(false)
    } catch (error) {
      console.error('[HomePage] failed to prepare message cwd:', error)
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
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
                    <div className="relative">
                      <button
                        ref={permissionButtonRef}
                        type="button"
                        onClick={() => {
                          if (permissionMenuOpen) {
                            setPermissionMenuOpen(false)
                            return
                          }
                          updatePermissionMenuPosition()
                          setPermissionMenuOpen(true)
                        }}
                        aria-haspopup="menu"
                        aria-expanded={permissionMenuOpen}
                        title={t(`home.permissions.${permissionMode}.description`)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                      >
                        <CurrentPermissionIcon size={14} strokeWidth={2.1} />
                        <span>{t(`home.permissions.${permissionMode}.label`)}</span>
                        <ChevronDown
                          size={13}
                          className={cn('transition-transform', permissionMenuOpen && 'rotate-180')}
                        />
                      </button>

                      {permissionMenuOpen && permissionMenuPosition && typeof document !== 'undefined' && createPortal(
                        <div
                          ref={permissionMenuRef}
                          role="menu"
                          style={{
                            left: permissionMenuPosition.left,
                            bottom: permissionMenuPosition.bottom,
                          }}
                          className="fixed z-[120] w-[330px] overflow-hidden rounded-[1.35rem] border border-border bg-card py-2 shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
                        >
                          <div className="flex items-center justify-between px-4 pb-2 pt-1 text-sm font-medium text-muted-foreground">
                            <span>{t('home.permissions.title')}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void window.appRuntime.openExternal('https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it')
                              }}
                              className="text-xs underline underline-offset-4 transition-colors hover:text-foreground"
                            >
                              {t('home.permissions.learnMore')}
                            </button>
                          </div>
                          {PERMISSION_MODES.map((mode) => {
                            const Icon = mode.icon
                            const selected = mode.id === permissionMode
                            return (
                              <button
                                key={mode.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                onClick={() => {
                                  setPermissionMode(mode.id)
                                  setPermissionMenuOpen(false)
                                }}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                              >
                                <Icon size={19} className="shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-foreground">
                                    {t(`home.permissions.${mode.id}.label`)}
                                  </span>
                                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                                    {t(`home.permissions.${mode.id}.description`)}
                                  </span>
                                </span>
                                {selected && <Check size={17} className="shrink-0 text-primary" />}
                              </button>
                            )
                          })}
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => void handleSend()}
                      disabled={isSending || (!buildSkillComposerPayload(input, selectedSkills) && attachments.length === 0 && pasted.blocks.length === 0)}
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
              <div className="flex w-full items-center border-t border-border/70 bg-[#F5F5F5] px-5 py-3">
                <div className="group inline-flex max-w-[min(100%,360px)] items-center gap-1 rounded-lg transition-colors hover:bg-[#E8E8E8] focus-within:bg-[#E8E8E8]">
                  <button
                    ref={projectButtonRef}
                    type="button"
                    onClick={() => {
                      if (projectMenuOpen) {
                        setProjectMenuOpen(false)
                        setNewProjectOptionsOpen(false)
                        return
                      }
                      updateProjectMenuPosition()
                      setProjectMenuOpen(true)
                    }}
                    className="inline-flex min-w-0 items-center gap-2 px-2 py-1.5 text-left text-sm text-foreground"
                  >
                    <NotebookText size={17} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">
                      {selectedProject ? getProjectDisplayName(selectedProject, t) : t('home.project.choose')}
                    </span>
                  </button>
                  {selectedProject && (
                    <button
                      type="button"
                      aria-label={t('home.project.clear')}
                      title={t('home.project.clear')}
                      onClick={() => selectProject(null)}
                      className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-[#DCDCDC] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <X size={15} />
                    </button>
                  )}
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
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md min-h-[120px]"
              >
                {/* 标题 */}
                <h3 className="text-base font-medium text-foreground group-hover:text-primary transition-colors">
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

      {projectMenuOpen && projectMenuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={projectMenuRef}
          role="menu"
          style={{
            left: projectMenuPosition.left,
            bottom: projectMenuPosition.bottom,
          }}
          className="fixed z-[120] w-[340px] overflow-visible rounded-[1.25rem] border border-border bg-card py-2 shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
        >
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <Search size={15} className="shrink-0 text-muted-foreground" />
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder={t('home.project.search')}
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto px-1">
            {filteredProjects.length > 0 ? (
              filteredProjects.map((project) => {
                const selected = selectedProject?.project_id === project.project_id
                return (
                  <button
                    key={project.project_id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => selectProject(project)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
                  >
                    <NotebookText size={17} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {getProjectDisplayName(project, t)}
                      </span>
                      {project.description && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {getProjectDisplayDescription(project, t)}
                        </span>
                      )}
                    </span>
                    {selected && <Check size={16} className="shrink-0 text-primary" />}
                  </button>
                )
              })
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('home.project.empty')}
              </div>
            )}
          </div>

          <div className="relative mt-1 border-t border-border px-1 pt-1">
            <button
              type="button"
              onClick={() => setNewProjectOptionsOpen((open) => !open)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
            >
              <Plus size={17} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">{t('home.project.newProject')}</span>
              <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
            </button>

            {newProjectOptionsOpen && (
              <div className="absolute bottom-0 left-[calc(100%+8px)] z-[121] w-[230px] rounded-2xl border border-border bg-card p-1.5 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
                <button
                  type="button"
                  onClick={() => {
                    setCreateProjectOpen(true)
                    setProjectNameDraft('')
                    setProjectFolderDraft(null)
                    setProjectError('')
                    setProjectMenuOpen(false)
                    setNewProjectOptionsOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/70"
                >
                  <Plus size={15} className="shrink-0 text-muted-foreground" />
                  {t('home.project.blankProject')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUseExistingFolder()}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/70"
                >
                  <Folder size={15} className="shrink-0 text-muted-foreground" />
                  {t('home.project.existingFolder')}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {createProjectOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCreateProjectOpen(false)
              setProjectError('')
              setProjectFolderDraft(null)
            }
          }}
        >
          <form
            className="w-full max-w-[380px] rounded-2xl border border-border bg-card p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCreateProject()
            }}
          >
            <h2 className="text-base font-semibold text-foreground">{t('home.project.nameDialogTitle')}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('home.project.nameDialogDesc')}</p>
            <input
              ref={projectNameInputRef}
              value={projectNameDraft}
              onChange={(event) => {
                setProjectNameDraft(event.target.value)
                setProjectError('')
              }}
              placeholder={t('home.project.namePlaceholder')}
              className={cn(
                'mt-4 w-full rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring',
                projectError ? 'border-destructive' : 'border-border'
              )}
            />
            {projectError && <p className="mt-2 text-xs text-destructive">{projectError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateProjectOpen(false)
                  setProjectFolderDraft(null)
                  setProjectError('')
                }}
                className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t('home.project.cancel')}
              </button>
              <button
                type="submit"
                className="rounded-xl bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                {t('home.project.create')}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* 附件预览弹窗。首页是轻量入口，不再使用与对话页相同的右侧抽屉，
          改用 FilePreviewModal —— 居中 modal、点击遮罩或 Esc 关闭。
          内部 createPortal 到 body，不受当前容器 overflow / transform
          影响。 */}
      <FilePreviewModal preview={filePreview} onClose={() => setFilePreview(null)} />
    </div>
  )
}
