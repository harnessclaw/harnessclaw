import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2, Search, Settings, Check, AlertCircle } from 'lucide-react'
import { useAppConfig } from '@/hooks/useNanobotConfig'
import { cn } from '@/lib/utils'

interface SkillItem {
  slug: string
  title: string
  description: string
  meta: string[]
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
    const description = cols.slice(2).join(' · ')
    return {
      slug,
      title,
      description,
      meta: cols.slice(2, 4),
    }
  })
}

export function ClawHubPage() {
  const navigate = useNavigate()
  const { config, loading } = useAppConfig()
  const token = ((config?.clawhub || {}) as { token?: string }).token?.trim() || ''

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')
  const [items, setItems] = useState<SkillItem[]>([])
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [installedSlug, setInstalledSlug] = useState<string | null>(null)

  const loadExplore = async () => {
    setStatus('loading')
    setError('')
    const res = await window.clawhub.explore()
    if (!res.ok) {
      setStatus('error')
      setItems([])
      setError((res.stderr || res.stdout || 'ClawHub explore failed').trim())
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
    setStatus('loading')
    setError('')
    const res = await window.clawhub.search(query)
    if (!res.ok) {
      setStatus('error')
      setItems([])
      setError((res.stderr || res.stdout || 'ClawHub search failed').trim())
      return
    }
    setItems(parseClawhubOutput(res.stdout))
    setStatus('idle')
  }

  const handleInstall = async (slug: string) => {
    setInstallingSlug(slug)
    setInstalledSlug(null)
    const res = await window.clawhub.installSkill(slug)
    setInstallingSlug(null)
    if (res.ok) {
      setInstalledSlug(slug)
      return
    }
    setError((res.stderr || res.stdout || '安装失败').trim())
    setStatus('error')
  }

  useEffect(() => {
    if (!loading && token) {
      void loadExplore()
    }
  }, [loading, token])

  const emptyText = useMemo(() => {
    if (status === 'loading') return '正在加载...'
    if (query.trim()) return '未找到相关技能'
    return '暂无技能列表'
  }, [query, status])

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
  }

  if (!token) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 shadow-sm text-center">
          <h2 className="text-lg font-semibold text-foreground">ClawHub 未配置 Token</h2>
          <p className="text-sm text-muted-foreground mt-2">请先在设置中完成 ClawHub Token 配置，然后再浏览和安装技能。</p>
          <button
            onClick={() => navigate('/settings', { state: { initialSection: 'clawhub' } })}
            className="mt-5 inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            <Settings size={14} />
            前往设置
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">ClawHub</h1>
            <p className="text-sm text-muted-foreground mt-1">浏览、搜索并安装技能到 `~/.harnessclaw/workspace/skills`</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch()
              }}
              placeholder="搜索技能..."
              className="w-full h-10 pl-9 pr-3 text-sm bg-card border border-border rounded-xl outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            disabled={status === 'loading'}
            className="h-10 px-4 rounded-xl border border-border bg-card hover:bg-muted text-sm font-medium text-foreground transition-colors disabled:opacity-60"
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
            <Loader2 size={18} className="animate-spin mr-2" />
            加载技能列表中...
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-sm text-muted-foreground border border-dashed border-border rounded-2xl bg-card">
            {emptyText}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const installing = installingSlug === item.slug
              const installed = installedSlug === item.slug
              return (
                <div key={item.slug} className="border border-border rounded-2xl bg-card px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                        <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{item.slug}</span>
                      </div>
                      {item.description && <p className="text-sm text-muted-foreground mt-2">{item.description}</p>}
                      {item.meta.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {item.meta.map((meta) => (
                            <span key={meta} className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded-full">{meta}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => void handleInstall(item.slug)}
                      disabled={installing}
                      className={cn(
                        'h-9 px-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5 flex-shrink-0',
                        installed
                          ? 'border-status-connected text-status-connected'
                          : 'border-border bg-card hover:bg-muted text-foreground'
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
