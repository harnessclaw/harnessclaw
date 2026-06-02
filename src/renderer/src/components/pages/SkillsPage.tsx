import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

function isDescriptionPlaceholder(value: string): boolean {
  const trimmed = value.trim()
  return !trimmed || trimmed === '|' || trimmed === '>'
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

function extractDescriptionFromFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return ''

  const frontmatter = match[1].replace(/\r\n/g, '\n')
  const blockMatch = frontmatter.match(/^description:\s*[>|]\s*\n((?:[ \t]+.*(?:\n|$))+)/m)
  if (blockMatch?.[1]) {
    return blockMatch[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  const singleLineMatch = frontmatter.match(/^description:\s*(.+)$/m)
  if (!singleLineMatch?.[1]) return ''

  const value = singleLineMatch[1].trim()
  if (!value || value === '|' || value === '>') return ''
  return value.replace(/^['"]|['"]$/g, '').trim()
}

function extractDescriptionFromBody(markdown: string): string {
  const lines = stripFrontmatter(markdown).replace(/\r\n/g, '\n').split('\n')
  const paragraph: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (paragraph.length > 0) break
      continue
    }

    if (/^#\s+/.test(trimmed)) continue
    if (/^#{2,}\s+/.test(trimmed)) continue
    if (/^---+$/.test(trimmed)) continue
    if (/^>\s*/.test(trimmed)) continue
    if (/^[-*+]\s+/.test(trimmed)) continue
    if (/^\d+\.\s+/.test(trimmed)) continue
    if (/^```/.test(trimmed)) continue

    paragraph.push(trimmed)
  }

  return paragraph.join(' ').trim()
}

function deriveSkillDescription(markdown: string): string {
  return extractDescriptionFromFrontmatter(markdown) || extractDescriptionFromBody(markdown)
}

function toPlainTextPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function formatTimestamp(value?: number, t?: (key: string) => string, i18n?: any): string {
  if (!value) return t ? t('skills.repo.neverUpdated') : ''
  const locale = i18n?.language === 'en' ? 'en-US' : 'zh-CN'
  return new Date(value).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SkillsPage() {
  const { t, i18n } = useTranslation()
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [skillMarkdownMap, setSkillMarkdownMap] = useState<Record<string, string>>({})
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
    const markdownById = new Map<string, string>()
    await Promise.all(data.map(async (skill) => {
      try {
        const markdown = await window.skills.read(skill.id)
        markdownById.set(skill.id, markdown)
      } catch {
        markdownById.set(skill.id, '')
      }
    }))

    setSkillMarkdownMap(
      Object.fromEntries(Array.from(markdownById.entries()).map(([id, markdown]) => [id, stripFrontmatter(markdown)]))
    )

    const enriched = data.map((skill) => {
      const markdown = markdownById.get(skill.id) || ''
      if (!isDescriptionPlaceholder(skill.description)) return skill
      const derivedDescription = deriveSkillDescription(markdown)
      return derivedDescription ? { ...skill, description: derivedDescription } : skill
    })

    setSkills(enriched)
    return enriched
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
        <span className="text-sm font-semibold text-foreground">{t('skills.title')}</span>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{skills.length}</span>
        <div className="flex-1" />
        <div className="titlebar-no-drag flex items-center gap-2">
          <button
            onClick={() => setMarketOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <PackagePlus size={13} />
            {t('skills.market.title')}
          </button>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('skills.searchPlaceholder')}
              aria-label={t('skills.searchAriaLabel')}
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
                <p className="text-xs text-muted-foreground">{t('skills.noMatch')}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card/80 px-6 py-10 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/65">
                  <PackagePlus size={20} className="text-primary" aria-hidden="true" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">{t('skills.empty')}</h2>
                <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">
                  {t('skills.emptyDesc')}
                </p>
                <div className="mt-5 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setMarketOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#4B6BFB] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <PackagePlus size={14} />
                    {t('skills.goToMarket')}
                  </button>
                  <span className="text-[11px] text-muted-foreground">{t('skills.autoAppear')}</span>
                </div>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((skill) => {
                const color = getColor(skill.name)
                const isConfirming = confirmDeleteId === skill.id
                const isActive = skill.id === selectedId
                const markdownPreview = skillMarkdownMap[skill.id] || ''
                const plainTextPreview = toPlainTextPreview(markdownPreview)
                return (
                  <div
                    key={skill.id}
                    className={cn(
                      'group relative cursor-pointer overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:border-foreground/10 hover:shadow-md',
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
                            {deleting ? '...' : t('skills.confirm')}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                          >
                            {t('skills.cancel')}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(skill.id)}
                          title={t('skills.delete')}
                          aria-label={`${t('skills.deleteAriaLabel')} ${skill.name}`}
                          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <div className="border-b border-border/80 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div
                          className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                          style={{ backgroundColor: color }}
                        >
                          {skill.name[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-foreground">{skill.name}</h3>
                            {skill.hasReferences && (
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <FolderOpen size={9} aria-hidden="true" /> {t('skills.refs')}
                              </span>
                            )}
                            {skill.hasTemplates && (
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <FileText size={9} aria-hidden="true" /> {t('skills.templates')}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
                            {skill.description}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="max-h-64 overflow-hidden bg-muted/18 px-4 py-3">
                      {plainTextPreview ? (
                        <p className="whitespace-pre-line text-xs leading-5 text-muted-foreground line-clamp-3">
                          {plainTextPreview}
                        </p>
                      ) : (
                        <p className="text-xs leading-5 text-muted-foreground">{t('skills.noContent')}</p>
                      )}
                    </div>
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
              aria-label={t('skills.closeDetail')}
              onClick={closeSelected}
              className="absolute inset-0 z-10 bg-background/42 transition-opacity"
            />

            <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[min(42rem,92vw)] flex-col border-l border-border bg-background shadow-2xl">
              <div className="border-b border-border px-5 py-4 flex-shrink-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold text-foreground">{selectedSkill.name}</h2>
                    {selectedSkill.description && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">{selectedSkill.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {confirmDeleteId === selectedId ? (
                      <>
                        <button
                          onClick={() => handleDelete(selectedId)}
                          disabled={deleting}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                        >
                          {deleting ? t('skills.deleting') : t('skills.confirmDelete')}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                        >
                          {t('skills.cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(selectedId)}
                        title={t('skills.delete')}
                        aria-label={t('skills.delete')}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}

                    <button
                      onClick={closeSelected}
                      title={t('skills.closeDetail')}
                      aria-label={t('skills.closeDetail')}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                    >
                      <X size={14} className="text-muted-foreground" aria-hidden="true" />
                    </button>
                  </div>
                </div>
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
  const { t } = useTranslation()
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
  const [refreshingRepositoryId, setRefreshingRepositoryId] = useState<string | 'all' | null>(null)
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
      pushNotice('error', result.error || t('skills.market.refreshStartFailed'))
      return result
    }
    setRefreshing(true)
    setRefreshingRepositoryId(repositoryId || 'all')
    return result
  }, [pushNotice, t])

  useEffect(() => {
    return window.skills.onDiscoveryEvent((event) => {
      const typedEvent = event as SkillDiscoveryEvent

      if (typedEvent.type === 'started') {
        setRefreshing(true)
        setRefreshingRepositoryId(typedEvent.repositoryId || 'all')
        return
      }

      if (typedEvent.type === 'finished') {
        setRefreshing(false)
        setRefreshingRepositoryId(null)
        void reloadCachedMarketData()

        if ((typedEvent.errorCount || 0) > 0) {
          pushNotice(
            'error',
            t('skills.market.refreshProgress', {
              success: typedEvent.successCount || 0,
              total: typedEvent.repositoryCount || 0,
              error: typedEvent.errorCount || 0
            })
          )
          return
        }

        pushNotice(
          'success',
          t('skills.market.refreshSuccess', {
            repos: typedEvent.repositoryCount || 0,
            skills: typedEvent.skillCount || 0
          })
        )
        return
      }

      setRefreshing(false)
      setRefreshingRepositoryId(null)
      pushNotice('error', typedEvent.error || t('skills.market.refreshFailed'))
    })
  }, [pushNotice, reloadCachedMarketData, t])

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
      pushNotice('error', t('skills.market.enterUrlFirst'))
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
        pushNotice('error', result.error || t('skills.market.saveRepoFailed'))
        return
      }

      setRepoForm(EMPTY_REPOSITORY_FORM)
      setManageOpen(false)
      setSelectedRepoId(result.repo.id)
      setExpandedRepoIds((current) => Array.from(new Set([...current, result.repo!.id])))
      await reloadCachedMarketData()
      pushNotice('success', t('skills.market.repoSaved'))
    } finally {
      setSavingRepo(false)
    }
  }, [pushNotice, reloadCachedMarketData, repoForm, t])

  const handleRefresh = useCallback(async () => {
    await refreshDiscovery()
  }, [refreshDiscovery])

  const handleRefreshRepository = useCallback(async (repositoryId: string) => {
    await refreshDiscovery(repositoryId)
  }, [refreshDiscovery])

  const handleDeleteInstalledSkill = useCallback(async (skillId: string, skillName: string) => {
    const result = await window.skills.delete(skillId)
    if (!result.ok) {
      pushNotice('error', result.error || t('skills.market.deleteFailed'))
      return
    }
    await onInstalledChange()
    pushNotice('success', t('skills.market.skillDeleted', { name: skillName }))
  }, [onInstalledChange, pushNotice, t])

  const handleInstallSkill = useCallback(async (skill: DiscoveredSkill) => {
    setInstallingKey(skill.key)
    try {
      const result = await window.skills.installDiscovered(skill.repoId, skill.skillPath)
      if (!result.ok) {
        pushNotice('error', result.error || t('skills.market.installFailed'))
        return
      }
      await onInstalledChange()
      pushNotice('success', installedBySourceKey.has(skill.key)
        ? t('skills.market.skillReinstalled', { name: skill.name })
        : t('skills.market.skillInstalled', { name: skill.name })
      )
    } finally {
      setInstallingKey(null)
    }
  }, [installedBySourceKey, onInstalledChange, pushNotice, t])

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
        pushNotice('error', result.error || t('skills.failed'))
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
        pushNotice('error', result.error || t('skills.market.deleteFailed'))
        return
      }
      await reloadCachedMarketData()
      pushNotice('success', t('skills.market.repoRemoved'))
    } finally {
      setBusyRepositoryId(null)
    }
  }, [pushNotice, reloadCachedMarketData, t])

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
                  <h1 className="text-[18px] font-semibold text-foreground">{t('skills.market.title')}</h1>
                  <button
                    onClick={onClose}
                    className="titlebar-no-drag inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    {t('skills.market.back')}
                  </button>
                  <button
                    onClick={() => setManageOpen((value) => !value)}
                    className="titlebar-no-drag inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    {t('skills.repo.manage')}
                  </button>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="titlebar-no-drag inline-flex items-center gap-1 rounded-lg bg-[#4B6BFB] px-2.5 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    <RefreshCcw size={12} className={cn(refreshing && 'animate-spin')} />
                    {t('skills.repo.refreshDiscovery')}
                  </button>
                </div>
              </div>
              <button
                onClick={onClose}
                className="titlebar-no-drag rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t('skills.market.closeMarket')}
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-border/80 bg-card px-4 py-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{t('skills.repo.browseByRepo')}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t('skills.repo.browseByRepoDesc')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                    {t('skills.enabledRepos')} {repositories.filter((item) => item.enabled).length} / {repositories.length}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                    {t('skills.installed')} {installedSkills.length}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground">
                    {t('skills.discoveredCount')} {discoveredSkills.length}
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
                            placeholder={t('skills.searchMarketPlaceholder')}
                            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                          />
                        </div>

                        <div className="relative min-w-[180px]">
                          <select
                            value={selectedRepoId}
                            onChange={(event) => setSelectedRepoId(event.target.value)}
                            className="w-full appearance-none rounded-xl border border-border bg-background px-3 py-2 pr-9 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                          >
                            <option value="all">{t('skills.allRepos')}</option>
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
                          <span>{t('skills.onlyInstallable')}</span>
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
                            <p className="text-sm font-medium text-foreground">{t('skills.noDiscovered')}</p>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {repositories.length === 0
                                ? t('skills.noReposDesc')
                                : t('skills.checkRepoDesc')}
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
                                        {skills.length} {t('skills.skillUnit')}
                                      </span>
                                      <span className="text-[11px] text-[#3552D6]">
                                        {t('skills.canInstallUnit')} {skills.length - installedCount}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {repository.repoUrl}
                                      <span className="ml-2">{t('skills.repo.branchLabel')} {repository.branch}</span>
                                    </p>
                                  </div>
                                </div>

                                {expanded && (
                                  <div className="mt-3 space-y-2">
                                    {skills.length === 0 ? (
                                      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center">
                                        <p className="text-sm font-medium text-foreground">{t('skills.repoConfigured')}</p>
                                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                          {t('skills.noSkillFoundDesc')}
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
                                                  <span className="text-[10px] text-muted-foreground">{installed ? t('skills.installed') : t('skills.notInstalled')}</span>
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
                                                    {t('skills.delete')}
                                                  </button>
                                                )}
                                                <button
                                                  onClick={() => handleInstallSkill(skill)}
                                                  disabled={installingKey === skill.key}
                                                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#4B6BFB] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                                >
                                                  {installingKey === skill.key ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                                  {installed ? t('skills.reinstall') : t('skills.installToLocal')}
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
          <NoticeToast tone={notice.tone} message={notice.message} position="top" anchor="viewport" />
        )}

        {manageOpen && (
          <RepositorySettingsModal
            repositories={repositories}
            repoForm={repoForm}
            savingRepo={savingRepo}
            busyRepositoryId={busyRepositoryId}
            refreshing={refreshing}
            refreshingRepositoryId={refreshingRepositoryId}
            onClose={() => setManageOpen(false)}
            onSave={handleSaveRepository}
            onResetForm={() => setRepoForm(EMPTY_REPOSITORY_FORM)}
            onChangeRepoForm={setRepoForm}
            onEditRepository={handleEditRepository}
            onRefreshRepository={handleRefreshRepository}
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
  refreshing,
  refreshingRepositoryId,
  onClose,
  onSave,
  onResetForm,
  onChangeRepoForm,
  onEditRepository,
  onRefreshRepository,
  onToggleRepository,
  onRemoveRepository,
}: {
  repositories: SkillRepository[]
  repoForm: RepositoryFormState
  savingRepo: boolean
  busyRepositoryId: string | null
  refreshing: boolean
  refreshingRepositoryId: string | 'all' | null
  onClose: () => void
  onSave: () => void
  onResetForm: () => void
  onChangeRepoForm: React.Dispatch<React.SetStateAction<RepositoryFormState>>
  onEditRepository: (repository: SkillRepository) => void
  onRefreshRepository: (repositoryId: string) => void
  onToggleRepository: (repository: SkillRepository) => void
  onRemoveRepository: (repositoryId: string) => void
}) {
  const { t, i18n } = useTranslation()
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
              <h2 className="text-[18px] font-semibold text-foreground">{t('skills.repo.title')}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t('skills.repo.desc')}
              </p>
            </div>
            <button
              onClick={onClose}
              className="titlebar-no-drag rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              {t('skills.repo.close')}
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">{t('skills.repo.add')}</div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {t('skills.repo.addDesc')}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{t('skills.repo.url')}</span>
                  <button
                    onClick={() => setAdvancedOpen((value) => !value)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {t('skills.repo.advanced')}
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
                    {repoForm.id ? t('skills.repo.update') : t('skills.repo.add')}
                  </button>
                </div>
              </div>

              {advancedOpen && (
                <div className="mt-3 rounded-2xl border border-border/80 bg-background/72 p-3">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>{t('skills.repo.branch')}</span>
                      <input
                        value={repoForm.branch}
                        onChange={(event) => onChangeRepoForm((value) => ({ ...value, branch: event.target.value }))}
                        placeholder="main"
                        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                      />
                      <p className="text-[11px] text-muted-foreground">{t('skills.repo.branchDesc')}</p>
                    </label>
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>{t('skills.repo.name')}</span>
                      <input
                        value={repoForm.name}
                        onChange={(event) => onChangeRepoForm((value) => ({ ...value, name: event.target.value }))}
                        placeholder={t('skills.repo.namePlaceholder')}
                        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>{t('skills.repo.path')}</span>
                      <input
                        value={repoForm.basePath}
                        onChange={(event) => onChangeRepoForm((value) => ({ ...value, basePath: event.target.value }))}
                        placeholder={t('skills.repo.pathPlaceholder')}
                        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/25"
                      />
                    </label>
                  </div>

                  <div className="mt-3 rounded-2xl border border-border/80 bg-card/85 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-foreground">{t('skills.repo.proxy')}</div>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          {t('skills.repo.proxyDesc')}
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
                        aria-label={repoForm.proxy.enabled ? t('skills.repo.proxyLabel') : t('skills.repo.proxyLabel')}
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
                          <span>{t('skills.repo.proxyProtocol')}</span>
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
                          <span>{t('skills.repo.proxyHost')}</span>
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
                          <span>{t('skills.repo.proxyPort')}</span>
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
                <h3 className="text-sm font-medium text-foreground">{t('skills.repo.list')}</h3>
                <span className="text-[11px] text-muted-foreground">{repositories.length} {t('skills.repo.unit')}</span>
              </div>

              <div className="space-y-2">
                {repositories.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card/70 px-4 py-8 text-center text-sm text-muted-foreground">
                    {t('skills.repo.noRepos')}
                  </div>
                ) : (
                  repositories.map((repository) => (
                    <div key={repository.id} className="rounded-2xl border border-border bg-card/92 px-4 py-4 shadow-sm">
                      {(() => {
                        const isRefreshingThisRepository = refreshing && refreshingRepositoryId === repository.id
                        const isRefreshBlocked = refreshing || busyRepositoryId === repository.id || !repository.enabled

                        return (
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <button onClick={() => onEditRepository(repository)} className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[15px] font-medium text-foreground">{repository.repoUrl}</span>
                            <Github size={13} className="text-muted-foreground" />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span>{t('skills.repo.branchLabel')} {repository.branch}</span>
                            <span>{t('skills.repo.lastUpdate')} {formatTimestamp(repository.lastDiscoveredAt, t, i18n)}</span>
                            {repository.basePath ? <span>{t('skills.repo.pathLabel')} {repository.basePath}</span> : null}
                            {formatRepositoryProxy(repository.proxy) ? <span>{t('skills.repo.proxyLabel')} {formatRepositoryProxy(repository.proxy)}</span> : null}
                          </div>
                          {repository.lastError && (
                            <p className="mt-1 text-[11px] text-destructive">{repository.lastError}</p>
                          )}
                        </button>

                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => onRefreshRepository(repository.id)}
                            disabled={isRefreshBlocked}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                          >
                            <RefreshCcw size={12} className={cn(isRefreshingThisRepository && 'animate-spin')} />
                            {t('skills.repo.refresh')}
                          </button>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{t('skills.repo.enabled')}</span>
                            <button
                              onClick={() => onToggleRepository(repository)}
                              disabled={busyRepositoryId === repository.id}
                              className={cn(
                                'relative inline-flex h-7 w-10 items-center rounded-full transition-colors disabled:opacity-60',
                                repository.enabled ? 'bg-[#3552D6]' : 'bg-muted'
                              )}
                              aria-label={`${repository.enabled ? t('skills.repo.enabled') : t('skills.repo.disabled')} ${repository.name}`}
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
                            {t('skills.delete')}
                          </button>
                        </div>
                      </div>
                        )
                      })()}
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
