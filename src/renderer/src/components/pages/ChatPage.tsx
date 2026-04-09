import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Send, Plus, ChevronLeft, ChevronRight, Copy, Check, Trash2,
  Loader2, Wrench, Brain, AlertCircle, RefreshCw, ChevronDown, ChevronUp,
  Paperclip, File, FileText, FileCode2, Archive, Image, Music4, Video
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'
import { useAppRuntimeStatus } from '@/hooks/useAppRuntimeStatus'
import { useAppRuntimeStatus } from '@/hooks/useAppRuntimeStatus'

// ─── Types ──────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant' | 'system'
type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

interface ToolActivity {
  type: 'hint' | 'call' | 'result'
  name?: string
  content: string
  callId?: string
  isError?: boolean
  ts: number
}

type AttachmentItem = LocalAttachmentItem

interface Message {
  id: string
  role: MessageRole
  content: string // kept for compatibility, accumulated text
  timestamp: number
  isStreaming?: boolean
  thinking?: string
  tools?: ToolActivity[]
  toolsUsed?: string[]
  attachments?: AttachmentItem[]
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

const ATTACHMENT_BLOCK_START = '[HARNESSCLAW_LOCAL_ATTACHMENTS]'
const ATTACHMENT_BLOCK_END = '[/HARNESSCLAW_LOCAL_ATTACHMENTS]'

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function buildMessagePayload(content: string, attachments: AttachmentItem[]): string {
  const text = content.trim()
  if (attachments.length === 0) return text

  const attachmentPayload = JSON.stringify({
    version: 1,
    items: attachments.map(({ name, path, url, size, extension, kind }) => ({
      name,
      path,
      url,
      size,
      extension,
      kind,
    })),
  }, null, 2)

  const instructions = [
    'Attached local files are listed below.',
    'Use the local path or file URL with filesystem tools when you need to inspect file contents.',
  ].join('\n')

  return [
    text,
    instructions,
    ATTACHMENT_BLOCK_START,
    attachmentPayload,
    ATTACHMENT_BLOCK_END,
  ].filter(Boolean).join('\n\n')
}

function extractAttachments(content: string): { content: string; attachments: AttachmentItem[] } {
  const startIndex = content.indexOf(ATTACHMENT_BLOCK_START)
  const endIndex = content.indexOf(ATTACHMENT_BLOCK_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { content, attachments: [] }
  }

  const jsonStart = startIndex + ATTACHMENT_BLOCK_START.length
  const jsonText = content.slice(jsonStart, endIndex).trim()
  const body = content.slice(0, startIndex).trim()

  try {
    const parsed = JSON.parse(jsonText) as { items?: Array<Omit<AttachmentItem, 'id'>> }
    const attachments = Array.isArray(parsed.items)
      ? parsed.items.map((item) => ({
          ...item,
          id: item.path || item.url || `${item.name}-${item.size}`,
        }))
      : []
    return { content: body, attachments }
  } catch {
    return { content, attachments: [] }
  }
}

function getAttachmentIcon(kind: AttachmentItem['kind']) {
  switch (kind) {
    case 'image':
      return Image
    case 'video':
      return Video
    case 'audio':
      return Music4
    case 'archive':
      return Archive
    case 'code':
      return FileCode2
    case 'document':
    case 'data':
      return FileText
    default:
      return File
  }
}

// ─── Chat Page ──────────────────────────────────────────────────────────────

export function ChatPage() {
  const location = useLocation()
  const initialMessage = location.state?.initialMessage || ''
  const initialAttachments = (location.state?.initialAttachments || []) as AttachmentItem[]
  const [sessionMap, setSessionMap] = useState<Record<string, SessionState>>({})
  const [activeSessionId, setActiveSessionId] = useState('')
  const [input, setInput] = useState(initialMessage)
  const [attachments, setAttachments] = useState<AttachmentItem[]>(initialAttachments)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [harnessclawStatus, setHarnessclawStatus] = useState<HarnessclawStatus>('disconnected')
  const [clientId, setClientId] = useState('')
  const runtimeStatus = useAppRuntimeStatus()
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pendingInitialTurn = useRef<{ content: string; attachments: AttachmentItem[] } | null>(
    initialMessage || initialAttachments.length > 0
      ? { content: initialMessage, attachments: initialAttachments }
      : null
  )
  // Track pendingAssistantId per session in a ref map
  const pendingAssistantIds = useRef<Record<string, string | null>>({})
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const maxLength = 4000

  const [dbSessions, setDbSessions] = useState<{ session_id: string; title: string; updated_at: number }[]>([])
  const canSend = harnessclawStatus === 'connected' && runtimeStatus.llmConfigured && !runtimeStatus.applyingConfig

  useEffect(() => {
    void window.appRuntime.trackUsage({
      category: 'navigation',
      action: 'open_chat_page',
      status: 'ok',
    })
  }, [])

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

  const sendInitialMessage = useCallback((sid: string, text: string, initialFiles: AttachmentItem[] = []) => {
    pendingInitialTurn.current = null
    const trimmedText = text.trim()
    const payload = buildMessagePayload(trimmedText, initialFiles)
    setInput('')
    setAttachments([])
    setActiveSessionId(sid)
    updateSession(sid, (prev) => ({
      ...prev,
      isProcessing: true,
      currentThinking: '',
      messages: [...prev.messages, {
        id: `usr-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        attachments: initialFiles,
        timestamp: Date.now(),
      }],
    }))
    window.harnessclaw.send(payload, sid)
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

  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => {
      event.preventDefault()
    }

    window.addEventListener('dragover', preventWindowDrop)
    window.addEventListener('drop', preventWindowDrop)

    return () => {
      window.removeEventListener('dragover', preventWindowDrop)
      window.removeEventListener('drop', preventWindowDrop)
    }
  }, [])

  // Helper: convert DB rows to Message[]
  const dbRowsToMessages = useCallback((rows: DbMessageRow[]): Message[] => {
    return rows.map((r) => {
      const parsed = extractAttachments(r.content)
      const contentSegments = r.content_segments
        ? JSON.parse(r.content_segments) as Array<{ text: string; ts: number }>
        : (parsed.content ? [{ text: parsed.content, ts: r.created_at }] : [])

      return {
        id: r.id,
        role: r.role as MessageRole,
        content: parsed.content,
        timestamp: r.created_at,
        thinking: r.thinking || undefined,
        toolsUsed: r.tools_used ? JSON.parse(r.tools_used) : undefined,
        attachments: parsed.attachments,
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

  // Sync Harnessclaw status on mount
  useEffect(() => {
    const offStatus = window.harnessclaw.onStatus((s) => {
      setHarnessclawStatus(s as HarnessclawStatus)
    })

    const offEvent = window.harnessclaw.onEvent((event) => {
      handleHarnessclawEvent(event)
    })

    window.harnessclaw.getStatus().then((s) => {
      setHarnessclawStatus(s.status as HarnessclawStatus)
      if (s.clientId) setClientId(s.clientId)
      // Don't auto-set activeSessionId — user should pick or create a session
      if (s.status === 'connected' && pendingInitialTurn.current && s.sessionId) {
        sendInitialMessage(s.sessionId, pendingInitialTurn.current.content, pendingInitialTurn.current.attachments)
      }
    })

    // Request session list
    window.harnessclaw.listSessions()

    return () => {
      offStatus()
      offEvent()
    }
  }, [])

  // Handle Harnessclaw events — route by session_id
  const handleHarnessclawEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string
    const eventSessionId = event.session_id as string | undefined
    console.log('[ChatPage] event:', type, 'session_id:', eventSessionId, 'activeRef:', activeSessionIdRef.current)

    switch (type) {
      case 'connected': {
        const cid = event.client_id as string
        setClientId(cid)
        setHarnessclawStatus('connected')
        // Don't auto-set activeSessionId — user creates/selects sessions manually
        window.harnessclaw.listSessions()
        // Auto-send pending initial message if exists (from route state)
        if (pendingInitialTurn.current) {
          const sid = event.session_id as string
          sendInitialMessage(sid, pendingInitialTurn.current.content, pendingInitialTurn.current.attachments)
        }
        break
      }

      case 'subscribed': {
        // When server confirms subscription, migrate temp session id to real one
        const sid = eventSessionId!
        const currentActive = activeSessionIdRef.current
        if (currentActive && currentActive.startsWith('harnessclaw:new-') && sid !== currentActive) {
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

      case 'response': {
        const sid = eventSessionId!
        let aid = pendingAssistantIds.current[sid]
        const content = (event.content as string) || ''
        const now = Date.now()

        pendingAssistantIds.current[sid] = null

        updateSession(sid, (prev) => {
          if (!aid) {
            aid = `ast-${now}`
            return {
              ...prev,
              isProcessing: false,
              currentThinking: '',
              messages: [...prev.messages, {
                id: aid,
                role: 'assistant' as MessageRole,
                content,
                timestamp: now,
                isStreaming: false,
                tools: [],
                contentSegments: content ? [{ text: content, ts: now }] : [],
                toolsUsed: event.tools_used as string[] | undefined,
                usage: event.usage as Message['usage'],
              }],
            }
          }

          return {
            ...prev,
            isProcessing: false,
            currentThinking: '',
            messages: prev.messages.map((m) =>
              m.id === aid
                ? {
                    ...m,
                    content: content || m.content,
                    contentSegments: content ? [{ text: content, ts: now }] : (m.contentSegments || []),
                    isStreaming: false,
                    toolsUsed: event.tools_used as string[] | undefined,
                    usage: event.usage as Message['usage'],
                  }
                : m
            ),
          }
        })
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
        console.log('[Harnessclaw event]', type, JSON.stringify(event))
    }
  }, [sendInitialMessage, updateSession])

  const handleSend = () => {
    console.log('[ChatPage] handleSend activeSessionId:', activeSessionId, 'input:', input.slice(0, 20))
    const trimmedInput = input.trim()
    if ((trimmedInput.length === 0 && attachments.length === 0) || activeSession.isProcessing || !canSend || !activeSessionId) return

    const payload = buildMessagePayload(trimmedInput, attachments)
    const displayContent = trimmedInput || ''
    const attachedFiles = [...attachments]

    updateSession(activeSessionId, (prev) => ({
      ...prev,
      isProcessing: true,
      currentThinking: '',
      messages: [...prev.messages, {
        id: `usr-${Date.now()}`,
        role: 'user',
        content: displayContent,
        attachments: attachedFiles,
        timestamp: Date.now(),
      }],
    }))
    void window.appRuntime.trackUsage({
      category: 'chat',
      action: 'send_message',
      status: 'ok',
      sessionId: activeSessionId,
      details: { contentLength: trimmedInput.length, attachmentCount: attachedFiles.length },
    })
    window.harnessclaw.send(payload, activeSessionId)
    setInput('')
    setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend()
    }
  }

  // New session: send /new command to create a fresh session via the default session
  const handleNewSession = () => {
    if (harnessclawStatus !== 'connected') return
    // Generate a unique session id
    const newId = `harnessclaw:new-${Date.now().toString(36)}`
    console.log('[ChatPage] handleNewSession newId:', newId)
    // Subscribe + send /new to that session — server creates it
    window.harnessclaw.command('/new', newId)
    // Init local state and switch
    setSessionMap((prev) => ({
      ...prev,
      [newId]: { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '' },
    }))
    setActiveSessionId(newId)
    void window.appRuntime.trackUsage({
      category: 'chat',
      action: 'new_session',
      status: 'ok',
      sessionId: newId,
    })
    // Refresh session list
    setTimeout(() => window.harnessclaw.listSessions(), 500)
  }

  const handleSwitchSession = (key: string) => {
    if (key === activeSessionId) return
    void window.appRuntime.trackUsage({
      category: 'chat',
      action: 'switch_session',
      status: 'ok',
      sessionId: key,
    })
    window.harnessclaw.subscribe(key)
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
    void window.appRuntime.trackUsage({
      category: 'chat',
      action: 'reconnect',
      status: 'started',
    })
    window.harnessclaw.disconnect().then(() => {
      setTimeout(() => window.harnessclaw.connect(), 300)
    })
  }

  const handleDeleteSession = (sid: string) => {
    void window.appRuntime.trackUsage({
      category: 'chat',
      action: 'delete_session',
      status: 'ok',
      sessionId: sid,
    })
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
    void window.appRuntime.trackUsage({
      category: 'chat',
      action: 'stop_generation',
      status: 'ok',
      sessionId: activeSessionId,
    })
    window.harnessclaw.stop(activeSessionId)
  }

  const handleClearHistory = () => {
    if (activeSessionId) {
      void window.appRuntime.trackUsage({
        category: 'chat',
        action: 'clear_history',
        status: 'ok',
        sessionId: activeSessionId,
      })
      window.db.deleteSession(activeSessionId)
    }
    updateSession(activeSessionId, (prev) => ({
      ...prev,
      messages: [],
      currentThinking: '',
    }))
  }

  const appendAttachments = useCallback((items: AttachmentItem[]) => {
    if (!items.length) return

    setAttachments((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]))
      for (const item of items) {
        byId.set(item.path, { ...item, id: item.path })
      }
      return [...byId.values()]
    })
  }, [])

  const handlePickFiles = async () => {
    if (activeSession.isProcessing || harnessclawStatus !== 'connected') return

    const picked = await window.files.pick()
    if (!picked.length) return

    appendAttachments(picked.map((item) => ({ ...item, id: item.path })))
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (activeSession.isProcessing || harnessclawStatus !== 'connected') return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (activeSession.isProcessing || harnessclawStatus !== 'connected') return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const droppedPaths = Array.from(e.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path || '')
      .filter(Boolean)

    if (!droppedPaths.length) return
    const resolved = await window.files.resolve(droppedPaths)
    appendAttachments(resolved.map((item) => ({ ...item, id: item.path })))
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left: Session sidebar */}
      {showSidebar && (
        <div className="w-60 flex-shrink-0 border-r border-border bg-card flex flex-col">
          <div className="p-3 border-b border-border">
            <button
              onClick={handleNewSession}
              disabled={harnessclawStatus !== 'connected'}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSidebar(!showSidebar)} className="p-1 rounded hover:bg-muted transition-colors">
              {showSidebar ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
            <span className="text-base">🤖</span>
            <span className="text-sm font-medium">Harnessclaw</span>
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
              disabled={harnessclawStatus !== 'connected'}
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
              {harnessclawStatus !== 'connected' && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <AlertCircle size={14} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                  <span className="text-xs text-yellow-700 dark:text-yellow-300">
                    未连接到 Harnessclaw，请确保 nanobot 已启动
                  </span>
                  <button onClick={handleReconnect} className="text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline flex-shrink-0">
                    重试
                  </button>
                </div>
              )}
              {harnessclawStatus === 'connected' && !runtimeStatus.llmConfigured && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                  <AlertCircle size={14} className="text-blue-600 flex-shrink-0" />
                  <span className="text-xs text-blue-700">
                    本地服务已就绪，但还需要在设置中填写 API Key、API Base 和默认模型。保存后会自动生效，无需重启应用。
                  </span>
                </div>
              )}
              {runtimeStatus.applyingConfig && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                  <Loader2 size={14} className="text-blue-600 animate-spin flex-shrink-0" />
                  <span className="text-xs text-blue-700">
                    正在应用最新模型配置，完成后可直接继续聊天。
                  </span>
                </div>
              )}
              <div
                className={cn(
                  'relative overflow-hidden rounded-2xl border shadow-sm bg-card',
                  isDragOver ? 'border-primary shadow-[0_0_0_3px_rgba(37,99,235,0.16)]' : 'border-border'
                )}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isDragOver && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 text-sm text-primary">
                    松开即可添加文件
                  </div>
                )}
                <div className="p-3">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value.slice(0, maxLength))}
                    onKeyDown={handleKeyDown}
                    disabled={activeSession.isProcessing || !canSend}
                    placeholder={
                      harnessclawStatus !== 'connected'
                        ? '等待连接 Harnessclaw...'
                        : runtimeStatus.applyingConfig
                          ? '正在应用配置...'
                          : runtimeStatus.llmConfigured
                            ? '+ 有问题，尽管问'
                            : '请先在设置中完成 API Key、API Base 和默认模型配置'
                    }
                    className="w-full bg-transparent resize-none outline-none text-sm text-foreground placeholder:text-muted-foreground min-h-[60px] max-h-[150px] disabled:opacity-50"
                    rows={2}
                  />
                  <AttachmentPreviewPanel
                    attachments={attachments}
                    onRemove={handleRemoveAttachment}
                    removable={!activeSession.isProcessing}
                  />

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={handlePickFiles}
                      disabled={activeSession.isProcessing || harnessclawStatus !== 'connected'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      title="选择本地文件"
                    >
                      <Paperclip size={12} />
                      <span>添加文件</span>
                    </button>
                    <span className="text-xs text-muted-foreground">也可直接拖拽文件到输入框</span>
                  </div>
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
                          disabled={(!input.trim() && attachments.length === 0) || !canSend}
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
  const attachments = message.attachments || []
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

        {attachments.length > 0 && (
          <div className={cn('mb-1.5 flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
            {attachments.map((attachment) => (
              <AttachmentCard key={attachment.id} attachment={attachment} isUser={isUser} />
            ))}
          </div>
        )}

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

function AttachmentCard({ attachment, isUser }: { attachment: AttachmentItem; isUser: boolean }) {
  const Icon = getAttachmentIcon(attachment.kind)

  return (
    <div
      className={cn(
        'min-w-[260px] max-w-[420px] rounded-2xl border px-3.5 py-2.5 text-sm shadow-sm',
        isUser
          ? 'border-[#666666] bg-[#4A4A4A] text-white'
          : 'border-border bg-card text-foreground'
      )}
    >
      <div className="flex items-start gap-2">
        <Icon size={16} className={cn('mt-0.5 flex-shrink-0', isUser ? 'text-white/80' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{attachment.name}</div>
          <div className={cn('mt-1 text-[11px]', isUser ? 'text-white/70' : 'text-muted-foreground')}>
            {attachment.kind} · {attachment.extension || 'unknown'} · {formatBytes(attachment.size)}
          </div>
          <div className={cn('mt-1 truncate font-mono text-[10px]', isUser ? 'text-white/65' : 'text-muted-foreground')}>
            {attachment.path}
          </div>
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
