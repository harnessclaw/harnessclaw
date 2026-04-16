import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  Download,
  FileText,
  FolderOpen,
  Github,
  Loader2,
  PackagePlus,
  Plus,
  Puzzle,
  RefreshCcw,
  Search,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { NoticeToast, type NoticeTone } from '../common/NoticeToast'
import { HarnessclawStatusBadge } from '../common/HarnessclawStatusBadge'

interface NoticeState {
  tone: NoticeTone
  message: string
}

interface RepositoryFormState {
  id?: string
  name: string
  repoUrl: string
  branch: string
  basePath: string
  proxy: SkillRepositoryProxy
  enabled: boolean
}

function createEmptyProxyForm(): SkillRepositoryProxy {
  return {
    enabled: false,
    protocol: 'http',
    host: '',
    port: '',
  }
}

const EMPTY_REPOSITORY_FORM: RepositoryFormState = {
  name: '',
  repoUrl: '',
  branch: 'main',
  basePath: '',
  proxy: createEmptyProxyForm(),
  enabled: true,
}

function formatRepositoryProxy(proxy: SkillRepositoryProxy): string | null {
  if (!proxy.enabled || !proxy.host || !proxy.port) return null
  return `${proxy.protocol}://${proxy.host}:${proxy.port}`
}

const SKILL_COLORS = [
  '#3370FF', '#5865F2', '#EA4335', '#F59E0B', '#00C853',
  '#4A154B', '#26A5E4', '#07C160', '#FF3B30', '#8B5CF6',
]

function getColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return SKILL_COLORS[Math.abs(hash) % SKILL_COLORS.length]
}

function parseTools(raw: string): string[] {
  if (!raw) return []
  return raw.split('),').map((item) => {
    const match = item.match(/^Bash\((.+?)(?:\)|$)/)
    return match ? match[1].replace(':*', '') : item.trim()
  }).filter(Boolean)
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, '')
}

function formatTimestamp(value?: number): string {
  if (!value) return '尚未刷新'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [marketOpen, setMarketOpen] = useState(false)
  const deferredSearch = useDeferredValue(search)

  const loadSkills = useCallback(async () => {
    const data = await window.skills.list()
    setSkills(data)
    return data
  }, [])

  useEffect(() => {
    loadSkills().finally(() => setLoading(false))
  }, [loadSkills])

  const closeSelected = useCallback(() => {
    setSelectedId(null)
    setContent('')
    setConfirmDeleteId(null)
  }, [])

  const handleSelect = (skill: SkillInfo) => {
    if (selectedId === skill.id) {
      closeSelected()
      return
    }
    setSelectedId(skill.id)
    setConfirmDeleteId(null)
    setContentLoading(true)
    window.skills.read(skill.id).then((markdown) => {
      setContent(stripFrontmatter(markdown))
      setContentLoading(false)
    })
  }

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(true)
    const result = await window.skills.delete(id)
    setDeleting(false)
    if (result.ok) {
      const items = await loadSkills()
      if (!items.some((item) => item.id === selectedId)) {
        setSelectedId(null)
        setContent('')
      }
      setConfirmDeleteId(null)
    }
  }, [loadSkills, selectedId])

  useEffect(() => {
    if (!selectedId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSelected()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSelected, selectedId])

  const filtered = skills.filter((skill) => {
    if (!deferredSearch) return true
    const query = deferredSearch.toLowerCase()
    return skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
  })

  const selectedSkill = skills.find((item) => item.id === selectedId)

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (marketOpen) {
    return (
      <SkillMarketOverlay
        installedSkills={skills}
        onClose={() => setMarketOpen(false)}
        onInstalledChange={async () => {
          const items = await loadSkills()
          if (selectedId && !items.some((item) => item.id === selectedId)) {
            setSelectedId(null)
            setContent('')
          } else if (selectedId) {
            const markdown = await window.skills.read(selectedId)
            setContent(stripFrontmatter(markdown))
          }
        }}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="titlebar-drag px-4 py-3 border-b border-border flex items-center gap-2 flex-shrink-0">
        <Puzzle size={16} className="text-foreground" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">技能</span>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{skills.length}</span>
        <div className="flex-1" />
        <div className="titlebar-no-drag flex items-center gap-2">
          <button
            onClick={() => setMarketOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <PackagePlus size={13} />
            Skill 市场
          </button>
          <HarnessclawStatusBadge />
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索..."
              aria-label="搜索技能"
              className="pl-7 pr-2 py-1 text-xs rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/40 w-32"
            />
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto p-3">
          {filtered.length === 0 ? (
            search ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <Puzzle size={24} className="mx-auto mb-2 text-muted-foreground/30" aria-hidden="true" />
                <p className="text-xs text-muted-foreground">没有匹配的技能</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card/80 px-6 py-10 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/65">
                  <PackagePlus size={20} className="text-primary" aria-hidden="true" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">这里还没有安装任何 Skill</h2>
                <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">
                  去 Skill 市场挑选需要的能力，安装后会立即出现在这里。第一次安装一个 Skill，就能开始扩展 HarnessClaw 的工作方式。
                </p>
                <div className="mt-5 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setMarketOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#4B6BFB] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <PackagePlus size={14} />
                    前往 Skill 市场
                  </button>
                  <span className="text-[11px] text-muted-foreground">挑选并安装后，这里会自动出现</span>
                </div>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((skill) => {
                const color = getColor(skill.name)
                const tools = parseTools(skill.allowedTools)
                const isConfirming = confirmDeleteId === skill.id
                const isActive = skill.id === selectedId
                return (
                  <div
                    key={skill.id}
                    className={cn(
                      'group relative cursor-pointer rounded-xl border bg-card p-4 text-left transition-all duration-200 hover:border-foreground/10 hover:shadow-md',
                      isActive && 'border-primary/35 bg-accent/30 shadow-sm'
                    )}
                    onClick={() => handleSelect(skill)}
                  >
                    <div
                      className={cn(
                        'absolute top-2.5 right-2.5 z-10 transition-opacity',
                        isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(skill.id)}
                            disabled={deleting}
                            className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                          >
                            {deleting ? '...' : '确认'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(skill.id)}
                          title="删除技能"
                          aria-label={`删除技能 ${skill.name}`}
                          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <div className="mb-3 flex items-start gap-3">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                        style={{ backgroundColor: color }}
                      >
                        {skill.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate">{skill.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          {skill.hasReferences && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <FolderOpen size={9} aria-hidden="true" /> refs
                            </span>
                          )}
                          {skill.hasTemplates && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <FileText size={9} aria-hidden="true" /> templates
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-muted-foreground line-clamp-3">
                      {skill.description}
                    </p>
                    {tools.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tools.map((tool, index) => (
                          <span key={index} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">
                            <Terminal size={8} aria-hidden="true" />
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {selectedId && selectedSkill && (
          <>
            <button
              type="button"
              aria-label="关闭技能详情"
              onClick={closeSelected}
              className="absolute inset-0 z-10 bg-background/42 transition-opacity"
            />

            <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[min(42rem,92vw)] flex-col border-l border-border bg-background shadow-2xl">
              <div className="flex items-center gap-3 border-b border-border px-5 py-3 flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: getColor(selectedSkill.name) }}
                >
                  {selectedSkill.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">{selectedSkill.name}</h2>
                  <p className="text-[11px] text-muted-foreground truncate">{selectedSkill.description.slice(0, 80)}</p>
                </div>

                {confirmDeleteId === selectedId ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleDelete(selectedId)}
                      disabled={deleting}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                    >
                      {deleting ? '删除中...' : '确认删除'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(selectedId)}
                    title="删除技能"
                    aria-label="删除技能"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}

                <button
                  onClick={closeSelected}
                  title="关闭"
                  aria-label="关闭详情"
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <X size={14} className="text-muted-foreground" aria-hidden="true" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {contentLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={18} className="animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-a:text-primary prose-strong:text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  )
}

function SkillMarketOverlay({
  installedSkills,
  onClose,
  onInstalledChange,
}: {
  installedSkills: SkillInfo[]
  onClose: () => void
  onInstalledChange: () => Promise<void>
}) {
  const [repositories, setRepositories] = useState<SkillRepository[]>([])
  const [discoveredSkills, setDiscoveredSkills] = useState<DiscoveredSkill[]>([])
  const [marketLoading, setMarketLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedRepoId, setSelectedRepoId] = useState('all')
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [repoForm, setRepoForm] = useState<RepositoryFormState>(EMPTY_REPOSITORY_FORM)
  const [savingRepo, setSavingRepo] = useState(false)
  const [installingKey, setInstallingKey] = useState<string | null>(null)
  const [onlyInstallable, setOnlyInstallable] = useState(false)
  const [expandedRepoIds, setExpandedRepoIds] = useState<string[]>([])
  const [busyRepositoryId, setBusyRepositoryId] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

  const pushNotice = useCallback((tone: NoticeTone, message: string) => {
    setNotice({ tone, message })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const loadRepositories = useCallback(async () => {
    const items = await window.skills.listRepositories()
    setRepositories(items)
    if (items.length === 1) {
      setExpandedRepoIds([items[0].id])
    } else if (items.length > 1) {
      setExpandedRepoIds((current) => current.filter((id) => items.some((item) => item.id === id)))
    }
    return items
  }, [])

  const loadDiscoveredSkills = useCallback(async (repositoryId?: string) => {
    const items = await window.skills.listDiscovered(repositoryId)
    setDiscoveredSkills(items)
    return items
  }, [])

  const reloadCachedMarketData = useCallback(async () => {
    await Promise.all([loadRepositories(), loadDiscoveredSkills()])
  }, [loadDiscoveredSkills, loadRepositories])

  const refreshDiscovery = useCallback(async (repositoryId?: string) => {
    const result = await window.skills.discover(repositoryId)
    if (!result.ok || !result.started) {
      pushNotice('error', result.error || '刷新任务启动失败')
      return result
    }
    setRefreshing(true)
    return result
  }, [pushNotice])

  useEffect(() => {
    return window.skills.onDiscoveryEvent((event) => {
      const typedEvent = event as SkillDiscoveryEvent

      if (typedEvent.type === 'started') {
        setRefreshing(true)
        return
      }

      if (typedEvent.type === 'finished') {
        setRefreshing(false)
        void reloadCachedMarketData()

        if ((typedEvent.errorCount || 0) > 0) {
          pushNotice(
            'error',
            `刷新完成：${typedEvent.successCount || 0}/${typedEvent.repositoryCount || 0} 个仓库成功，${typedEvent.errorCount || 0} 个失败`
          )
          return
        }

        pushNotice(
          'success',
          `发现结果已刷新：${typedEvent.repositoryCount || 0} 个仓库，${typedEvent.skillCount || 0} 个 skill`
        )
        return
      }

      setRefreshing(false)
      pushNotice('error', typedEvent.error || '后台刷新失败')
    })
  }, [pushNotice, reloadCachedMarketData])

  useEffect(() => {
    let active = true
    const bootstrap = async () => {
      setMarketLoading(true)
      try {
        await Promise.all([loadRepositories(), loadDiscoveredSkills()])
        if (!active) return
      } finally {
        if (active) setMarketLoading(false)
      }
    }
    void bootstrap()
    return () => {
      active = false
    }
  }, [loadDiscoveredSkills, loadRepositories])

  const installedBySourceKey = useMemo(() => {
    const map = new Map<string, SkillInfo>()
    installedSkills.forEach((skill) => {
      if (skill.source?.key) {
        map.set(skill.source.key, skill)
      }
    })
    return map
  }, [installedSkills])

  const enabledRepositories = useMemo(
    () => repositories.filter((repository) => repository.enabled),
    [repositories]
  )

  const filteredDiscoveredSkills = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase()
    const enabledRepoIds = new Set(enabledRepositories.map((repository) => repository.id))
    return discoveredSkills.filter((skill) => {
      if (!enabledRepoIds.has(skill.repoId)) return false
      if (selectedRepoId !== 'all' && skill.repoId !== selectedRepoId) return false
      if (onlyInstallable && installedBySourceKey.has(skill.key)) return false
      if (!query) return true
      return [
        skill.name,
        skill.repoName,
        skill.skillPath,
      ].some((field) => field.toLowerCase().includes(query))
    })
  }, [deferredSearch, discoveredSkills, enabledRepositories, installedBySourceKey, onlyInstallable, selectedRepoId])

  const groupedSkills = useMemo(() => {
    const groupedMap = new Map<string, DiscoveredSkill[]>()
    filteredDiscoveredSkills.forEach((skill) => {
      const existing = groupedMap.get(skill.repoId)
      if (existing) {
        existing.push(skill)
        return
      }
      groupedMap.set(skill.repoId, [skill])
    })

    return enabledRepositories
      .filter((repository) => selectedRepoId === 'all' || repository.id === selectedRepoId)
      .map((repository) => ({
        repository,
        skills: groupedMap.get(repository.id) || [],
      }))
  }, [enabledRepositories, filteredDiscoveredSkills, selectedRepoId])

  useEffect(() => {
    if (selectedRepoId === 'all') return
    if (enabledRepositories.some((repository) => repository.id === selectedRepoId)) return
    setSelectedRepoId('all')
  }, [enabledRepositories, selectedRepoId])

  useEffect(() => {
    if (groupedSkills.length === 0) return

    if (selectedRepoId === 'all') {
      setExpandedRepoIds((current) => {
        return current.filter((id) => groupedSkills.some((group) => group.repository.id === id))
      })
      return
    }

    setExpandedRepoIds((current) => {
      const next = [selectedRepoId]
      return current.length === 1 && current[0] === selectedRepoId ? current : next
    })
  }, [groupedSkills, selectedRepoId])

  const handleSaveRepository = useCallback(async () => {
    if (!repoForm.repoUrl.trim()) {
      pushNotice('error', '先填写 GitHub 仓库地址')
      return
    }

    setSavingRepo(true)
    try {
      const result = await window.skills.saveRepository({
        id: repoForm.id,
        name: repoForm.name.trim() || undefined,
        repoUrl: repoForm.repoUrl.trim(),
        branch: repoForm.branch.trim() || 'main',
        basePath: repoForm.basePath.trim(),
        proxy: {
          enabled: repoForm.proxy.enabled,
          protocol: repoForm.proxy.protocol,
          host: repoForm.proxy.host.trim(),
          port: repoForm.proxy.port.trim(),
        },
        enabled: repoForm.enabled,
      })

      if (!result.ok || !result.repo) {
        pushNotice('error', result.error || '保存仓库失败')
        return
      }

      setRepoForm(EMPTY_REPOSITORY_FORM)
      setManageOpen(false)
      setSelectedRepoId(result.repo.id)
      setExpandedRepoIds((current) => Array.from(new Set([...current, result.repo!.id])))
      await reloadCachedMarketData()
      pushNotice('success', '仓库已保存，发现结果保持当前缓存')
    } finally {
      setSavingRepo(false)
    }
  }, [pushNotice, reloadCachedMarketData, repoForm])

  const handleRefresh = useCallback(async () => {
    await refreshDiscovery()
  }, [refreshDiscovery])

  const handleDeleteInstalledSkill = useCallback(async (skillId: string, skillName: string) => {
    const result = await window.skills.delete(skillId)
    if (!result.ok) {
      pushNotice('error', result.error || '删除失败')
      return
    }
    await onInstalledChange()
    pushNotice('success', `${skillName} 已删除`)
  }, [onInstalledChange, pushNotice])

  const handleInstallSkill = useCallback(async (skill: DiscoveredSkill) => {
    setInstallingKey(skill.key)
    try {
      const result = await window.skills.installDiscovered(skill.repoId, skill.skillPath)
      if (!result.ok) {
        pushNotice('error', result.error || '安装失败')
        return
      }
      await onInstalledChange()
      pushNotice('success', installedBySourceKey.has(skill.key) ? `${skill.name} 已重新安装` : `${skill.name} 已安装`)
    } finally {
      setInstallingKey(null)
    }
  }, [installedBySourceKey, onInstalledChange, pushNotice])

  const handleEditRepository = useCallback((repository: SkillRepository) => {
    setManageOpen(true)
    setRepoForm({
      id: repository.id,
      name: repository.name,
      repoUrl: repository.repoUrl,
      branch: repository.branch,
      basePath: repository.basePath,
      proxy: { ...repository.proxy },
      enabled: repository.enabled,
    })
  }, [])

  const handleToggleRepository = useCallback(async (repository: SkillRepository) => {
    setBusyRepositoryId(repository.id)
    try {
      const result = await window.skills.saveRepository({
        id: repository.id,
        name: repository.name,
        repoUrl: repository.repoUrl,
        branch: repository.branch,
        basePath: repository.basePath,
        proxy: repository.proxy,
        enabled: !repository.enabled,
      })
      if (!result.ok) {
        pushNotice('error', result.error || '更新仓库失败')
        return
      }
      await reloadCachedMarketData()
    } finally {
      setBusyRepositoryId(null)
    }
  }, [pushNotice, reloadCachedMarketData])

  const handleRemoveRepository = useCallback(async (repositoryId: string) => {
    setBusyRepositoryId(repositoryId)
    try {
      const result = await window.skills.removeRepository(repositoryId)
      if (!result.ok) {
        pushNotice('error', result.error || '删除仓库失败')
        return
      }
      await reloadCachedMarketData()
      pushNotice('success', '仓库已移除，发现结果保持当前缓存')
    } finally {
      setBusyRepositoryId(null)
    }
  }, [pushNotice, reloadCachedMarketData])

  const toggleRepositoryExpand = useCallback((repositoryId: string) => {
    setExpandedRepoIds((current) => (
      current.includes(repositoryId)
        ? current.filter((id) => id !== repositoryId)
        : [...current, repositoryId]
    ))
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="relative flex h-full flex-col overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(17,24,39,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(17,24,39,0.035)_1px,transparent_1px)] bg-[size:24px_24px] opacity-60" aria-hidden="true" />

        <div className="relative flex h-full flex-col overflow-hidden">
          <div className="titlebar-drag border-b border-border/70 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[18px] font-semibold text-foreground">Skill 市场</h1>
                  <button
                    onClick={onClose}
                    className="titlebar-no-drag inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    返回 Skill
                  </button>
                  <button
                    onClick={() => setManageOpen((value) => !value)}
                    className="titlebar-no-drag inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    管理仓库
                  </button>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="titlebar-no-drag inline-flex items-center gap-1 rounded-lg bg-[#4B6BFB] px-2.5 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    <RefreshCcw size={12} className={cn(refreshing && 'animate-spin')} />
                    刷新发现
                  </button>
                </div>
              </div>
              <button
                onClick={onClose}
                className="titlebar-no-drag rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="关闭 skill 市场"
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-border/80 bg-card px-4 py-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">按仓库浏览，默认直接安装到当前 CLI</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    现在市场页默认将技能安装到本机 `~/.harnessclaw/workspace/skills`。若需要限定扫描范围，在“管理仓库”中填写路径。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                    已启用仓库 {repositories.filter((item) => item.enabled).length} / {repositories.length}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                    已安装 {installedSkills.length}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                    发现技能 {discoveredSkills.length}
                  </span>
                </div>
              </div>
            </div>

          </div>

          <div className="min-h-0 flex-1 overflow-hidden p-4">
            {marketLoading ? (
              <div className="flex h-full items-center justify-center rounded-[20px] border border-border bg-card">
                <Loader2 size={18} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid h-full min-h-0 gap-4">
                <div className="grid min-h-0 gap-4">
                  <div className="flex min-h-0 flex-col rounded-[20px] border border-border bg-card shadow-sm">
                    <div className="border-b border-border/80 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="relative min-w-[220px] flex-1">
                          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="搜索技能、仓库、目录"
                            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                          />
                        </div>

                        <div className="relative min-w-[180px]">
                          <select
                            value={selectedRepoId}
                            onChange={(event) => setSelectedRepoId(event.target.value)}
                            className="w-full appearance-none rounded-xl border border-border bg-background px-3 py-2 pr-9 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                          >
                            <option value="all">全部仓库</option>
                            {enabledRepositories.map((repository) => (
                              <option key={repository.id} value={repository.id}>{repository.name}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        </div>

                        <button
                          onClick={() => setOnlyInstallable((value) => !value)}
                          className={cn(
                            'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
                            onlyInstallable
                              ? 'border-[#4B6BFB]/30 bg-[#4B6BFB]/8 text-[#3552D6]'
                              : 'border-border bg-background text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <span>仅显示可安装</span>
                          <span className={cn(
                            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                            onlyInstallable ? 'bg-[#4B6BFB]' : 'bg-muted'
                          )}>
                            <span className={cn(
                              'absolute h-4 w-4 rounded-full bg-white transition-transform',
                              onlyInstallable ? 'translate-x-[18px]' : 'translate-x-[2px]'
                            )} />
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                      {groupedSkills.length === 0 ? (
                        <div className="flex h-full min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 text-center">
                          <div className="max-w-sm">
                            <div className="mb-3 inline-flex rounded-md border border-border bg-card p-3">
                              <Puzzle size={18} className="text-muted-foreground" />
                            </div>
                            <p className="text-sm font-medium text-foreground">还没有可发现的 skill</p>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {repositories.length === 0
                                ? '先添加 GitHub 仓库，再进行刷新发现。'
                                : '可以检查仓库地址、分支和扫描路径后重新刷新。'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {groupedSkills.map(({ repository, skills }) => {
                            const expanded = expandedRepoIds.includes(repository.id)
                            const installedCount = skills.filter((skill) => installedBySourceKey.has(skill.key)).length
                            return (
                              <div key={repository.id} className="rounded-2xl border border-border bg-background p-3">
                                <div className="flex items-start gap-3">
                                  <button
                                    onClick={() => toggleRepositoryExpand(repository.id)}
                                    className="mt-1 rounded-full border border-border bg-card p-1 text-muted-foreground transition-colors hover:text-foreground"
                                  >
                                    <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
                                  </button>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        onClick={() => toggleRepositoryExpand(repository.id)}
                                        className="truncate text-left text-[15px] font-semibold text-foreground"
                                      >
                                        {repository.owner}/{repository.repo}
                                      </button>
                                      <span className="rounded-full bg-foreground px-2.5 py-1 text-[10px] text-background">
                                        {skills.length} 个技能
                                      </span>
                                      <span className="text-[11px] text-[#3552D6]">
                                        可安装 {skills.length - installedCount}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {repository.repoUrl}
                                      <span className="ml-2">branch: {repository.branch}</span>
                                    </p>
                                  </div>
                                </div>

                                {expanded && (
                                  <div className="mt-3 space-y-2">
                                    {skills.length === 0 ? (
                                      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center">
                                        <p className="text-sm font-medium text-foreground">仓库已配置</p>
                                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                          当前还没有发现到 skill。可以检查分支、扫描路径，或点击“刷新发现”拉取该仓库最新内容。
                                        </p>
                                      </div>
                                    ) : (
                                      skills.map((skill) => {
                                        const installed = installedBySourceKey.get(skill.key)
                                        return (
                                          <div
                                            key={skill.key}
                                            className="rounded-2xl border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/12"
                                          >
                                            <div className="flex items-start gap-3">
                                              <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <span className="text-[15px] font-semibold text-foreground">{skill.name}</span>
                                                  <span className="text-[10px] text-muted-foreground">{installed ? '已安装' : '未安装'}</span>
                                                </div>
                                                <p className="mt-2 text-[11px] text-muted-foreground">{skill.skillPath}</p>
                                              </div>

                                              <div className="flex shrink-0 items-center gap-2">
                                                {installed && (
                                                  <button
                                                    onClick={() => handleDeleteInstalledSkill(installed.id, skill.name)}
                                                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                                  >
                                                    <Trash2 size={12} />
                                                    删除
                                                  </button>
                                                )}
                                                <button
                                                  onClick={() => handleInstallSkill(skill)}
                                                  disabled={installingKey === skill.key}
                                                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#4B6BFB] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                                >
                                                  {installingKey === skill.key ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                                  {installed ? '重新安装' : '安装到本机'}
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        )
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {notice && (
          <NoticeToast tone={notice.tone} message={notice.message} position="top" />
        )}

        {manageOpen && (
          <RepositorySettingsModal
            repositories={repositories}
            repoForm={repoForm}
            savingRepo={savingRepo}
            busyRepositoryId={busyRepositoryId}
            onClose={() => setManageOpen(false)}
            onSave={handleSaveRepository}
            onResetForm={() => setRepoForm(EMPTY_REPOSITORY_FORM)}
            onChangeRepoForm={setRepoForm}
            onEditRepository={handleEditRepository}
            onToggleRepository={handleToggleRepository}
            onRemoveRepository={handleRemoveRepository}
          />
        )}
      </div>
    </div>
  )
}

function RepositorySettingsModal({
  repositories,
  repoForm,
  savingRepo,
  busyRepositoryId,
  onClose,
  onSave,
  onResetForm,
  onChangeRepoForm,
  onEditRepository,
  onToggleRepository,
  onRemoveRepository,
}: {
  repositories: SkillRepository[]
  repoForm: RepositoryFormState
  savingRepo: boolean
  busyRepositoryId: string | null
  onClose: () => void
  onSave: () => void
  onResetForm: () => void
  onChangeRepoForm: React.Dispatch<React.SetStateAction<RepositoryFormState>>
  onEditRepository: (repository: SkillRepository) => void
  onToggleRepository: (repository: SkillRepository) => void
  onRemoveRepository: (repositoryId: string) => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const hasAdvancedValues = !!repoForm.id
    || repoForm.branch.trim() !== 'main'
    || !!repoForm.name.trim()
    || !!repoForm.basePath.trim()
    || repoForm.proxy.enabled
    || repoForm.proxy.protocol !== 'http'
    || !!repoForm.proxy.host.trim()
    || !!repoForm.proxy.port.trim()

  useEffect(() => {
    if (hasAdvancedValues) {
      setAdvancedOpen(true)
    }
  }, [hasAdvancedValues])

  return (
    <div className="titlebar-no-drag fixed inset-0 z-[70] bg-black/28 backdrop-blur-[2px]">
      <div
        className="flex min-h-full items-center justify-center overflow-y-auto px-4 py-6 sm:px-6 sm:py-8"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose()
          }
        }}
      >
        <div
          className="my-auto w-full max-w-[1248px] overflow-hidden rounded-[22px] border border-border/80 bg-background shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border/80 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold text-foreground">Skill 仓库</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                启用后的仓库会参与发现。刷新发现只会更新远端仓库索引，不会动你的原始仓库；需要限制扫描范围时，可填写扫描路径。代理仅作用于 skill 仓库的拉取与刷新。
              </p>
            </div>
            <button
              onClick={onClose}
              className="titlebar-no-drag rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              关闭
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">添加仓库</div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    保留一个主输入即可开始添加；分支、显示名称、扫描路径和代理放在高级设置里，避免表单过挤。
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Git URL</span>
                  <button
                    onClick={() => setAdvancedOpen((value) => !value)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    高级设置
                    <ChevronDown size={12} className={cn('transition-transform', advancedOpen && 'rotate-180')} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={repoForm.repoUrl}
                    onChange={(event) => onChangeRepoForm((value) => ({ ...value, repoUrl: event.target.value }))}
                    placeholder="https://github.com/owner/repo"
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                  />
                  <button
                    onClick={onSave}
                    disabled={savingRepo}
                    className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-[#4B6BFB] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {savingRepo ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {repoForm.id ? '更新仓库' : '添加仓库'}
                  </button>
                </div>
              </div>

              {advancedOpen && (
                <div className="mt-3 rounded-2xl border border-border/80 bg-background/72 p-3">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>Branch</span>
                      <input
                        value={repoForm.branch}
                        onChange={(event) => onChangeRepoForm((value) => ({ ...value, branch: event.target.value }))}
                        placeholder="main"
                        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                      />
                      <p className="text-[11px] text-muted-foreground">默认 `main`，也支持自定义分支。</p>
                    </label>
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>显示名称</span>
                      <input
                        value={repoForm.name}
                        onChange={(event) => onChangeRepoForm((value) => ({ ...value, name: event.target.value }))}
                        placeholder="可选"
                        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>扫描路径</span>
                      <input
                        value={repoForm.basePath}
                        onChange={(event) => onChangeRepoForm((value) => ({ ...value, basePath: event.target.value }))}
                        placeholder="可选，例如 skills"
                        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                      />
                    </label>
                  </div>

                  <div className="mt-3 rounded-2xl border border-border/80 bg-card/85 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-foreground">代理下载</div>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          开启后，Skill 仓库的 clone、fetch、ls-remote 都会通过这里的代理地址访问。
                        </p>
                      </div>
                      <button
                        onClick={() => onChangeRepoForm((value) => ({
                          ...value,
                          proxy: { ...value.proxy, enabled: !value.proxy.enabled },
                        }))}
                        className={cn(
                          'relative inline-flex h-7 w-11 items-center rounded-full transition-colors',
                          repoForm.proxy.enabled ? 'bg-[#3552D6]' : 'bg-muted'
                        )}
                        aria-label={repoForm.proxy.enabled ? '关闭代理' : '开启代理'}
                      >
                        <span
                          className={cn(
                            'absolute h-5 w-5 rounded-full bg-white transition-transform',
                            repoForm.proxy.enabled ? 'translate-x-[22px]' : 'translate-x-[2px]'
                          )}
                        />
                      </button>
                    </div>

                    {repoForm.proxy.enabled && (
                      <div className="mt-3 grid gap-3 lg:grid-cols-4">
                        <label className="space-y-1.5 text-xs text-muted-foreground">
                          <span>协议</span>
                          <select
                            value={repoForm.proxy.protocol}
                            onChange={(event) => onChangeRepoForm((value) => ({
                              ...value,
                              proxy: { ...value.proxy, protocol: event.target.value as SkillRepositoryProxy['protocol'] },
                            }))}
                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                          >
                            <option value="http">http</option>
                            <option value="https">https</option>
                            <option value="socks5">socks5</option>
                          </select>
                        </label>
                        <label className="space-y-1.5 text-xs text-muted-foreground lg:col-span-2">
                          <span>主机</span>
                          <input
                            value={repoForm.proxy.host}
                            onChange={(event) => onChangeRepoForm((value) => ({
                              ...value,
                              proxy: { ...value.proxy, host: event.target.value },
                            }))}
                            placeholder="127.0.0.1"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                          />
                        </label>
                        <label className="space-y-1.5 text-xs text-muted-foreground">
                          <span>端口</span>
                          <input
                            value={repoForm.proxy.port}
                            onChange={(event) => onChangeRepoForm((value) => ({
                              ...value,
                              proxy: { ...value.proxy, port: event.target.value },
                            }))}
                            placeholder="7890"
                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">仓库列表</h3>
                <span className="text-[11px] text-muted-foreground">{repositories.length} 个</span>
              </div>

              <div className="space-y-2">
                {repositories.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card/70 px-4 py-8 text-center text-sm text-muted-foreground">
                    还没有配置任何 skill 仓库。
                  </div>
                ) : (
                  repositories.map((repository) => (
                    <div key={repository.id} className="rounded-2xl border border-border bg-card/92 px-4 py-4 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <button onClick={() => onEditRepository(repository)} className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[15px] font-medium text-foreground">{repository.repoUrl}</span>
                            <Github size={13} className="text-muted-foreground" />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span>branch: {repository.branch}</span>
                            <span>更新 {formatTimestamp(repository.lastDiscoveredAt)}</span>
                            {repository.basePath ? <span>扫描路径 {repository.basePath}</span> : null}
                            {formatRepositoryProxy(repository.proxy) ? <span>代理 {formatRepositoryProxy(repository.proxy)}</span> : null}
                          </div>
                          {repository.lastError && (
                            <p className="mt-1 text-[11px] text-destructive">{repository.lastError}</p>
                          )}
                        </button>

                        <div className="flex items-center justify-end gap-3">
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>启用</span>
                            <button
                              onClick={() => onToggleRepository(repository)}
                              disabled={busyRepositoryId === repository.id}
                              className={cn(
                                'relative inline-flex h-7 w-10 items-center rounded-full transition-colors disabled:opacity-60',
                                repository.enabled ? 'bg-[#3552D6]' : 'bg-muted'
                              )}
                              aria-label={`${repository.enabled ? '停用' : '启用'}仓库 ${repository.name}`}
                            >
                              <span
                                className={cn(
                                  'absolute h-5 w-5 rounded-full bg-white transition-transform',
                                  repository.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                                )}
                              />
                            </button>
                          </div>
                          <button
                            onClick={() => onRemoveRepository(repository.id)}
                            disabled={busyRepositoryId === repository.id}
                            className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
