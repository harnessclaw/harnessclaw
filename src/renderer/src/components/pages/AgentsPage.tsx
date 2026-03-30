import { useState } from 'react'
import { Plus, Search, MoreHorizontal, Bot, Trash2, Pencil, Archive } from 'lucide-react'

interface Agent {
  id: string
  name: string
  emoji: string
  workspace: string
  model: string
  createdAt: number
}

// Mock data (replace with real API later)
const mockAgents: Agent[] = [
  {
    id: '1',
    name: 'Assistant Alpha',
    emoji: '🤖',
    workspace: 'main',
    model: 'qwen3-max',
    createdAt: Date.now() - 86400000
  },
  {
    id: '2',
    name: 'Code Helper',
    emoji: '💻',
    workspace: 'main',
    model: 'qwen3-max',
    createdAt: Date.now() - 172800000
  }
]

export function AgentsPage() {
  const [agents] = useState<Agent[]>(mockAgents)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col h-full px-6 py-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Agents</h2>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 Agent..."
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border bg-white outline-none focus:ring-1 focus:ring-ring w-48"
            />
          </div>
          {/* Create button */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
          >
            <Plus size={14} />
            创建 Agent
          </button>
        </div>
      </div>

      {/* Agent card grid */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Bot size={40} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">还没有 Agent</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm text-foreground underline"
            >
              创建第一个 Agent
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {/* Create Agent Dialog */}
      {showCreate && <CreateAgentDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="bg-white rounded-xl border border-border p-4 hover:shadow-sm transition-shadow cursor-pointer relative group">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{agent.emoji}</span>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">{agent.name}</p>
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
              {agent.workspace}
            </span>
          </div>
        </div>
        {/* Action menu */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all"
          >
            <MoreHorizontal size={14} className="text-muted-foreground" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 bg-white border border-border rounded-lg shadow-lg py-1 z-10 w-32">
              <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2">
                <Pencil size={12} /> 编辑
              </button>
              <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2">
                <Archive size={12} /> 归档
              </button>
              <button className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2">
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Model tag */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
          {agent.model}
        </span>
      </div>

      {/* Created time */}
      <p className="text-xs text-muted-foreground mt-2">
        {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
      </p>
    </div>
  )
}

function CreateAgentDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: '', emoji: '🤖', workspace: 'main', model: 'qwen3-max' })

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-border p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-4">创建 Agent</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Agent 名称"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Emoji</label>
            <input
              value={form.emoji}
              onChange={(e) => setForm({ ...form, emoji: e.target.value })}
              className="w-20 px-3 py-2 text-sm rounded-lg border border-border outline-none focus:ring-1 focus:ring-ring text-center text-lg"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">工作区</label>
            <input
              value={form.workspace}
              onChange={(e) => setForm({ ...form, workspace: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted"
          >
            取消
          </button>
          <button className="px-4 py-2 text-sm rounded-lg bg-foreground text-background hover:bg-foreground/90">
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
