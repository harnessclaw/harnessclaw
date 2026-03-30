import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Send, Plus, ChevronLeft, ChevronRight, Copy, Check, Trash2,
  Loader2, Wrench, Brain, AlertCircle, RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant' | 'system'
type EmmaStatus = 'disconnected' | 'connecting' | 'connected'

interface ToolActivity {
  type: 'hint' | 'call' | 'result'
  name?: string
  content: string
  callId?: string
  isError?: boolean
  ts: number
}

interface Message {
  id: string
  role: MessageRole
  content: string // kept for compatibility, accumulated text
  timestamp: number
  isStreaming?: boolean
  thinking?: string
  tools?: ToolActivity[]
  toolsUsed?: string[]
  contentSegments?: Array<{ text: string; ts: number }> // text segments with timestamps for interleaving
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

interface SessionItem {
  key: string
  updatedAt?: string
}

// Per-session state
interface SessionState {
  messages: Message[]
  pendingAssistantId: string | null
  isProcessing: boolean
  currentThinking: string
}

// ─── Chat Page ──────────────────────────────────────────────────────────────

export function ChatPage() {
  const location = useLocation()
  const [sessionMap, setSessionMap] = useState<Record<string, SessionState>>({})
  const [activeSessionId, setActiveSessionId] = useState('')
  const [input, setInput] = useState(location.state?.initialMessage || '')
  const [showSidebar, setShowSidebar] = useState(true)
  const [emmaStatus, setEmmaStatus] = useState<EmmaStatus>('disconnected')
  const [clientId, setClientId] = useState('')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pendingInitialMessage = useRef<string>(location.state?.initialMessage || '')
  // Track pendingAssistantId per session in a ref map
  const pendingAssistantIds = useRef<Record<string, string | null>>({})
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const maxLength = 4000

  const [dbSessions, setDbSessions] = useState<{ session_id: string; title: string; updated_at: number }[]>([])

  // Get or create session state
  const getSession = useCallback((sid: string): SessionState => {
    return sessionMap[sid] || { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '' }
  }, [sessionMap])

  // Update a specific session's state
  const updateSession = useCallback((sid: string, updater: (prev: SessionState) => SessionState) => {
    setSessionMap((prev) => ({
      ...prev,
      [sid]: updater(prev[sid] || { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '' }),
    }))
  }, [])

  const sendInitialMessage = useCallback((sid: string, text: string) => {
    pendingInitialMessage.current = ''
    setInput('')
    setActiveSessionId(sid)
    updateSession(sid, (prev) => ({
      ...prev,
      isProcessing: true,
      currentThinking: '',
      messages: [...prev.messages, { id: `usr-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }],
    }))
    window.emma.send(text, sid)
  }, [updateSession])

  const activeSession = getSession(activeSessionId)

  // Display sessions from sessionMap only (user-created or DB-loaded), enriched with server info
  const displayedSessions = useMemo(() => {
    const localKeys = Object.keys(sessionMap)
    return localKeys.map((key) => {
      const serverInfo = sessions.find((s) => s.key === key)
      const localState = sessionMap[key]
      const dbInfo = dbSessions.find((d) => d.session_id === key)
      const msgCount = localState?.messages.filter((m) => m.role !== 'system').length || 0
      const firstMsg = localState?.messages.find((m) => m.role === 'user')?.content || ''
      const title = dbInfo?.title || ''
      return { key, updatedAt: serverInfo?.updatedAt, msgCount, firstMsg, title }
    })
  }, [sessionMap, sessions, dbSessions])

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession.messages, activeSession.currentThinking])

  // Helper: convert DB rows to Message[]
  const dbRowsToMessages = useCallback((rows: DbMessageRow[]): Message[] => {
    return rows.map((r) => {
      const contentSegments = r.content_segments
        ? JSON.parse(r.content_segments) as Array<{ text: string; ts: number }>
        : (r.content ? [{ text: r.content, ts: r.created_at }] : [])

      return {
        id: r.id,
        role: r.role as MessageRole,
        content: r.content,
        timestamp: r.created_at,
        thinking: r.thinking || undefined,
        toolsUsed: r.tools_used ? JSON.parse(r.tools_used) : undefined,
        usage: r.usage_total != null ? {
          prompt_tokens: r.usage_prompt || 0,
          completion_tokens: r.usage_completion || 0,
          total_tokens: r.usage_total || 0,
        } : undefined,
        tools: r.tools.map((t) => ({
          type: t.type as ToolActivity['type'],
          name: t.name || undefined,
          content: t.content,
          callId: t.call_id || undefined,
          isError: t.is_error === 1,
          ts: t.created_at,
        })),
        contentSegments,
      }
    })
  }, [])

  // Load persisted sessions from DB on mount
  useEffect(() => {
    window.db.listSessions().then(async (rows) => {
      if (rows.length === 0) return
      setDbSessions(rows.map((r) => ({ session_id: r.session_id, title: r.title, updated_at: r.updated_at })))
      setSessions(rows.map((r) => ({ key: r.session_id, updatedAt: new Date(r.updated_at).toLocaleString('zh-CN') })))
      // Load messages for all persisted sessions
      const entries: Record<string, SessionState> = {}
      for (const row of rows) {
        const msgs = await window.db.getMessages(row.session_id)
        entries[row.session_id] = {
          messages: msgs.length > 0 ? dbRowsToMessages(msgs) : [],
          pendingAssistantId: null,
          isProcessing: false,
          currentThinking: '',
        }
      }
      setSessionMap((prev) => ({ ...entries, ...prev }))
      if (!activeSessionIdRef.current && rows[0]?.session_id) {
        setActiveSessionId(rows[0].session_id)
      }
    })
  }, [])

  // Sync Emma status on mount
  useEffect(() => {
    const offStatus = window.emma.onStatus((s) => {
      setEmmaStatus(s as EmmaStatus)
    })

    const offEvent = window.emma.onEvent((event) => {
      handleEmmaEvent(event)
    })

    window.emma.getStatus().then((s) => {
      setEmmaStatus(s.status as EmmaStatus)
      if (s.clientId) setClientId(s.clientId)
      // Don't auto-set activeSessionId — user should pick or create a session
      if (s.status === 'connected' && pendingInitialMessage.current && s.sessionId) {
        sendInitialMessage(s.sessionId, pendingInitialMessage.current)
      }
    })

    // Request session list
    window.emma.listSessions()

    return () => {
      offStatus()
      offEvent()
    }
  }, [])

  // Handle Emma events — route by session_id
  const handleEmmaEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string
    const eventSessionId = event.session_id as string | undefined
    console.log('[ChatPage] event:', type, 'session_id:', eventSessionId, 'activeRef:', activeSessionIdRef.current)

    switch (type) {
      case 'connected': {
        const cid = event.client_id as string
        setClientId(cid)
        setEmmaStatus('connected')
        // Don't auto-set activeSessionId — user creates/selects sessions manually
        window.emma.listSessions()
        // Auto-send pending initial message if exists (from route state)
        if (pendingInitialMessage.current) {
          const sid = event.session_id as string
          sendInitialMessage(sid, pendingInitialMessage.current)
        }
        break
      }

      case 'subscribed': {
        // When server confirms subscription, migrate temp session id to real one
        const sid = eventSessionId!
        const currentActive = activeSessionIdRef.current
        if (currentActive && currentActive.startsWith('emma:new-') && sid !== currentActive) {
          setSessionMap((prev) => {
            const tempState = prev[currentActive]
            if (!tempState) return prev
            const next = { ...prev, [sid]: tempState }
            delete next[currentActive]
            return next
          })
          setActiveSessionId(sid)
        }
        break
      }

      case 'unsubscribed':
        break

      case 'turn_start': {
        const sid = eventSessionId!
        const id = `ast-${Date.now()}`
        pendingAssistantIds.current[sid] = id
        updateSession(sid, (prev) => ({
          ...prev,
          isProcessing: true,
          currentThinking: '',
          messages: [...prev.messages, { id, role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true, tools: [], contentSegments: [] }],
        }))
        break
      }

      case 'thinking': {
        const sid = eventSessionId!
        const text = event.content as string
        const aid = pendingAssistantIds.current[sid]
        updateSession(sid, (prev) => ({
          ...prev,
          isProcessing: true,
          currentThinking: text,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, thinking: text } : m),
        }))
        break
      }

      case 'tool_hint': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        const activity: ToolActivity = { type: 'hint', content: event.content as string, ts: Date.now() }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'tool_call': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        const activity: ToolActivity = {
          type: 'call',
          name: event.name as string,
          content: JSON.stringify(event.arguments, null, 2),
          callId: event.call_id as string,
          ts: Date.now(),
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'tool_result': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        const activity: ToolActivity = {
          type: 'result',
          name: event.name as string,
          content: event.content as string,
          callId: event.call_id as string,
          isError: event.is_error as boolean,
          ts: Date.now(),
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'text_delta': {
        const sid = eventSessionId!
        let aid = pendingAssistantIds.current[sid]
        const chunk = event.content as string
        const now = Date.now()
        if (!aid) {
          // No turn_start received — auto-create assistant message
          aid = `ast-${now}`
          pendingAssistantIds.current[sid] = aid
          updateSession(sid, (prev) => ({
            ...prev,
            isProcessing: true,
            currentThinking: '',
            messages: [...prev.messages, {
              id: aid!,
              role: 'assistant' as MessageRole,
              content: chunk || '',
              timestamp: now,
              isStreaming: true,
              tools: [],
              contentSegments: [{ text: chunk || '', ts: now }]
            }],
          }))
        } else if (chunk) {
          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => {
              if (m.id !== aid) return m
              const segments = m.contentSegments || []
              const lastSeg = segments[segments.length - 1]
              const lastToolTs = m.tools && m.tools.length > 0 ? m.tools[m.tools.length - 1].ts : 0
              // If a tool was added after the last text segment, start a new segment
              if (lastSeg && lastToolTs > lastSeg.ts) {
                return { ...m, content: m.content + chunk, contentSegments: [...segments, { text: chunk, ts: now }] }
              }
              // Otherwise append to the last segment
              if (lastSeg) {
                const updated = [...segments]
                updated[updated.length - 1] = { text: lastSeg.text + chunk, ts: lastSeg.ts }
                return { ...m, content: m.content + chunk, contentSegments: updated }
              }
              // No segments yet, create first one
              return { ...m, content: m.content + chunk, contentSegments: [{ text: chunk, ts: now }] }
            }),
          }))
        }
        break
      }

      case 'text_done': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        if (aid) {
          updateSession(sid, (prev) => ({
            ...prev,
            currentThinking: '',
            messages: prev.messages.map((m) =>
              m.id === aid ? { ...m, isStreaming: false } : m
            ),
          }))
        }
        break
      }

      case 'response_end': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        // Clear pending id — turn is fully complete
        pendingAssistantIds.current[sid] = null
        updateSession(sid, (prev) => ({
          ...prev,
          isProcessing: false,
          currentThinking: '',
          messages: prev.messages.map((m) =>
            m.id === aid
              ? {
                  ...m,
                  isStreaming: false,
                  toolsUsed: event.tools_used as string[] | undefined,
                  usage: event.usage as Message['usage'],
                }
              : m
          ),
        }))
        break
      }

      case 'sessions': {
        // Server may use event.data or event.sessions; item may use key/session_id/id
        const raw = (event.data || event.sessions) as unknown[]
        if (Array.isArray(raw)) {
          setSessions(
            raw.map((s: unknown) => {
              const obj = s as Record<string, unknown>
              return {
                key: (obj.key || obj.session_id || obj.id || String(s)) as string,
                updatedAt: (obj.updatedAt || obj.updated_at) as string | undefined,
              }
            })
          )
        }
        break
      }

      case 'stopped': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        pendingAssistantIds.current[sid] = null
        updateSession(sid, (prev) => ({
          ...prev,
          isProcessing: false,
          currentThinking: '',
          messages: prev.messages.map((m) =>
            m.id === aid ? { ...m, isStreaming: false, content: m.content || '(已终止)' } : m
          ),
        }))
        break
      }

      case 'error': {
        // Route to active session or show globally
        const sid = eventSessionId || ''
        if (sid) {
          updateSession(sid, (prev) => ({
            ...prev,
            isProcessing: false,
            messages: [...prev.messages, { id: `err-${Date.now()}`, role: 'system', content: `Error: ${event.content}`, timestamp: Date.now() }],
          }))
        }
        break
      }

      case 'pong':
        break

      default:
        console.log('[Emma event]', type, JSON.stringify(event))
    }
  }, [sendInitialMessage, updateSession])

  const handleSend = () => {
    console.log('[ChatPage] handleSend activeSessionId:', activeSessionId, 'input:', input.slice(0, 20))
    if (!input.trim() || activeSession.isProcessing || emmaStatus !== 'connected' || !activeSessionId) return

    updateSession(activeSessionId, (prev) => ({
      ...prev,
      isProcessing: true,
      currentThinking: '',
      messages: [...prev.messages, { id: `usr-${Date.now()}`, role: 'user', content: input, timestamp: Date.now() }],
    }))
    window.emma.send(input, activeSessionId)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend()
    }
  }

  // New session: send /new command to create a fresh session via the default session
  const handleNewSession = () => {
    if (emmaStatus !== 'connected') return
    // Generate a unique session id
    const newId = `emma:new-${Date.now().toString(36)}`
    console.log('[ChatPage] handleNewSession newId:', newId)
    // Subscribe + send /new to that session — server creates it
    window.emma.command('/new', newId)
    // Init local state and switch
    setSessionMap((prev) => ({
      ...prev,
      [newId]: { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '' },
    }))
    setActiveSessionId(newId)
    // Refresh session list
    setTimeout(() => window.emma.listSessions(), 500)
  }

  const handleSwitchSession = (key: string) => {
    if (key === activeSessionId) return
    window.emma.subscribe(key)
    window.db.getMessages(key).then((rows) => {
      if (rows.length > 0) {
        setSessionMap((prev) => ({
          ...prev,
          [key]: { messages: dbRowsToMessages(rows), pendingAssistantId: null, isProcessing: false, currentThinking: '' },
        }))
      } else {
        setSessionMap((prev) => {
          if (!prev[key]) {
            return { ...prev, [key]: { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '' } }
          }
          return prev
        })
      }
    })
    setActiveSessionId(key)
  }

  const handleReconnect = () => {
    window.emma.disconnect().then(() => {
      setTimeout(() => window.emma.connect(), 300)
    })
  }

  const handleDeleteSession = (sid: string) => {
    window.db.deleteSession(sid)
    setSessionMap((prev) => {
      const next = { ...prev }
      delete next[sid]
      return next
    })
    setDbSessions((prev) => prev.filter((d) => d.session_id !== sid))
    setSessions((prev) => prev.filter((s) => s.key !== sid))
    if (activeSessionId === sid) {
      setActiveSessionId('')
    }
  }

  const handleStop = () => {
    if (!activeSessionId) return
    // Send stop command per API protocol: { type: "stop", session_id: "..." }
    window.emma.stop(activeSessionId)
  }

  const handleClearHistory = () => {
    if (activeSessionId) {
      window.db.deleteSession(activeSessionId)
    }
    updateSession(activeSessionId, (prev) => ({
      ...prev,
      messages: [],
      currentThinking: '',
    }))
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Session sidebar */}
      {showSidebar && (
        <div className="w-60 flex-shrink-0 border-r border-border bg-card flex flex-col">
          <div className="p-3 border-b border-border">
            <button
              onClick={handleNewSession}
              disabled={emmaStatus !== 'connected'}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-[#1A1A1A] text-white hover:bg-[#333333] disabled:opacity-50 transition-colors"
            >
              <Plus size={14} />
              新建会话
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto p-2">
            {displayedSessions.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">暂无会话记录</div>
            ) : (
              displayedSessions.map((s) => {
                const isActive = s.key === activeSessionId
                const label = s.title
                  ? s.title.length > 20 ? s.title.slice(0, 20) + '...' : s.title
                  : s.firstMsg
                    ? s.firstMsg.length > 20 ? s.firstMsg.slice(0, 20) + '...' : s.firstMsg
                    : '新建会话'
                return (
                  <div
                    key={s.key}
                    className={cn(
                      'group/item w-full text-left px-3 py-2.5 rounded-lg transition-colors mb-1 flex items-start justify-between cursor-pointer',
                      isActive ? 'bg-accent text-foreground' : 'hover:bg-muted text-foreground'
                    )}
                    onClick={() => handleSwitchSession(s.key)}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block">{label}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {s.updatedAt && (
                          <span className="text-[10px] text-muted-foreground">{s.updatedAt}</span>
                        )}
                        {s.msgCount > 0 && (
                          <span className="text-[10px] text-muted-foreground">{s.msgCount} 条</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.key) }}
                      className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-all flex-shrink-0"
                    >
                      <Trash2 size={12} className="text-muted-foreground hover:text-red-500" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSidebar(!showSidebar)} className="p-1 rounded hover:bg-muted transition-colors">
              {showSidebar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
            <span className="text-base">🤖</span>
            <span className="text-sm font-medium">Emma</span>
            {activeSessionId && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">{activeSessionId}</span>}
          </div>
          {activeSessionId && (
            <button onClick={handleClearHistory} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <Trash2 size={12} />
              清空历史
            </button>
          )}
        </div>

        {!activeSessionId ? (
          /* Empty state — no session selected */
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <span className="text-4xl mb-4">🤖</span>
            <p className="text-sm mb-1">请选择一个会话或新建会话开始对话</p>
            <button
              onClick={handleNewSession}
              disabled={emmaStatus !== 'connected'}
              className="mt-3 flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-[#1A1A1A] text-white hover:bg-[#333333] disabled:opacity-50 transition-colors"
            >
              <Plus size={14} />
              新建会话
            </button>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {activeSession.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

              {/* Live thinking indicator */}
              {activeSession.isProcessing && activeSession.currentThinking && (
                <ThinkingIndicator content={activeSession.currentThinking} />
              )}

              {/* Processing spinner — visible until assistant message has text content */}
              {activeSession.isProcessing && !activeSession.currentThinking && (
                (() => {
                  const aid = pendingAssistantIds.current[activeSessionId]
                  const pending = aid ? activeSession.messages.find((m) => m.id === aid) : null
                  // Hide spinner once assistant message has text content or tools
                  if (pending?.content) return null
                  if (pending?.tools && pending.tools.length > 0) return null
                  return (
                    <div className="flex justify-start">
                      <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-card border border-border shadow-sm flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">思考中...</span>
                      </div>
                    </div>
                  )
                })()
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="p-4 border-t border-border">
              {emmaStatus !== 'connected' && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <AlertCircle size={14} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                  <span className="text-xs text-yellow-700 dark:text-yellow-300">
                    未连接到 Emma，请确保 nanobot 已启动
                  </span>
                  <button onClick={handleReconnect} className="text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline flex-shrink-0">
                    重试
                  </button>
                </div>
              )}
              <div className="relative rounded-2xl border border-border overflow-hidden shadow-sm bg-card">
                <div className="p-3">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value.slice(0, maxLength))}
                    onKeyDown={handleKeyDown}
                    disabled={activeSession.isProcessing || emmaStatus !== 'connected'}
                    placeholder={emmaStatus === 'connected' ? '+ 有问题，尽管问' : '等待连接 Emma...'}
                    className="w-full bg-transparent resize-none outline-none text-sm text-foreground placeholder:text-muted-foreground min-h-[60px] max-h-[150px] disabled:opacity-50"
                    rows={2}
                  />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">Cmd + Enter 发送</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{input.length}/{maxLength}</span>
                      {activeSession.isProcessing ? (
                        <button
                          onClick={handleStop}
                          className="w-7 h-7 rounded-lg bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                          title="终止对话"
                        >
                          <span className="w-3 h-3 bg-white rounded-sm" />
                        </button>
                      ) : (
                        <button
                          onClick={handleSend}
                          disabled={!input.trim() || emmaStatus !== 'connected'}
                          className="w-7 h-7 rounded-lg bg-[#555555] disabled:bg-[#C4C4C4] flex items-center justify-center transition-colors hover:bg-[#444444]"
                        >
                          <Send size={13} className="text-white" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Sub Components ─────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="text-[10px] text-muted-foreground bg-muted px-3 py-1 rounded-full">{message.content}</span>
      </div>
    )
  }

  // Build ordered segments: tool hints, tool calls (with results), and text segments
  // Each segment has a ts for ordering
  type Segment =
    | { kind: 'hint'; data: ToolActivity; ts: number }
    | { kind: 'tool'; call: ToolActivity; result?: ToolActivity; isRunning: boolean; ts: number }
    | { kind: 'text'; text: string; ts: number }

  const segments: Segment[] = []
  const tools = message.tools || []
  const toolResults = tools.filter((a) => a.type === 'result')

  for (const t of tools) {
    if (t.type === 'hint') {
      segments.push({ kind: 'hint', data: t, ts: t.ts })
    } else if (t.type === 'call') {
      const result = toolResults.find((r) => r.callId === t.callId)
      const isRunning = !!message.isStreaming && !result
      segments.push({ kind: 'tool', call: t, result, isRunning, ts: t.ts })
    }
  }

  // Add text segments
  const contentSegs = message.contentSegments || []
  for (const seg of contentSegs) {
    if (seg.text) {
      segments.push({ kind: 'text', text: seg.text, ts: seg.ts })
    }
  }

  // Fallback: if no contentSegments but has content, render as single block
  if (contentSegs.length === 0 && message.content) {
    segments.push({ kind: 'text', text: message.content, ts: message.timestamp })
  }

  // Sort by timestamp to maintain arrival order
  segments.sort((a, b) => a.ts - b.ts)

  const toolCalls = tools.filter((a) => a.type === 'call')
  const lastVisibleActivityTs = segments.reduce((latest, seg) => Math.max(latest, seg.ts), message.timestamp)
  const shouldShowBreathingDot = !isUser
    && !isSystem
    && !!message.isStreaming
    && segments.length > 0
    && now - lastVisibleActivityTs > 1000

  useEffect(() => {
    if (!message.isStreaming || isUser || isSystem) return

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 250)

    return () => window.clearInterval(timer)
  }, [message.isStreaming, isSystem, isUser])

  useEffect(() => {
    setNow(Date.now())
  }, [message.content, message.tools, message.contentSegments])

  return (
    <div className={cn('flex group', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] relative', isUser ? 'items-end' : 'items-start')}>
        <div className={cn(
          'absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1',
          isUser ? '-left-16' : '-right-16'
        )}>
          <button onClick={handleCopy} className="p-1 rounded hover:bg-muted">
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-muted-foreground" />}
          </button>
        </div>

        {/* Render segments in arrival order */}
        {segments.map((seg, i) => {
          if (seg.kind === 'hint') {
            return (
              <div key={`hint-${i}`} className="mb-1.5 flex items-center gap-1.5 px-3 py-1">
                <Wrench size={10} className="text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">{seg.data.content}</span>
              </div>
            )
          }
          if (seg.kind === 'tool') {
            return <ToolCallCard key={seg.call.callId || i} call={seg.call} result={seg.result} isRunning={seg.isRunning} />
          }
          // kind === 'text'
          return (
            <div key={`text-${i}`} className={cn(
              'px-3.5 py-2.5 rounded-2xl text-sm mb-1.5',
              isUser
                ? 'bg-[#555555] text-white rounded-br-sm'
                : 'bg-card border border-border text-foreground rounded-bl-sm shadow-sm'
            )}>
              {isUser ? (
                <p className="whitespace-pre-wrap">{seg.text}</p>
              ) : (
                <div className="prose prose-sm max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
                </div>
              )}
            </div>
          )
        })}

        {shouldShowBreathingDot && (
          <div className="mb-1.5 flex justify-end pr-1">
            <span className="streaming-breathing-dot" aria-label="服务仍在继续" />
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-2 mt-1 px-1">
          <p className="text-[10px] text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {toolCalls.length > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Wrench size={9} /> {toolCalls.length} tools
            </span>
          )}
          {message.usage && (
            <span className="text-[10px] text-muted-foreground">
              {message.usage.total_tokens} tokens
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolCallCard({ call, result, isRunning }: { call: ToolActivity; result?: ToolActivity; isRunning?: boolean }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-1.5">
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        >
          {isRunning ? (
            <Loader2 size={12} className="animate-spin text-yellow-500 flex-shrink-0" />
          ) : result?.isError ? (
            <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
          ) : result ? (
            <Check size={12} className="text-green-500 flex-shrink-0" />
          ) : (
            <Wrench size={12} className="text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-xs font-mono text-foreground flex-1 truncate">{call.name}</span>
          <span className={cn(
            'text-[10px] flex-shrink-0',
            isRunning ? 'text-yellow-500' : result?.isError ? 'text-red-500' : result ? 'text-green-600' : 'text-muted-foreground'
          )}>
            {isRunning ? '执行中' : result?.isError ? '失败' : result ? '完成' : ''}
          </span>
          {expanded ? <ChevronUp size={12} className="text-muted-foreground flex-shrink-0" /> : <ChevronDown size={12} className="text-muted-foreground flex-shrink-0" />}
        </button>

        {expanded && (
          <div className="border-t border-border px-3 py-2 space-y-2">
            {call.content && call.content !== '{}' && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">参数</p>
                <pre className="text-[11px] font-mono bg-muted rounded-lg p-2 overflow-x-auto max-h-40 text-foreground/80">{call.content}</pre>
              </div>
            )}
            {result && (
              <div>
                <p className={cn('text-[10px] mb-1', result.isError ? 'text-red-500' : 'text-muted-foreground')}>
                  {result.isError ? '错误' : '结果'}
                </p>
                <pre className={cn(
                  'text-[11px] font-mono rounded-lg p-2 overflow-x-auto max-h-40',
                  result.isError ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-muted text-foreground/80'
                )}>
                  {result.content?.slice(0, 800)}{(result.content?.length ?? 0) > 800 ? '...' : ''}
                </pre>
              </div>
            )}
            {isRunning && !result && (
              <div className="flex items-center gap-1.5 py-0.5">
                <Loader2 size={10} className="animate-spin text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">等待返回...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingIndicator({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex justify-start">
      <button
        onClick={() => setExpanded(!expanded)}
        className="max-w-[80%] bg-card border border-border rounded-2xl rounded-bl-sm shadow-sm px-3.5 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain size={12} className="text-purple-500 animate-pulse" />
          <span className="text-xs text-muted-foreground">思考中...</span>
        </div>
        {expanded && (
          <p className="text-xs text-muted-foreground mt-1.5 whitespace-pre-wrap max-h-32 overflow-y-auto">{content}</p>
        )}
      </button>
    </div>
  )
}
