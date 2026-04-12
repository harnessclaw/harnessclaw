import { useState, useEffect, useCallback } from 'react'
import { Loader2, Puzzle, FolderOpen, FileText, Terminal, Search, X, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { HarnessclawStatusBadge } from '../common/HarnessclawStatusBadge'

interface SkillInfo {
  id: string
  name: string
  description: string
  allowedTools: string
  hasReferences: boolean
  hasTemplates: boolean
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
  return raw.split('),').map((t) => {
    const m = t.match(/^Bash\((.+?)(?:\)|$)/)
    return m ? m[1].replace(':*', '') : t.trim()
  }).filter(Boolean)
}

// Strip YAML frontmatter from markdown
function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n*/, '')
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

  useEffect(() => {
    window.skills.list().then((data) => {
      setSkills(data)
      setLoading(false)
    })
  }, [])

  const handleSelect = (skill: SkillInfo) => {
    if (selectedId === skill.id) {
      setSelectedId(null)
      setContent('')
      return
    }
    setSelectedId(skill.id)
    setConfirmDeleteId(null)
    setContentLoading(true)
    window.skills.read(skill.id).then((md) => {
      setContent(stripFrontmatter(md))
      setContentLoading(false)
    })
  }

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(true)
    const result = await window.skills.delete(id)
    setDeleting(false)
    if (result.ok) {
      setSkills((prev) => prev.filter((s) => s.id !== id))
      setSelectedId(null)
      setContent('')
      setConfirmDeleteId(null)
    }
  }, [])

  const filtered = skills.filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  })

  const selectedSkill = skills.find((s) => s.id === selectedId)

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: card list */}
      <div className={cn(
        'flex-shrink-0 border-r border-border flex flex-col overflow-hidden transition-[width] duration-200',
        selectedId ? 'w-72' : 'w-full'
      )}>
        {/* Header */}
        <div className="titlebar-drag px-4 py-3 border-b border-border flex items-center gap-2 flex-shrink-0">
          <Puzzle size={16} className="text-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">技能</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{skills.length}</span>
          <div className="flex-1" />
          <HarnessclawStatusBadge />
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
              aria-label="搜索技能"
              className="pl-7 pr-2 py-1 text-xs rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/40 w-32"
            />
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-8 text-center">
              <Puzzle size={24} className="text-muted-foreground/30 mx-auto mb-2" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                {search ? '没有匹配的技能' : '暂无技能'}
              </p>
            </div>
          ) : selectedId ? (
            // Compact list when detail is open
            <div className="space-y-1">
              {filtered.map((skill) => {
                const color = getColor(skill.name)
                const isActive = skill.id === selectedId
                return (
                  <button
                    key={skill.id}
                    onClick={() => handleSelect(skill)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
                      isActive ? 'bg-accent' : 'hover:bg-muted'
                    )}
                  >
                    <div
                      className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                      style={{ backgroundColor: color }}
                    >
                      {skill.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{skill.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{skill.description.slice(0, 50)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            // Full grid when no detail
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((skill) => {
                const color = getColor(skill.name)
                const tools = parseTools(skill.allowedTools)
                const isConfirming = confirmDeleteId === skill.id
                return (
                  <div
                    key={skill.id}
                    className="group relative text-left bg-card border border-border rounded-xl p-4 hover:shadow-md hover:border-foreground/10 transition-all duration-200 cursor-pointer"
                    onClick={() => handleSelect(skill)}
                  >
                    {/* Delete button — top right, visible on hover or confirming */}
                    <div
                      className={cn(
                        'absolute top-2.5 right-2.5 z-10 transition-opacity',
                        isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                      onClick={(e) => e.stopPropagation()}
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

                    <div className="flex items-start gap-3 mb-3">
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
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 mb-3">
                      {skill.description}
                    </p>
                    {tools.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tools.map((tool, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">
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
      </div>

      {/* Right: skill content detail */}
      {selectedId && selectedSkill && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Detail header */}
          <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-shrink-0">
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

            {/* Delete action */}
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
              onClick={() => { setSelectedId(null); setContent(''); setConfirmDeleteId(null) }}
              title="关闭"
              aria-label="关闭详情"
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <X size={14} className="text-muted-foreground" aria-hidden="true" />
            </button>
          </div>

          {/* Markdown content */}
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
        </div>
      )}
    </div>
  )
}
