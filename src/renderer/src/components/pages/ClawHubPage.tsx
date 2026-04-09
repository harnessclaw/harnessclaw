import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Search, Check, AlertCircle } from 'lucide-react'
import { useAppConfig } from '@/hooks/useNanobotConfig'
import { cn } from '@/lib/utils'
import { defaultSkillsDisplayPath } from '@/lib/runtimePaths'

interface SkillItem {
  slug: string
  title: string
  description: string
  meta: string[]
}

function getFriendlyClawhubError(message: string): string {
  const text = message.trim()
  if (!text) return ''
  if (/Bundled runtime source is incomplete/i.test(text)) {
    return '内置 ClawHub 运行时不完整，请先点击“刷新”或重新同步运行时。'
  }
  if (/Bundled ClawHub entrypoint not found/i.test(text) || /Bundled runtime entry not found/i.test(text)) {
    return '内置 ClawHub 入口文件缺失，应用会尝试重新同步运行时。'
  }
  if (/Timed out after/i.test(text)) {
    return 'ClawHub 响应超时，请稍后重试。'
  }
  return text
}

function getClawhubError(stderr: string, stdout: string): string {
  const combined = [stderr, stdout]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n')

  if (!combined) return ''

  const lines = combined
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const meaningful = lines.filter((line) => !/^-\s+/.test(line))
  const text = meaningful.join('\n') || combined

  if (/rate limit exceeded/i.test(text)) return getFriendlyClawhubError(text)
  if (/^error:/im.test(text)) return getFriendlyClawhubError(text)
  if (/Bundled/i.test(text)) return getFriendlyClawhubError(text)

  return ''
}

function parseClawhubOutput(raw: string): SkillItem[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  const dataLines = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return false
    if (/^(available skills|results|search results)/i.test(trimmed)) return false
    if (/^[-=]{3,}$/.test(trimmed)) return false
    if (/^(name|slug)\s{2,}/i.test(trimmed)) return false
    return true
  })

  return dataLines.map((line) => {
    const cols = line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean)
    const slug = cols[0] || line
    const title = cols[1] || slug
    const description = cols.slice(2).join(' / ')
    return {
      slug,
      title,
      description,
      meta: cols.slice(2, 4),
    }
  })
}

export function ClawHubPage() {
  const { config, loading } = useAppConfig()
  const token = ((config?.clawhub || {}) as { token?: string }).token?.trim() || ''

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')
  const [items, setItems] = useState<SkillItem[]>([])
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [installedSlug, setInstalledSlug] = useState<string | null>(null)

  const loadExplore = async () => {
    void window.appRuntime.trackUsage({
      category: 'clawhub',
      action: 'explore',
      status: 'started',
    })
    setStatus('loading')
    setError('')
    const res = await window.clawhub.explore()
    const clawhubError = getClawhubError(res.stderr || '', res.stdout || '')
    if (!res.ok || clawhubError) {
      setStatus('error')
      setItems([])
      setError(getFriendlyClawhubError((clawhubError || res.stderr || res.stdout || 'ClawHub explore failed').trim()))
      return
    }
    setItems(parseClawhubOutput(res.stdout))
    setStatus('idle')
  }

  const handleSearch = async () => {
    if (!query.trim()) {
      await loadExplore()
      return
    }
    void window.appRuntime.trackUsage({
      category: 'clawhub',
      action: 'search',
      status: 'started',
      details: { queryLength: query.trim().length },
    })
    setStatus('loading')
    setError('')
    const res = await window.clawhub.search(query)
    const clawhubError = getClawhubError(res.stderr || '', res.stdout || '')
    if (!res.ok || clawhubError) {
      setStatus('error')
      setItems([])
      setError(getFriendlyClawhubError((clawhubError || res.stderr || res.stdout || 'ClawHub search failed').trim()))
      return
    }
    setItems(parseClawhubOutput(res.stdout))
    setStatus('idle')
  }

  const handleInstall = async (slug: string) => {
    void window.appRuntime.trackUsage({
      category: 'clawhub',
      action: 'install_skill',
      status: 'started',
      details: { slug },
    })
    setInstallingSlug(slug)
    setInstalledSlug(null)
    setError('')
    const res = await window.clawhub.installSkill(slug)
    setInstallingSlug(null)
    if (res.ok) {
      setInstalledSlug(slug)
      return
    }
    setError(getFriendlyClawhubError((res.stderr || res.stdout || '安装失败').trim()))
    setStatus('error')
  }

  useEffect(() => {
    void window.appRuntime.trackUsage({
      category: 'navigation',
      action: 'open_clawhub_page',
      status: 'ok',
    })
  }, [])

  useEffect(() => {
    if (!loading) {
      void loadExplore()
    }
  }, [loading])

  const emptyText = useMemo(() => {
    if (status === 'loading') return '正在加载...'
    if (query.trim()) return '没有找到相关技能。'
    return token ? '暂时没有可展示的技能列表。' : '还没有可展示的技能列表。'
  }, [query, status, token])

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">ClawHub</h1>
            <p className="mt-1 text-sm text-muted-foreground">浏览、搜索并安装技能到 `{defaultSkillsDisplayPath}`</p>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch()
              }}
              placeholder="搜索技能..."
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            disabled={status === 'loading'}
            className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {query.trim() ? '搜索' : '刷新'}
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {status === 'loading' && items.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 size={18} className="mr-2 animate-spin" />
            正在加载技能列表...
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-card py-24 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const installing = installingSlug === item.slug
              const installed = installedSlug === item.slug
              return (
                <div key={item.slug} className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{item.slug}</span>
                      </div>
                      {item.description && <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>}
                      {item.meta.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.meta.map((meta) => (
                            <span key={meta} className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{meta}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => void handleInstall(item.slug)}
                      disabled={installing}
                      className={cn(
                        'flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
                        installed
                          ? 'border-status-connected text-status-connected'
                          : 'border-border bg-card text-foreground hover:bg-muted'
                      )}
                    >
                      {installing ? <Loader2 size={14} className="animate-spin" /> : installed ? <Check size={14} /> : <Download size={14} />}
                      {installing ? '安装中' : installed ? '已安装' : '安装'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
