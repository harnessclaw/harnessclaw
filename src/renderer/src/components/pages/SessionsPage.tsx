import { useState } from 'react'
import { Plus, Search, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'

type SessionStatus = 'active' | 'closed' | 'archived'

interface Session {
  id: string
  agentId: string
  agentName: string
  agentEmoji: string
  status: SessionStatus
  messageCount: number
  createdAt: number
  lastMessageAt: number
}

const mockSessions: Session[] = [
  {
    id: 'ses_abc123',
    agentId: '1',
    agentName: 'Assistant Alpha',
    agentEmoji: '🤖',
    status: 'active',
    messageCount: 12,
    createdAt: Date.now() - 3600000,
    lastMessageAt: Date.now() - 1800000
  },
  {
    id: 'ses_def456',
    agentId: '2',
    agentName: 'Code Helper',
    agentEmoji: '💻',
    status: 'closed',
    messageCount: 5,
    createdAt: Date.now() - 86400000,
    lastMessageAt: Date.now() - 82800000
  }
]

const statusConfig: Record<SessionStatus, { label: string; className: string }> = {
  active: { label: '活跃', className: 'text-green-600 bg-green-50 border-green-200' },
  closed: { label: '已关闭', className: 'text-gray-500 bg-gray-50 border-gray-200' },
  archived: { label: '已归档', className: 'text-yellow-600 bg-yellow-50 border-yellow-200' }
}

export function SessionsPage() {
  const [sessions] = useState<Session[]>(mockSessions)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = sessions.filter(
    (s) =>
      s.agentName.toLowerCase().includes(search.toLowerCase()) || s.id.includes(search)
  )

  return (
    <div className="flex flex-col h-full px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Sessions</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索会话..."
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border bg-white outline-none focus:ring-1 focus:ring-ring w-48"
            />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors">
            <Plus size={14} />
            新建会话
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MessageSquare size={40} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">还没有会话记录</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1.5fr_100px_80px_140px_100px] gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border bg-muted/30">
            <span>会话 ID</span>
            <span>Agent</span>
            <span>状态</span>
            <span>消息数</span>
            <span>最后活动</span>
            <span>操作</span>
          </div>

          {/* Data rows */}
          {filtered.map((session) => {
            const status = statusConfig[session.status]
            const isExpanded = expandedId === session.id

            return (
              <div key={session.id}>
                <div
                  className="grid grid-cols-[1fr_1.5fr_100px_80px_140px_100px] gap-4 px-4 py-3 text-sm hover:bg-muted/30 transition-colors cursor-pointer border-b border-border last:border-0"
                  onClick={() => setExpandedId(isExpanded ? null : session.id)}
                >
                  <span className="font-mono text-xs text-foreground truncate">
                    {session.id.slice(0, 12)}...
                  </span>
                  <span className="flex items-center gap-1.5 truncate">
                    <span>{session.agentEmoji}</span>
                    <span className="truncate">{session.agentName}</span>
                  </span>
                  <span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </span>
                  <span className="text-muted-foreground">{session.messageCount}</span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(session.lastMessageAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <button className="text-xs text-foreground hover:underline">继续</button>
                    {isExpanded ? (
                      <ChevronUp size={12} className="text-muted-foreground ml-auto" />
                    ) : (
                      <ChevronDown size={12} className="text-muted-foreground ml-auto" />
                    )}
                  </span>
                </div>

                {/* Expanded history preview */}
                {isExpanded && (
                  <div className="px-4 py-3 bg-muted/20 border-b border-border">
                    <p className="text-xs text-muted-foreground">最近消息预览</p>
                    <p className="text-sm text-muted-foreground mt-1 italic">（加载中...）</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
