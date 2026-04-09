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

const mockAgents: Agent[] = [
  {
    id: '1',
    name: 'Assistant Alpha',
    emoji: 'A',
    workspace: 'main',
    model: 'qwen3-max',
    createdAt: Date.now() - 86400000,
  },
  {
    id: '2',
    name: 'Code Helper',
    emoji: 'C',
    workspace: 'main',
    model: 'qwen3-max',
    createdAt: Date.now() - 172800000,
  },
]

export function AgentsPage() {
  const [agents] = useState<Agent[]>(mockAgents)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const filtered = agents.filter((agent) => agent.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex h-full flex-col px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Agents</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 Agent..."
              className="w-48 rounded-lg border border-border bg-white px-3 py-1.5 pl-8 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <Plus size={14} />
            创建 Agent
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Bot size={40} className="mx-auto mb-3 text-muted-foreground/40" />
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {showCreate && <CreateAgentDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="group relative cursor-pointer rounded-xl border border-border bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{agent.emoji}</span>
          <div>
            <p className="text-sm font-semibold leading-tight text-foreground">{agent.name}</p>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {agent.workspace}
            </span>
          </div>
        </div>
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
            className="rounded p-1 opacity-0 transition-all hover:bg-muted group-hover:opacity-100"
          >
            <MoreHorizontal size={14} className="text-muted-foreground" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-10 w-32 rounded-lg border border-border bg-white py-1 shadow-lg">
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted">
                <Pencil size={12} /> 编辑
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted">
                <Archive size={12} /> 归档
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10">
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {agent.model}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
      </p>
    </div>
  )
}

function CreateAgentDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: '', emoji: 'A', workspace: 'main', model: 'qwen3-max' })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold">创建 Agent</h3>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Agent 名称"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">标识</label>
            <input
              value={form.emoji}
              onChange={(e) => setForm({ ...form, emoji: e.target.value })}
              className="w-20 rounded-lg border border-border px-3 py-2 text-center text-lg outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">工作区</label>
            <input
              value={form.workspace}
              onChange={(e) => setForm({ ...form, workspace: e.target.value })}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            取消
          </button>
          <button className="rounded-lg bg-foreground px-4 py-2 text-sm text-background hover:bg-foreground/90">
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
