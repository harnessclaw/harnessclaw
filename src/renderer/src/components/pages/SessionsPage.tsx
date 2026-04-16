import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SessionRow extends DbSessionRow {
  messageCount: number
}

function getSessionLabel(title: string, sessionId: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  return `对话 ${sessionId.slice(0, 8)}`
}

export function SessionsPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const loadSessions = async () => {
    setLoading(true)
    try {
      const rows = await window.db.listSessions()
      const rowsWithCounts = await Promise.all(
        rows.map(async (row) => {
          const messages = await window.db.getMessages(row.session_id)
          const messageCount = messages.filter((message) => message.role !== 'system').length
          return { ...row, messageCount }
        })
      )
      setSessions(rowsWithCounts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [])

  useEffect(() => {
    const offSessionsChanged = window.db.onSessionsChanged(() => {
      void loadSessions()
    })
    return () => offSessionsChanged()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuSessionId(null)
        setRenamingSessionId(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const filteredSessions = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((session) => {
      const label = getSessionLabel(session.title, session.session_id).toLowerCase()
      return label.includes(keyword) || session.session_id.toLowerCase().includes(keyword)
    })
  }, [search, sessions])

  const handleStartChat = () => {
    navigate('/chat', { state: { createSession: true } })
  }

  const handleOpenChat = (sessionId: string) => {
    navigate('/chat', { state: { sessionId } })
  }

  const handleDeleteSession = async (sessionId: string) => {
    const result = await window.db.deleteSession(sessionId)
    if (!result.ok) return
    setSessions((prev) => prev.filter((session) => session.session_id !== sessionId))
    setMenuSessionId(null)
    if (renamingSessionId === sessionId) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }

  const handleRenameSession = async (sessionId: string) => {
    const nextTitle = renameValue.trim()
    if (!nextTitle) {
      setRenamingSessionId(null)
      setRenameValue('')
      return
    }

    const result = await window.db.updateSessionTitle(sessionId, nextTitle)
    if (!result.ok) return

    setSessions((prev) => prev.map((session) => (
      session.session_id === sessionId
        ? { ...session, title: nextTitle, updated_at: Date.now() }
        : session
    )))
    setRenamingSessionId(null)
    setRenameValue('')
    setMenuSessionId(null)
  }

  return (
    <div className="flex h-full flex-col px-6 py-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">对话</h2>
          <p className="mt-1 text-sm text-muted-foreground">查看历史会话，或继续最近的上下文。</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索对话..."
              className="w-52 rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
          <button
            onClick={handleStartChat}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 dark:bg-primary dark:text-primary-foreground"
          >
            <Plus size={14} />
            新建对话
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
              <MessageSquare size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-foreground">
              {sessions.length === 0 ? '还没有对话记录' : '没有匹配的对话'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sessions.length === 0 ? '开始一次新的对话后，这里会出现历史记录。' : '换个关键词再试试。'}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative overflow-visible rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-[minmax(0,1.6fr)_140px_56px] gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground">
            <span>对话</span>
            <span>最近更新</span>
            <span className="text-right">操作</span>
          </div>

          <div className="divide-y divide-border">
            {filteredSessions.map((session) => {
              const isRenaming = renamingSessionId === session.session_id
              return (
                <div key={session.session_id} className="grid grid-cols-[minmax(0,1.6fr)_140px_56px] gap-4 px-4 py-3 transition-colors hover:bg-muted/20">
                  <button
                    onClick={() => handleOpenChat(session.session_id)}
                    className="min-w-0 text-left"
                  >
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => void handleRenameSession(session.session_id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void handleRenameSession(session.session_id)
                          }
                          if (event.key === 'Escape') {
                            setRenamingSessionId(null)
                            setRenameValue('')
                          }
                        }}
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                      />
                    ) : (
                      <>
                        <p className="truncate text-sm font-medium text-foreground">
                          {getSessionLabel(session.title, session.session_id)}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate font-mono">{session.session_id}</span>
                          <span>{session.messageCount} 条消息</span>
                        </div>
                      </>
                    )}
                  </button>

                  <div className="flex items-center text-xs text-muted-foreground">
                    {new Date(session.updated_at).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>

                  <div className="relative flex items-center justify-end">
                    <button
                      onClick={() => setMenuSessionId((prev) => prev === session.session_id ? null : session.session_id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="更多操作"
                    >
                      <MoreHorizontal size={15} />
                    </button>

                    {menuSessionId === session.session_id && (
                      <div className="absolute right-0 top-10 z-10 min-w-[120px] rounded-xl border border-border bg-card p-1 shadow-lg">
                        <button
                          onClick={() => {
                            setRenamingSessionId(session.session_id)
                            setRenameValue(getSessionLabel(session.title, session.session_id))
                            setMenuSessionId(null)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
                        >
                          <Pencil size={14} />
                          重命名
                        </button>
                        <button
                          onClick={() => void handleDeleteSession(session.session_id)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
