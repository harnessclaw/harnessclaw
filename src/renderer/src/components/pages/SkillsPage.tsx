import { useState, useEffect, useCallback } from 'react'
import { Loader2, Puzzle, FolderOpen, FileText, Terminal, Search, X, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

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
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash)
  }
  return SKILL_COLORS[Math.abs(hash) % SKILL_COLORS.length]
}

function parseTools(raw: string): string[] {
  if (!raw) return []
  return raw.split('),').map((tool) => {
    const match = tool.match(/^Bash\((.+?)(?:\)|$)/)
    return match ? match[1].replace(':*', '') : tool.trim()
  }).filter(Boolean)
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, '')
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
      setSkills((prev) => prev.filter((skill) => skill.id !== id))
      setSelectedId(null)
      setContent('')
      setConfirmDeleteId(null)
    }
  }, [])

  const filtered = skills.filter((skill) => {
    if (!search) return true
    const query = search.toLowerCase()
    return skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
  })

  const selectedSkill = skills.find((skill) => skill.id === selectedId)

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className={cn(
        'flex flex-shrink-0 flex-col overflow-hidden border-r border-border transition-[width] duration-200',
        selectedId ? 'w-72' : 'w-full'
      )}>
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Puzzle size={16} className="text-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">技能</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{skills.length}</span>
          <div className="flex-1" />
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
              aria-label="搜索技能"
              className="w-32 rounded-md border border-border bg-card py-1 pl-7 pr-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <Puzzle size={24} className="mx-auto mb-2 text-muted-foreground/30" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                {search ? '没有匹配的技能' : '暂无技能'}
              </p>
            </div>
          ) : selectedId ? (
            <div className="space-y-1">
              {filtered.map((skill) => {
                const isActive = skill.id === selectedId
                const color = getColor(skill.name)
                return (
                  <button
                    key={skill.id}
                    onClick={() => handleSelect(skill)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors',
                      isActive ? 'bg-accent' : 'hover:bg-muted'
                    )}
                  >
                    <div
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {skill.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{skill.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{skill.description.slice(0, 50)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((skill) => {
                const color = getColor(skill.name)
                const tools = parseTools(skill.allowedTools)
                const isConfirming = confirmDeleteId === skill.id
                return (
                  <div
                    key={skill.id}
                    className="group relative cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 hover:border-foreground/10 hover:shadow-md"
                    onClick={() => handleSelect(skill)}
                  >
                    <div
                      className={cn(
                        'absolute right-2.5 top-2.5 z-10 transition-opacity',
                        isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(skill.id)}
                            disabled={deleting}
                            className="rounded-md bg-destructive px-2 py-0.5 text-[10px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                          >
                            {deleting ? '删除中...' : '确认'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(skill.id)}
                          title="删除技能"
                          aria-label={`删除技能 ${skill.name}`}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <div className="mb-3 flex items-start gap-3">
                      <div
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                        style={{ backgroundColor: color }}
                      >
                        {skill.name[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-foreground">{skill.name}</h3>
                        <div className="mt-0.5 flex items-center gap-2">
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
                    <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {skill.description}
                    </p>
                    {tools.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tools.map((tool, index) => (
                          <span key={index} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
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

      {selectedId && selectedSkill && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: getColor(selectedSkill.name) }}
            >
              {selectedSkill.name[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">{selectedSkill.name}</h2>
              <p className="truncate text-[11px] text-muted-foreground">{selectedSkill.description.slice(0, 80)}</p>
            </div>

            {confirmDeleteId === selectedId ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleDelete(selectedId)}
                  disabled={deleting}
                  className="rounded-lg bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleting ? '删除中...' : '确认删除'}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(selectedId)}
                title="删除技能"
                aria-label="删除技能"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}

            <button
              onClick={() => { setSelectedId(null); setContent(''); setConfirmDeleteId(null) }}
              title="关闭"
              aria-label="关闭详情"
              className="rounded-lg p-1.5 transition-colors hover:bg-muted"
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
        </div>
      )}
    </div>
  )
}
