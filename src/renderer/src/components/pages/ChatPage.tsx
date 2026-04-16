import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Send, Plus, Copy, Check, Trash2,
  Loader2, Wrench, Brain, AlertCircle, RefreshCw, ChevronDown, ChevronUp,
  FileText, X, ArrowDown
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'

// ─── Types ──────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant' | 'system'
type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

interface SubagentInfo {
  taskId: string
  label: string
  status: 'ok' | 'error' | string
}

interface ContentSegment {
  text: string
  ts: number
  subagent?: SubagentInfo
}

interface ToolActivity {
  type: 'hint' | 'call' | 'result' | 'status' | 'permission' | 'permission_result'
  name?: string
  content: string
  callId?: string
  isError?: boolean
  ts: number
  subagent?: SubagentInfo
}

interface Message {
  id: string
  role: MessageRole
  content: string // kept for compatibility, accumulated text
  timestamp: number
  systemNotice?: SystemNoticeData
  isStreaming?: boolean
  thinking?: string
  tools?: ToolActivity[]
  toolsUsed?: string[]
  attachments?: AttachmentItem[]
  contentSegments?: ContentSegment[] // text segments with timestamps for interleaving
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

interface SessionItem {
  key: string
  updatedAt?: string
}

interface FilePreviewData {
  path: string
  fileName: string
  operation: 'read_file' | 'write_file'
  content: string
  limit?: number
}

interface PermissionRequestData {
  toolInput: string
  message: string
  isReadOnly: boolean
  command?: string
  description?: string
  options: Array<{ label: string; scope: 'once' | 'session'; allow: boolean }>
}

interface PermissionResultData {
  approved: boolean
  scope: 'once' | 'session'
  message: string
}

interface SystemNoticeData {
  kind: 'error'
  title: string
  message: string
  reason?: string
  sessionId?: string
  hint?: string
}

type AttachmentItem = LocalAttachmentItem

// Per-session state
interface SessionState {
  messages: Message[]
  pendingAssistantId: string | null
  isProcessing: boolean
  currentThinking: string
  isPaused: boolean
  isStopping: boolean
  pauseReason?: string
}

const ATTACHMENT_BLOCK_START = '[HARNESSCLAW_LOCAL_ATTACHMENTS]'
const ATTACHMENT_BLOCK_END = '[/HARNESSCLAW_LOCAL_ATTACHMENTS]'

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

function normalizeSubagent(raw: unknown): SubagentInfo | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const candidate = raw as Record<string, unknown>
  const taskId = typeof candidate.task_id === 'string' ? candidate.task_id : typeof candidate.taskId === 'string' ? candidate.taskId : ''
  const label = typeof candidate.label === 'string' ? candidate.label : ''
  const status = typeof candidate.status === 'string' ? candidate.status : ''
  if (!taskId || !label) return undefined
  return { taskId, label, status: status || 'ok' }
}

function isSameSubagent(left?: SubagentInfo, right?: SubagentInfo): boolean {
  return left?.taskId === right?.taskId
}

function getModuleKey(subagent?: SubagentInfo): string {
  return subagent?.taskId || '__main__'
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildErrorHint(reason: string, message: string): string | undefined {
  if (reason === 'model_error' && message.toLowerCase().includes('not supported')) {
    return '请切换到当前账号可用的模型，或检查 Codex 使用的账号类型。'
  }
  if (message.toLowerCase().includes('websocket')) {
    return '请检查本地服务是否已启动，以及连接配置是否正确。'
  }
  return undefined
}

function buildSystemErrorNotice(raw: unknown): SystemNoticeData {
  const root = typeof raw === 'string'
    ? (parseJsonObject(raw) || raw)
    : raw
  const payload = isRecord(root) && isRecord(root.payload) ? root.payload : root
  const record = isRecord(payload) ? payload : {}
  const fallbackContent = isRecord(root) && typeof root.content === 'string' ? root.content : ''
  const message = typeof record.message === 'string'
    ? record.message
    : fallbackContent || (typeof root === 'string' ? root : '请求失败，请稍后重试。')
  const reason = typeof record.reason === 'string'
    ? record.reason
    : isRecord(root) && typeof root.reason === 'string'
      ? root.reason
      : undefined
  const sessionId = typeof record.session_id === 'string'
    ? record.session_id
    : isRecord(root) && typeof root.session_id === 'string'
      ? root.session_id
      : undefined

  return {
    kind: 'error',
    title: '请求失败',
    message: message.trim() || '请求失败，请稍后重试。',
    reason,
    sessionId,
    hint: buildErrorHint(reason || '', message),
  }
}

function getHarnessclawEventSessionId(event: Record<string, unknown>): string {
  if (typeof event.session_id === 'string' && event.session_id) {
    return event.session_id
  }

  if (isRecord(event.payload) && typeof event.payload.session_id === 'string' && event.payload.session_id) {
    return event.payload.session_id
  }

  if (isRecord(event.error) && typeof event.error.session_id === 'string' && event.error.session_id) {
    return event.error.session_id
  }

  return ''
}

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function extractFilePreviewData(call: ToolActivity, result?: ToolActivity): FilePreviewData | null {
  if (call.type !== 'call') return null
  if (call.name !== 'read_file' && call.name !== 'write_file') return null

  const args = parseJsonObject(call.content)
  const path = typeof args?.path === 'string' ? args.path : ''
  if (!path) return null

  const directContent = typeof args?.content === 'string' ? args.content : ''
  const limit = typeof args?.limit === 'number' ? args.limit : undefined
  const content = call.name === 'write_file'
    ? (directContent || result?.content || '')
    : (result?.content || '')

  return {
    path,
    fileName: getFileName(path),
    operation: call.name,
    content,
    limit,
  }
}

function parsePermissionRequestData(raw: string): PermissionRequestData | null {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  const toolInput = typeof parsed.tool_input === 'string' ? parsed.tool_input : ''
  const parsedToolInput = toolInput ? parseJsonObject(toolInput) : null
  return {
    toolInput,
    message: typeof parsed.message === 'string' ? parsed.message : '',
    isReadOnly: parsed.is_read_only === true,
    command: typeof parsedToolInput?.command === 'string' ? parsedToolInput.command : undefined,
    description: typeof parsedToolInput?.description === 'string' ? parsedToolInput.description : undefined,
    options: Array.isArray(parsed.options)
      ? parsed.options.flatMap((option) => {
          if (!option || typeof option !== 'object' || Array.isArray(option)) return []
          const candidate = option as { label?: unknown; scope?: unknown; allow?: unknown }
          const label = typeof candidate.label === 'string' ? candidate.label : ''
          const scope = candidate.scope === 'session' ? 'session' : 'once'
          const allow = candidate.allow === true
          return label ? [{ label, scope, allow }] : []
        })
      : [],
  }
}

function parsePermissionResultData(raw: string): PermissionResultData | null {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  return {
    approved: parsed.approved === true,
    scope: parsed.scope === 'session' ? 'session' : 'once',
    message: typeof parsed.message === 'string' ? parsed.message : '',
  }
}

function getConversationLabel(title = '', firstMessage = ''): string {
  const raw = title.trim() || firstMessage.trim() || '新对话'
  return raw.length > 24 ? `${raw.slice(0, 24)}...` : raw
}

function getToolDisplayName(name?: string): string {
  const toolLabels: Record<string, string> = {
    read_file: '读取文件',
    write_file: '写入文件',
    search_query: '在线搜索',
    open: '打开页面',
    click: '点击页面元素',
    find: '查找页面内容',
    screenshot: '查看 PDF 页面',
    image_query: '查找图片',
    weather: '查询天气',
    sports: '查询赛事',
    finance: '查询价格',
    time: '查询时间',
  }

  if (!name) return '工具操作'
  return toolLabels[name] || name.replace(/_/g, ' ')
}

function getPermissionOptionLabel(label: string): string {
  const normalized = label.trim().toLowerCase()
  if (normalized === 'allow once') return '允许这一次'
  if (normalized === 'always allow in this session') return '本次会话都允许'
  if (normalized === 'deny') return '拒绝'
  return label
}

// ─── Chat Page ──────────────────────────────────────────────────────────────

export function ChatPage() {
  const location = useLocation()
  const initialMessage = location.state?.initialMessage || ''
  const initialAttachments = (location.state?.initialAttachments || []) as AttachmentItem[]
  const selectedSessionIdFromRoute = typeof location.state?.sessionId === 'string' ? location.state.sessionId : ''
  const createSessionOnOpen = location.state?.createSession === true
  const [sessionMap, setSessionMap] = useState<Record<string, SessionState>>({})
  const [activeSessionId, setActiveSessionId] = useState('')
  const [filePreview, setFilePreview] = useState<FilePreviewData | null>(null)
  const [input, setInput] = useState(initialMessage)
  const [attachments, setAttachments] = useState<AttachmentItem[]>(initialAttachments)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [harnessclawStatus, setHarnessclawStatus] = useState<HarnessclawStatus>('disconnected')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const messagesViewportRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isNearBottomRef = useRef(true)
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

  // Get or create session state
  const getSession = useCallback((sid: string): SessionState => {
    return sessionMap[sid] || { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '', isPaused: false, isStopping: false }
  }, [sessionMap])

  // Update a specific session's state
  const updateSession = useCallback((sid: string, updater: (prev: SessionState) => SessionState) => {
    setSessionMap((prev) => ({
      ...prev,
      [sid]: updater(prev[sid] || { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '', isPaused: false, isStopping: false }),
    }))
  }, [])

  const ensureLocalSession = useCallback((sid?: string) => {
    const resolvedSessionId = sid || `harnessclaw:new-${Date.now().toString(36)}`
    setSessionMap((prev) => ({
      ...prev,
      [resolvedSessionId]: prev[resolvedSessionId] || {
        messages: [],
        pendingAssistantId: null,
        isProcessing: false,
        currentThinking: '',
        isPaused: false,
        isStopping: false,
      },
    }))
    setActiveSessionId(resolvedSessionId)
    return resolvedSessionId
  }, [])

  const sendInitialMessage = useCallback((sid: string, text: string, initialFiles: AttachmentItem[] = []) => {
    pendingInitialTurn.current = null
    const trimmedText = text.trim()
    const payload = buildMessagePayload(trimmedText, initialFiles)
    setInput('')
    setAttachments([])
    ensureLocalSession(sid)
    updateSession(sid, (prev) => ({
      ...prev,
      isProcessing: true,
      currentThinking: '',
      isPaused: false,
      isStopping: false,
      pauseReason: undefined,
      messages: [...prev.messages, {
        id: `usr-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        attachments: initialFiles,
        timestamp: Date.now(),
      }],
    }))
    void window.harnessclaw.send(payload, sid)
  }, [ensureLocalSession, updateSession])

  const respondPermission = useCallback(async (requestId: string, approved: boolean, scope: 'once' | 'session') => {
    if (!requestId) return
    await window.harnessclaw.respondPermission(
      requestId,
      approved,
      scope,
      approved ? undefined : 'User denied permission request'
    )
  }, [])

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
      return {
        key,
        updatedAt: serverInfo?.updatedAt,
        msgCount,
        firstMsg,
        title,
        label: getConversationLabel(title, firstMsg),
      }
    })
  }, [sessionMap, sessions, dbSessions])
  const activeSessionMeta = displayedSessions.find((session) => session.key === activeSessionId)
  const activeSessionPrompt = activeSessionMeta?.firstMsg || activeSessionMeta?.title || '新对话'
  const resizeComposerTextarea = useCallback(() => {
    const textarea = composerTextareaRef.current
    if (!textarea) return

    const lineHeight = 24
    const maxHeight = lineHeight * 5
    textarea.style.height = '0px'
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    resizeComposerTextarea()
  }, [input, resizeComposerTextarea])

  const composerNotice = useMemo(() => {
    if (activeSession.isStopping) {
      return {
        tone: 'danger' as const,
        title: '正在停止当前任务',
        description: '已经发出停止请求。任务结束后，你就可以继续输入新内容。',
        actionLabel: null,
      }
    }

    if (activeSession.isPaused) {
      return {
        tone: 'warning' as const,
        title: '需要你确认后继续',
        description: 'Agent 想执行一个可能影响文件或环境的操作。处理下方授权后，会自动继续。',
        actionLabel: null,
      }
    }

    if (harnessclawStatus === 'connecting') {
      return {
        tone: 'warning' as const,
        title: '正在连接 HarnessClaw',
        description: '你可以先整理问题；连接恢复后就能继续发送。',
        actionLabel: '重新连接',
      }
    }

    if (harnessclawStatus !== 'connected') {
      return {
        tone: 'warning' as const,
        title: '当前还没有连接到 HarnessClaw',
        description: '发送时会自动尝试连接。若想立即恢复，也可以手动重试。',
        actionLabel: '重新连接',
      }
    }

    return null
  }, [activeSession.isPaused, activeSession.isStopping, harnessclawStatus])

  const updateScrollState = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return

    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const threshold = Math.max(120, viewport.clientHeight * 0.382)
    const isNearBottom = distanceToBottom <= threshold

    isNearBottomRef.current = isNearBottom
    setShowJumpToBottom(!isNearBottom)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
    isNearBottomRef.current = true
    setShowJumpToBottom(false)
  }, [])

  // Scroll to bottom only when the user is already close to the bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom('smooth')
    }
  }, [activeSession.messages, activeSession.currentThinking, scrollToBottom])

  useEffect(() => {
    scrollToBottom('auto')
  }, [activeSessionId, scrollToBottom])

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
        ? (JSON.parse(r.content_segments) as Array<{ text: string; ts: number; subagent?: unknown }>).map((seg) => ({
            text: seg.text,
            ts: seg.ts,
            subagent: normalizeSubagent(seg.subagent),
          }))
        : (parsed.content ? [{ text: parsed.content, ts: r.created_at }] : [])

      return {
        id: r.id,
        role: r.role as MessageRole,
        content: parsed.content,
        systemNotice: r.system_notice_json ? JSON.parse(r.system_notice_json) as SystemNoticeData : undefined,
        attachments: parsed.attachments,
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
          subagent: t.subagent_json ? normalizeSubagent(JSON.parse(t.subagent_json)) : undefined,
        })),
        contentSegments,
      }
    })
  }, [])

  const loadPersistedSessions = useCallback(async () => {
    const rows = await window.db.listSessions()
    if (rows.length === 0) {
      setDbSessions([])
      setSessions([])
      return rows
    }

    setDbSessions(rows.map((row) => ({ session_id: row.session_id, title: row.title, updated_at: row.updated_at })))
    setSessions(rows.map((row) => ({ key: row.session_id, updatedAt: new Date(row.updated_at).toLocaleString('zh-CN') })))

    const entries: Record<string, SessionState> = {}
    for (const row of rows) {
      const msgs = await window.db.getMessages(row.session_id)
      entries[row.session_id] = {
        messages: msgs.length > 0 ? dbRowsToMessages(msgs) : [],
        pendingAssistantId: null,
        isProcessing: false,
        currentThinking: '',
        isPaused: false,
        isStopping: false,
      }
    }

    setSessionMap((prev) => {
      const next = { ...prev }
      for (const [sessionId, state] of Object.entries(entries)) {
        const existing = prev[sessionId]
        next[sessionId] = existing && existing.messages.length > 0 ? existing : state
      }
      return next
    })

    return rows
  }, [dbRowsToMessages])

  // Load persisted sessions from DB on mount
  useEffect(() => {
    void loadPersistedSessions().then((rows) => {
      if (selectedSessionIdFromRoute || createSessionOnOpen) return
      if (!activeSessionIdRef.current && rows[0]?.session_id) {
        setActiveSessionId(rows[0].session_id)
      }
    })
  }, [createSessionOnOpen, loadPersistedSessions, selectedSessionIdFromRoute])

  useEffect(() => {
    const offSessionsChanged = window.db.onSessionsChanged(() => {
      void loadPersistedSessions()
    })
    return () => offSessionsChanged()
  }, [loadPersistedSessions])

  const handleSwitchSession = useCallback((key: string) => {
    if (!key) return
    if (key !== activeSessionIdRef.current) {
      setActiveSessionId(key)
    }

    void window.db.getMessages(key).then((rows) => {
      if (rows.length > 0) {
        setSessionMap((prev) => ({
          ...prev,
          [key]: { messages: dbRowsToMessages(rows), pendingAssistantId: null, isProcessing: false, currentThinking: '', isPaused: false, isStopping: false },
        }))
        return
      }

      setSessionMap((prev) => {
        if (prev[key]) return prev
        return {
          ...prev,
          [key]: { messages: [], pendingAssistantId: null, isProcessing: false, currentThinking: '', isPaused: false, isStopping: false },
        }
      })
    })
  }, [dbRowsToMessages])

  useEffect(() => {
    if (!selectedSessionIdFromRoute) return
    handleSwitchSession(selectedSessionIdFromRoute)
  }, [handleSwitchSession, selectedSessionIdFromRoute])

  useEffect(() => {
    if (!createSessionOnOpen) return
    if (selectedSessionIdFromRoute) return
    if (pendingInitialTurn.current) return
    if (activeSessionIdRef.current) return
    ensureLocalSession()
  }, [createSessionOnOpen, selectedSessionIdFromRoute, ensureLocalSession, location.key])

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
    })

    // Request session list
    window.harnessclaw.listSessions()

    return () => {
      offStatus()
      offEvent()
    }
  }, [])

  useEffect(() => {
    if (!pendingInitialTurn.current) return
    const sid = ensureLocalSession()
    const next = pendingInitialTurn.current
    if (!next) return
    sendInitialMessage(sid, next.content, next.attachments)
  }, [ensureLocalSession, sendInitialMessage])

  // Handle Harnessclaw events — route by session_id
  const handleHarnessclawEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string
    const eventSessionId = getHarnessclawEventSessionId(event) || undefined
    const subagent = normalizeSubagent(event.subagent)

    const ensureAssistantMessage = (sid: string, now: number): string => {
      let aid = pendingAssistantIds.current[sid]
      if (aid) return aid

      aid = `ast-${now}`
      pendingAssistantIds.current[sid] = aid
      updateSession(sid, (prev) => ({
        ...prev,
        isProcessing: true,
        currentThinking: '',
        messages: [...prev.messages, {
          id: aid!,
          role: 'assistant' as MessageRole,
          content: '',
          timestamp: now,
          isStreaming: true,
          tools: [],
          contentSegments: [],
        }],
      }))
      return aid
    }

    switch (type) {
      case 'connected': {
        setHarnessclawStatus('connected')
        // Don't auto-set activeSessionId — user creates/selects sessions manually
        window.harnessclaw.listSessions()
        break
      }

      case 'subscribed': {
        break
      }

      case 'unsubscribed':
        break

      case 'turn_start': {
        const sid = eventSessionId!
        const now = Date.now()
        if (subagent) {
          const aid = ensureAssistantMessage(sid, now)
          const statusActivity: ToolActivity = {
            type: 'status',
            content: subagent.status === 'running' ? '子任务启动' : '开始总结',
            ts: now,
            subagent,
          }
          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), statusActivity] } : m),
          }))
          break
        }

        const id = `ast-${now}`
        pendingAssistantIds.current[sid] = id
        updateSession(sid, (prev) => ({
          ...prev,
          isProcessing: true,
        currentThinking: '',
        isPaused: false,
        isStopping: false,
        pauseReason: undefined,
        messages: [...prev.messages, { id, role: 'assistant', content: '', timestamp: now, isStreaming: true, tools: [], contentSegments: [] }],
      }))
      break
      }

      case 'task_start': {
        const sid = eventSessionId!
        if (!subagent) break
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'status',
          name: 'task_start',
          content: '子任务已创建',
          ts: Date.now(),
          subagent,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
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
          isPaused: false,
          isStopping: false,
          pauseReason: undefined,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, thinking: text } : m),
        }))
        break
      }

      case 'tool_hint': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'hint',
          content: event.content as string,
          ts: Date.now(),
          subagent,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          isPaused: true,
          isStopping: false,
          pauseReason: (event.content as string) || '等待权限授权',
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'tool_call': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'call',
          name: event.name as string,
          content: JSON.stringify(event.arguments, null, 2),
          callId: event.call_id as string,
          ts: Date.now(),
          subagent,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          isPaused: false,
          isStopping: false,
          pauseReason: undefined,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'tool_result': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'result',
          name: event.name as string,
          content: event.content as string,
          callId: event.call_id as string,
          isError: event.is_error as boolean,
          ts: Date.now(),
          subagent,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'permission_request': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'permission',
          name: event.name as string,
          content: JSON.stringify({
            tool_input: (event.tool_input as string) || '',
            message: (event.content as string) || '',
            is_read_only: event.is_read_only === true,
            options: Array.isArray(event.options) ? event.options : [],
          }),
          callId: event.request_id as string,
          ts: Date.now(),
          subagent,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'permission_result': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'permission_result',
          name: event.name as string,
          content: JSON.stringify({
            approved: event.approved === true,
            scope: event.scope === 'session' ? 'session' : 'once',
            message: (event.content as string) || '',
          }),
          callId: event.request_id as string,
          isError: event.approved !== true,
          ts: Date.now(),
          subagent,
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
          aid = ensureAssistantMessage(sid, now)
          updateSession(sid, (prev) => ({
            ...prev,
            isPaused: false,
            isStopping: false,
            pauseReason: undefined,
            messages: prev.messages.map((m) => m.id === aid ? {
              ...m,
              content: chunk || '',
              contentSegments: chunk ? [{ text: chunk || '', ts: now, subagent }] : [],
            } : m),
          }))
        } else if (chunk) {
          updateSession(sid, (prev) => ({
            ...prev,
            isPaused: false,
            isStopping: false,
            pauseReason: undefined,
            messages: prev.messages.map((m) => {
              if (m.id !== aid) return m
              const segments = m.contentSegments || []
              const moduleKey = getModuleKey(subagent)
              const lastSegIndex = [...segments].reverse().findIndex((seg) => getModuleKey(seg.subagent) === moduleKey)
              const resolvedLastSegIndex = lastSegIndex === -1 ? -1 : segments.length - 1 - lastSegIndex
              const lastSeg = resolvedLastSegIndex >= 0 ? segments[resolvedLastSegIndex] : undefined
              const lastRelatedToolTs = Math.max(
                0,
                ...(m.tools || [])
                  .filter((tool) => getModuleKey(tool.subagent) === moduleKey)
                  .map((tool) => tool.ts)
              )
              // If a tool in the same module was added after the last same-module text, start a new segment
              if (lastSeg && lastRelatedToolTs > lastSeg.ts) {
                return { ...m, content: m.content + chunk, contentSegments: [...segments, { text: chunk, ts: now, subagent }] }
              }
              // Otherwise append to the last text segment from the same module
              if (lastSeg && isSameSubagent(lastSeg.subagent, subagent)) {
                const updated = [...segments]
                updated[resolvedLastSegIndex] = { ...lastSeg, text: lastSeg.text + chunk, ts: lastSeg.ts }
                return { ...m, content: m.content + chunk, contentSegments: updated }
              }
              // No segments yet, create first one
              return { ...m, content: m.content + chunk, contentSegments: [...segments, { text: chunk, ts: now, subagent }] }
            }),
          }))
        }
        break
      }

      case 'response': {
        const sid = eventSessionId!
        let aid = pendingAssistantIds.current[sid]
        const content = (event.content as string) || ''
        const now = Date.now()
        if (!aid) {
          aid = ensureAssistantMessage(sid, now)
          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => m.id === aid ? {
              ...m,
              content,
              contentSegments: content ? [{ text: content, ts: now, subagent }] : [],
            } : m),
          }))
        } else {
          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => m.id === aid ? {
              ...m,
              content,
              contentSegments: content ? [{ text: content, ts: now, subagent }] : (m.contentSegments || []),
            } : m),
          }))
        }
        if (!subagent) {
          pendingAssistantIds.current[sid] = null
          updateSession(sid, (prev) => ({
            ...prev,
            isProcessing: false,
            currentThinking: '',
            isPaused: false,
            isStopping: false,
            pauseReason: undefined,
            messages: prev.messages.map((m) => m.id === aid ? {
              ...m,
              isStreaming: false,
              toolsUsed: event.tools_used as string[] | undefined,
              usage: event.usage as Message['usage'],
            } : m),
          }))
        }
        break
      }

      case 'text_done': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        if (aid && !subagent) {
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
        if (subagent && aid) {
          const statusActivity: ToolActivity = {
            type: 'status',
            content: subagent.status === 'error' ? '子任务失败' : '子任务完成',
            ts: Date.now(),
            subagent,
          }
          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), statusActivity] } : m),
          }))
          break
        }

        pendingAssistantIds.current[sid] = null
        updateSession(sid, (prev) => ({
          ...prev,
          isProcessing: false,
          currentThinking: '',
          isPaused: false,
          isStopping: false,
          pauseReason: undefined,
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

      case 'task_end': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        if (!subagent || !aid) break
        const activity: ToolActivity = {
          type: 'status',
          name: 'task_end',
          content: subagent.status === 'error' ? '子任务生命周期结束，状态失败' : '子任务生命周期结束',
          ts: Date.now(),
          subagent,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
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
          isPaused: false,
          isStopping: false,
          pauseReason: undefined,
          messages: prev.messages.map((m) =>
            m.id === aid ? { ...m, isStreaming: false, content: m.content || '(已终止)' } : m
          ),
        }))
        break
      }

      case 'error': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        if (sid) {
          const pendingAssistantId = pendingAssistantIds.current[sid]
          const systemNotice = buildSystemErrorNotice(event.error || event.payload || event.content || event)
          pendingAssistantIds.current[sid] = null
          updateSession(sid, (prev) => ({
            isProcessing: false,
            isPaused: false,
            isStopping: false,
            pauseReason: undefined,
            messages: (() => {
              const nextMessages = [...prev.messages]

              if (pendingAssistantId) {
                const pendingIndex = nextMessages.findIndex((message) => message.id === pendingAssistantId)
                if (pendingIndex >= 0) {
                  const pendingMessage = nextMessages[pendingIndex]
                  const hasVisibleContent = Boolean(
                    pendingMessage.content.trim()
                    || pendingMessage.attachments?.length
                    || pendingMessage.tools?.length
                    || pendingMessage.contentSegments?.some((segment) => segment.text.trim())
                  )

                  if (hasVisibleContent) {
                    nextMessages[pendingIndex] = { ...pendingMessage, isStreaming: false }
                  } else {
                    nextMessages.splice(pendingIndex, 1)
                  }
                }
              }

              nextMessages.push({
                id: `err-${Date.now()}`,
                role: 'system',
                content: systemNotice.message,
                systemNotice,
                timestamp: Date.now(),
              })

              return nextMessages
            })(),
          }))
        }
        break
      }

      case 'pong':
        break

      default:
        break
    }
  }, [updateSession])

  const handleSend = () => {
    const message = input.trim()
    if ((!message && attachments.length === 0) || activeSession.isProcessing) return

    const sid = activeSessionId || ensureLocalSession()
    const payload = buildMessagePayload(message, attachments)
    const attachedFiles = [...attachments]

    updateSession(sid, (prev) => ({
      ...prev,
      isProcessing: true,
      currentThinking: '',
      isPaused: false,
      isStopping: false,
      pauseReason: undefined,
      messages: [...prev.messages, {
        id: `usr-${Date.now()}`,
        role: 'user',
        content: message,
        attachments: attachedFiles,
        timestamp: Date.now(),
      }],
    }))
    void window.harnessclaw.send(payload, sid)
    setInput('')
    setAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend()
    }
  }

  const handleNewSession = () => {
    ensureLocalSession()
  }

  const handleReconnect = () => {
    window.harnessclaw.disconnect().then(() => {
      setTimeout(() => window.harnessclaw.connect(), 300)
    })
  }

  const handleStop = () => {
    if (!activeSessionId) return
    updateSession(activeSessionId, (prev) => ({
      ...prev,
      isStopping: true,
      isPaused: false,
      currentThinking: '',
      pauseReason: '正在请求中止当前会话...',
    }))
    void window.harnessclaw.stop(activeSessionId)
  }

  const appendAttachments = (items: AttachmentItem[]) => {
    if (!items.length) return

    setAttachments((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]))
      for (const item of items) {
        byId.set(item.path, { ...item, id: item.path })
      }
      return [...byId.values()]
    })
  }

  const handlePickFiles = async () => {
    if (activeSession.isProcessing || harnessclawStatus !== 'connected') return

    const picked = await window.files.pick()
    if (!picked.length) return
    appendAttachments(picked.map((item) => ({ ...item, id: item.path })))
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

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFilePreview(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative flex h-full overflow-hidden bg-background">
      {/* Main chat area */}
      <div className="relative flex-1 flex min-w-0 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="titlebar-drag border-b border-border/80 bg-card/72 px-4 py-3 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {activeSessionId ? activeSessionPrompt : '新对话'}
                </span>
              </div>
            </div>

            {activeSessionId && (
              <button
                onClick={handleClearHistory}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                <Trash2 size={12} />
                清空历史
              </button>
            )}
          </div>
        </div>

        {!activeSessionId ? (
          /* Empty state — no session selected */
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="w-full max-w-md text-center">
              <button
                onClick={handleNewSession}
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 dark:bg-primary dark:text-primary-foreground"
              >
                <Plus size={14} />
                开始新对话
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div
              ref={messagesViewportRef}
              onScroll={updateScrollState}
              className="flex-1 overflow-x-hidden overflow-y-auto px-4 py-5"
            >
              <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5">
                {activeSession.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onOpenFilePreview={setFilePreview}
                    onRespondPermission={respondPermission}
                  />
                ))}

                {/* Live thinking indicator */}
                {activeSession.isProcessing && activeSession.currentThinking && (
                  <ThinkingIndicator content={activeSession.currentThinking} />
                )}

                {/* Processing spinner — visible until assistant message has text content */}
                {activeSession.isProcessing && !activeSession.isPaused && !activeSession.isStopping && !activeSession.currentThinking && (
                  (() => {
                    const aid = pendingAssistantIds.current[activeSessionId]
                    const pending = aid ? activeSession.messages.find((m) => m.id === aid) : null
                    if (pending?.content) return null
                    if (pending?.tools && pending.tools.length > 0) return null
                    return (
                      <div className="flex justify-start">
                        <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 shadow-sm">
                          <Loader2 size={14} className="animate-spin text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Agent 正在准备回复…</span>
                        </div>
                      </div>
                    )
                  })()
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {showJumpToBottom && (
              <button
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-[calc(100px+1.5rem)] left-1/2 z-20 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-border/80 bg-white shadow-[0_14px_30px_rgba(15,23,42,0.14)] transition-transform hover:scale-[1.03] dark:bg-card"
                aria-label="快速回到底部"
                title="回到底部"
              >
                <ArrowDown size={18} className="text-foreground" />
              </button>
            )}

            {/* Input area */}
            <div className="bg-card/45 px-4 py-2.5 backdrop-blur-sm">
              <div className="mx-auto w-full max-w-4xl">
                {composerNotice && (
                  <div
                    className={cn(
                      'mb-3 flex items-start gap-2 rounded-2xl border px-3.5 py-3',
                      composerNotice.tone === 'danger'
                        ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20'
                        : 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'
                    )}
                  >
                    {composerNotice.tone === 'danger' ? (
                      <Loader2 size={14} className="mt-0.5 flex-shrink-0 animate-spin text-red-600 dark:text-red-300" />
                    ) : (
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-300" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-xs font-medium',
                          composerNotice.tone === 'danger'
                            ? 'text-red-800 dark:text-red-200'
                            : 'text-amber-800 dark:text-amber-200'
                        )}
                      >
                        {composerNotice.title}
                      </p>
                      <p
                        className={cn(
                          'mt-1 text-xs leading-5',
                          composerNotice.tone === 'danger'
                            ? 'text-red-700 dark:text-red-300'
                            : 'text-amber-700 dark:text-amber-300'
                        )}
                      >
                        {composerNotice.description}
                      </p>
                    </div>
                    {composerNotice.actionLabel && (
                      <button
                        onClick={handleReconnect}
                        className={cn(
                          'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-opacity hover:opacity-80',
                          composerNotice.tone === 'danger'
                            ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300'
                            : 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300'
                        )}
                      >
                        <RefreshCw size={12} />
                        {composerNotice.actionLabel}
                      </button>
                    )}
                  </div>
                )}

                <div
                  className={cn(
                    'relative overflow-hidden rounded-[28px] border bg-card shadow-[0_12px_36px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow]',
                    isDragOver
                      ? 'border-primary shadow-[0_18px_50px_rgba(37,99,235,0.14)]'
                      : 'border-border focus-within:border-primary'
                  )}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {isDragOver && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-card text-sm text-primary">
                      松开即可添加文件
                    </div>
                  )}
                  <div className="p-3 sm:p-3.5">
                    <textarea
                      ref={composerTextareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value.slice(0, maxLength))}
                      onKeyDown={handleKeyDown}
                      disabled={activeSession.isProcessing}
                      placeholder={
                        harnessclawStatus === 'connected'
                          ? '+ 想让 HarnessClaw 帮你做什么？'
                          : '+ 先写下你的问题，发送时会自动尝试连接。'
                      }
                      className="min-h-[26px] max-h-[120px] w-full resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
                      rows={1}
                    />
                    <AttachmentPreviewPanel
                      attachments={attachments}
                      onRemove={handleRemoveAttachment}
                      removable={!activeSession.isProcessing}
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <button
                        onClick={handlePickFiles}
                        disabled={activeSession.isProcessing || harnessclawStatus !== 'connected'}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                        title="添加文件"
                        aria-label="添加文件"
                      >
                        <Plus size={16} />
                      </button>

                      <div className="flex items-center gap-2">
                        {activeSession.isProcessing ? (
                          <button
                            onClick={handleStop}
                            disabled={activeSession.isStopping}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
                            title="停止当前任务"
                            aria-label="停止当前任务"
                          >
                            <span className="h-2 w-2 rounded-sm bg-current" />
                          </button>
                        ) : (
                          <button
                            onClick={handleSend}
                            disabled={!input.trim() && attachments.length === 0}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-primary dark:text-primary-foreground"
                            aria-label="发送消息"
                          >
                            <Send size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <FilePreviewDrawer preview={filePreview} onClose={() => setFilePreview(null)} />
    </div>
  )
}

// ─── Sub Components ─────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onOpenFilePreview,
  onRespondPermission,
}: {
  message: Message
  onOpenFilePreview: (preview: FilePreviewData) => void
  onRespondPermission: (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const systemNotice = message.systemNotice

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isSystem) {
    if (systemNotice?.kind === 'error') {
      return (
        <div className="flex justify-start">
          <div className="w-[min(80%,56rem)]">
            <div className="rounded-2xl border border-red-200 bg-white px-4 py-3 shadow-sm dark:border-red-900/40 dark:bg-[#1b1414]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300">
                  <AlertCircle size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">{systemNotice.title}</p>
                    {systemNotice.reason && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-950/30 dark:text-red-300">
                        {systemNotice.reason}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-foreground dark:text-[#e8edf5]">{systemNotice.message}</p>
                  {systemNotice.hint && (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground dark:text-[#aab4c7]">
                      建议：{systemNotice.hint}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <p className="mt-1 px-1 text-[10px] text-muted-foreground">
                {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex justify-center">
        <span className="text-[10px] text-muted-foreground bg-muted px-3 py-1 rounded-full">{message.content}</span>
      </div>
    )
  }

  type Segment =
    | { kind: 'status'; data: ToolActivity; ts: number; subagent?: SubagentInfo }
    | { kind: 'hint'; data: ToolActivity; ts: number; subagent?: SubagentInfo }
    | { kind: 'tool'; call: ToolActivity; result?: ToolActivity; isRunning: boolean; ts: number; subagent?: SubagentInfo }
    | { kind: 'permission'; request: ToolActivity; result?: ToolActivity; ts: number; subagent?: SubagentInfo }
    | { kind: 'text'; text: string; ts: number; subagent?: SubagentInfo }

  type DisplaySegment =
    | { kind: 'main'; items: Segment[]; ts: number }
    | { kind: 'subagent'; task: SubagentInfo; items: Segment[]; ts: number }

  const segments: Segment[] = []
  const tools = message.tools || []
  const toolResults = tools.filter((a) => a.type === 'result')
  const permissionResults = tools.filter((a) => a.type === 'permission_result')

  for (const t of tools) {
    if (t.type === 'status') {
      segments.push({ kind: 'status', data: t, ts: t.ts, subagent: t.subagent })
    } else if (t.type === 'hint') {
      segments.push({ kind: 'hint', data: t, ts: t.ts, subagent: t.subagent })
    } else if (t.type === 'call') {
      const result = toolResults.find((r) => r.callId === t.callId)
      const isRunning = !!message.isStreaming && !result
      segments.push({ kind: 'tool', call: t, result, isRunning, ts: t.ts, subagent: t.subagent || result?.subagent })
    } else if (t.type === 'permission') {
      const result = permissionResults.find((r) => r.callId === t.callId)
      segments.push({ kind: 'permission', request: t, result, ts: t.ts, subagent: t.subagent || result?.subagent })
    }
  }

  const contentSegs = message.contentSegments || []
  for (const seg of contentSegs) {
    if (seg.text) {
      segments.push({ kind: 'text', text: seg.text, ts: seg.ts, subagent: seg.subagent })
    }
  }

  if (contentSegs.length === 0 && message.content) {
    segments.push({ kind: 'text', text: message.content, ts: message.timestamp })
  }

  segments.sort((a, b) => a.ts - b.ts)

  const displaySegments: DisplaySegment[] = []
  const mainModule: Extract<DisplaySegment, { kind: 'main' }> = { kind: 'main', items: [], ts: message.timestamp }
  const subagentPanels = new Map<string, Extract<DisplaySegment, { kind: 'subagent' }>>()
  let hasMainModule = false

  for (const seg of segments) {
    if (!seg.subagent) {
      if (!hasMainModule) {
        mainModule.ts = seg.ts
        displaySegments.push(mainModule)
        hasMainModule = true
      }
      mainModule.items.push(seg)
      continue
    }

    const existing = subagentPanels.get(seg.subagent.taskId)
    if (existing) {
      existing.items.push(seg)
      continue
    }

    // Only task_start is allowed to create an empty subagent panel.
    // Other pure status markers must only update an existing panel.
    if (seg.kind === 'status' && seg.data.name !== 'task_start') {
      continue
    }

    const panel: Extract<DisplaySegment, { kind: 'subagent' }> = {
      kind: 'subagent',
      task: seg.subagent,
      items: [seg],
      ts: seg.ts,
    }
    subagentPanels.set(seg.subagent.taskId, panel)
    displaySegments.push(panel)
  }

  const toolCalls = tools.filter((a) => a.type === 'call')
  const subagentCount = new Set(
    segments
      .map((seg) => seg.subagent?.taskId)
      .filter((taskId): taskId is string => !!taskId)
  ).size
  const attachments = message.attachments || []
  const lastVisibleActivityTs = segments.reduce((latest, seg) => Math.max(latest, seg.ts), message.timestamp)
  const shouldShowBreathingDot = !isUser
    && !isSystem
    && !!message.isStreaming
    && segments.length > 0
    && now - lastVisibleActivityTs > 1000
  const shouldShowTimestamp = !message.isStreaming
  const hasRenderableAssistantBody = displaySegments.length > 0 || attachments.length > 0

  if (!isUser && !isSystem && !message.isStreaming && !hasRenderableAssistantBody) {
    return null
  }

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

  const renderTextBlock = (text: string, key: string, compact = false) => (
    <div
      key={key}
      className={cn(
        compact
          ? 'mb-1.5 rounded-xl bg-transparent px-0 py-0 text-[13px]'
          : 'mb-1.5 rounded-2xl px-3.5 py-2.5 text-sm',
        'min-w-0 max-w-full overflow-hidden',
        !compact && isUser
          ? 'rounded-br-sm bg-foreground text-background dark:bg-primary dark:text-primary-foreground'
          : !compact
            ? 'w-full rounded-bl-sm border border-border bg-card text-foreground shadow-sm dark:border-[#2b3245] dark:bg-[#161b27] dark:text-[#e8edf5]'
            : 'text-foreground dark:text-[#dce3ef]'
      )}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap">{text}</p>
      ) : (
        <div className={cn(
          'prose max-w-none break-words [overflow-wrap:anywhere] text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-code:break-all prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:text-foreground dark:prose-invert dark:text-[#dce3ef] dark:prose-headings:text-[#eef3fb] dark:prose-p:text-[#dce3ef] dark:prose-strong:text-[#f5f8fe] dark:prose-li:text-[#dce3ef] dark:prose-a:text-[#8cb8ff] dark:prose-blockquote:border-l-[#374057] dark:prose-blockquote:text-[#aab4c7] dark:prose-pre:border-[#2a3246] dark:prose-pre:bg-[#111623] dark:prose-pre:text-[#e6edf8] dark:prose-code:bg-[#20283a] dark:prose-code:text-[#f2f6ff]',
          compact ? 'prose-xs' : 'prose-sm'
        )}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  )

  const renderHint = (text: string, key: string, compact = false) => (
    <div
      key={key}
      className={cn(
        'mb-1.5 flex items-center gap-1.5',
        compact
          ? 'rounded-lg bg-accent/55 px-2 py-1.5 dark:bg-[#1a2131]'
          : 'rounded-full bg-accent/45 px-2.5 py-1 dark:bg-[#1a2131]'
      )}
    >
      <Wrench size={10} className="text-muted-foreground dark:text-[#a9b3c6]" />
      <span className={cn(
        compact
          ? 'text-[11px] text-foreground/80 dark:text-[#d4dceb]'
          : 'text-[11px] text-muted-foreground dark:text-[#a9b3c6]'
      )}>{text}</span>
    </div>
  )

  const renderStatus = (text: string, key: string, status?: string) => (
    <div key={key} className="mb-2 flex items-center gap-2 rounded-xl border border-border/70 bg-background/75 px-2.5 py-2 dark:border-[#2a3145] dark:bg-[#131926]">
      <span className={cn(
        'inline-block h-2.5 w-2.5 rounded-sm',
        status === 'error' ? 'bg-red-500' : status === 'running' ? 'bg-amber-500' : 'bg-emerald-500'
      )} />
      <span className="text-[11px] text-muted-foreground dark:text-[#aeb7ca]">{text}</span>
    </div>
  )

  return (
    <div className={cn('flex min-w-0 max-w-full group', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative min-w-0 max-w-full',
          isUser ? 'max-w-[80%] items-end' : 'w-[min(80%,56rem)] items-start'
        )}
      >
        <div className={cn(
          'absolute top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
          isUser ? '-left-16' : '-right-16'
        )}>
          <button onClick={handleCopy} className="rounded-lg p-1.5 hover:bg-muted" aria-label="复制消息">
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-muted-foreground" />}
          </button>
        </div>

        {displaySegments.map((seg, i) => {
          if (seg.kind === 'main') {
            return (
              <div key={`main-${i}`}>
                {seg.items.map((item, itemIndex) => {
                  if (item.kind === 'status') {
                    return renderStatus(item.data.content, `status-${i}-${itemIndex}`, item.subagent?.status)
                  }
                  if (item.kind === 'hint') {
                    return renderHint(item.data.content, `hint-${i}-${itemIndex}`)
                  }
                  if (item.kind === 'tool') {
                    return (
                      <ToolCallCard
                        key={item.call.callId || `${i}-${itemIndex}`}
                        call={item.call}
                        result={item.result}
                        isRunning={item.isRunning}
                        onOpenFilePreview={onOpenFilePreview}
                      />
                    )
                  }
                  if (item.kind === 'permission') {
                    return (
                      <PermissionRequestCard
                        key={item.request.callId || `${i}-${itemIndex}`}
                        request={item.request}
                        result={item.result}
                        onRespondPermission={onRespondPermission}
                      />
                    )
                  }
                  return renderTextBlock(item.text, `text-${i}-${itemIndex}`)
                })}
              </div>
            )
          }
          if (seg.kind === 'subagent') {
            return (
              <SubagentPanel
                key={`subagent-${seg.task.taskId}`}
                task={seg.task}
                items={seg.items}
                onOpenFilePreview={onOpenFilePreview}
                onRespondPermission={onRespondPermission}
                renderHint={renderHint}
                renderTextBlock={renderTextBlock}
              />
            )
          }
        })}

        {attachments.length > 0 && (
          <div className={cn('mb-1.5', isUser ? 'flex justify-end' : 'flex justify-start')}>
            <div className="max-w-[420px]">
              <AttachmentPreviewPanel attachments={attachments} removable={false} />
            </div>
          </div>
        )}

        {shouldShowBreathingDot && (
          <div className="mb-1.5 flex justify-end pr-1">
            <span className="streaming-breathing-dot" aria-label="服务仍在继续" />
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-2 mt-1 px-1">
          {toolCalls.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Wrench size={9} /> {toolCalls.length} 个工具操作
            </span>
          )}
          {subagentCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border border-border bg-accent">
                <span className="h-1.5 w-1.5 rounded-[2px] bg-primary" />
              </span>
              {subagentCount} 个辅助处理
            </span>
          )}
          {shouldShowTimestamp && (
            <p className="text-[10px] text-muted-foreground">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function PixelSubagentIcon({ status }: { status: string }) {
  const pixels = [
    '..1111..',
    '.111111.',
    '.11..11.',
    '11111111',
    '11.11.11',
    '.111111.',
    '.1.11.1.',
    '1..11..1',
  ]
  const tone = status === 'error' ? 'bg-red-500' : 'bg-primary'

  return (
    <div className="grid grid-cols-8 gap-[1px] rounded-md bg-card/80 p-1 shadow-inner dark:bg-[#111623]">
      {pixels.flatMap((row, rowIndex) =>
        row.split('').map((cell, colIndex) => (
          <span
            key={`${rowIndex}-${colIndex}`}
            className={cn('h-[3px] w-[3px] rounded-[1px]', cell === '1' ? tone : 'bg-transparent')}
          />
        ))
      )}
    </div>
  )
}

function SubagentPanel({
  task,
  items,
  onOpenFilePreview,
  onRespondPermission,
  renderHint,
  renderTextBlock,
}: {
  task: SubagentInfo
  items: Array<
    | { kind: 'status'; data: ToolActivity; ts: number; subagent?: SubagentInfo }
    | { kind: 'hint'; data: ToolActivity; ts: number; subagent?: SubagentInfo }
    | { kind: 'tool'; call: ToolActivity; result?: ToolActivity; isRunning: boolean; ts: number; subagent?: SubagentInfo }
    | { kind: 'permission'; request: ToolActivity; result?: ToolActivity; ts: number; subagent?: SubagentInfo }
    | { kind: 'text'; text: string; ts: number; subagent?: SubagentInfo }
  >
  onOpenFilePreview: (preview: FilePreviewData) => void
  onRespondPermission: (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
  renderHint: (text: string, key: string, compact?: boolean) => JSX.Element
  renderTextBlock: (text: string, key: string, compact?: boolean) => JSX.Element
}) {
  const latestTask = items.reduce<SubagentInfo>((current, item) => item.subagent || current, task)
  const isRunning = latestTask.status === 'running'
  const [expanded, setExpanded] = useState(items.length <= 2 || isRunning)
  const visibleItems = items.filter((item) => item.kind !== 'status')

  useEffect(() => {
    if (isRunning) setExpanded(true)
  }, [isRunning])

  return (
    <section className="mb-3 ml-4 overflow-hidden rounded-[1.35rem] border border-border/80 bg-card/85 shadow-[0_10px_26px_rgba(15,23,42,0.06)] dark:border-[#2b3246] dark:bg-[#161c29] dark:shadow-[0_14px_32px_rgba(0,0,0,0.22)]">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/40 dark:hover:bg-[#1b2332]"
      >
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-card shadow-sm dark:border-[#2b3246] dark:bg-[#151b27]">
          <PixelSubagentIcon status={latestTask.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">辅助处理 · {latestTask.label}</span>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              latestTask.status === 'error'
                ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                : isRunning
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            )}>
              {latestTask.status === 'error' ? '失败' : isRunning ? '运行中' : '已完成'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground dark:text-[#aab4c7]">
            {isRunning ? '正在补充过程和结果。' : `${visibleItems.length || items.length} 条过程记录已整理完成。`}
          </p>
        </div>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card/80 dark:border-[#2b3246] dark:bg-[#151b27]">
          {expanded ? <ChevronUp size={14} className="text-muted-foreground dark:text-[#aab4c7]" /> : <ChevronDown size={14} className="text-muted-foreground dark:text-[#aab4c7]" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/80 bg-background/45 px-3.5 py-3 dark:border-[#2b3246] dark:bg-[#121824]">
          <div className="rounded-2xl border border-border/70 bg-background/75 px-3 py-3 dark:border-[#293045] dark:bg-[#131a27]">
            {visibleItems.length === 0 ? (
              <p className="text-[11px] text-muted-foreground dark:text-[#aab4c7]">等待更多处理结果…</p>
            ) : (
              visibleItems.map((item, index) => {
                if (item.kind === 'hint') {
                  return renderHint(item.data.content, `sub-hint-${latestTask.taskId}-${index}`, true)
                }
                if (item.kind === 'tool') {
                  return (
                    <ToolCallCard
                      key={`sub-tool-${item.call.callId || index}`}
                      call={item.call}
                      result={item.result}
                      isRunning={item.isRunning}
                      onOpenFilePreview={onOpenFilePreview}
                    />
                  )
                }
                if (item.kind === 'permission') {
                  return (
                    <PermissionRequestCard
                      key={`sub-perm-${item.request.callId || index}`}
                      request={item.request}
                      result={item.result}
                      onRespondPermission={onRespondPermission}
                    />
                  )
                }
                return renderTextBlock(item.text, `sub-text-${latestTask.taskId}-${index}`, true)
              })
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function ToolCallCard({
  call,
  result,
  isRunning,
  onOpenFilePreview,
}: {
  call: ToolActivity
  result?: ToolActivity
  isRunning?: boolean
  onOpenFilePreview: (preview: FilePreviewData) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const filePreview = extractFilePreviewData(call, result)
  const toolName = getToolDisplayName(call.name)

  return (
    <div className="mb-1.5">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm dark:border-[#2b3246] dark:bg-[#161b27]">
        <div className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/40 dark:hover:bg-[#1a2232]">
          {isRunning ? (
            <Loader2 size={12} className="animate-spin text-yellow-500 flex-shrink-0" />
          ) : result?.isError ? (
            <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
          ) : result ? (
            <Check size={12} className="text-green-500 flex-shrink-0" />
          ) : (
            <Wrench size={12} className="text-muted-foreground flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-xs font-medium text-foreground">{toolName}</span>
              <span className={cn(
                'text-[10px] flex-shrink-0',
                isRunning ? 'text-yellow-500' : result?.isError ? 'text-red-500' : result ? 'text-green-600' : 'text-muted-foreground'
              )}>
                {isRunning ? '执行中' : result?.isError ? '失败' : result ? '完成' : ''}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground dark:text-[#aab4c7]">
              {filePreview
                ? `涉及文件 ${filePreview.fileName}`
                : isRunning
                  ? 'Agent 正在执行这个步骤。'
                  : result?.isError
                    ? '这个步骤没有顺利完成。'
                    : '这个步骤已执行完成。'}
            </p>

            {filePreview && (
              <button
                onClick={() => onOpenFilePreview(filePreview)}
                className="mt-2 flex w-full items-center gap-2 rounded-xl border border-border bg-accent/55 px-2.5 py-2 text-left transition-colors hover:bg-accent dark:border-[#2b3246] dark:bg-[#1b2332] dark:hover:bg-[#20293b]"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-card shadow-sm dark:bg-[#151b27]">
                  <FileText size={15} className="text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium text-foreground">{filePreview.fileName}</div>
                  <div className="truncate text-[10px] text-muted-foreground dark:text-[#9eabc2]">{filePreview.path}</div>
                </div>
                <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground dark:border-[#2b3246] dark:bg-[#151b27] dark:text-[#aab4c7]">
                  {filePreview.operation === 'read_file' ? '查看内容' : '查看写入'}
                </span>
              </button>
            )}
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md hover:bg-muted dark:hover:bg-[#202738]"
            aria-label={expanded ? '收起工具详情' : '展开工具详情'}
          >
            {expanded ? <ChevronUp size={12} className="text-muted-foreground dark:text-[#aab4c7]" /> : <ChevronDown size={12} className="text-muted-foreground dark:text-[#aab4c7]" />}
          </button>
        </div>

        {expanded && (
          <div className="space-y-2 border-t border-border px-3 py-2 dark:border-[#2b3246]">
            {call.name && (
              <div>
                <p className="mb-1 text-[10px] text-muted-foreground">工具名</p>
                <pre className="rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80 dark:bg-[#111623] dark:text-[#d9e1ef]">{call.name}</pre>
              </div>
            )}
            {call.content && call.content !== '{}' && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">输入参数</p>
                <pre className="max-h-40 overflow-x-auto rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80 dark:bg-[#111623] dark:text-[#d9e1ef]">{call.content}</pre>
              </div>
            )}
            {result && (
              <div>
                <p className={cn('text-[10px] mb-1', result.isError ? 'text-red-500' : 'text-muted-foreground')}>
                  {result.isError ? '错误' : '结果'}
                </p>
                <pre className={cn(
                  'text-[11px] font-mono rounded-lg p-2 overflow-x-auto max-h-40',
                  result.isError
                    ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300'
                    : 'bg-muted text-foreground/80 dark:bg-[#111623] dark:text-[#d9e1ef]'
                )}>
                  {result.content?.slice(0, 800)}{(result.content?.length ?? 0) > 800 ? '...' : ''}
                </pre>
              </div>
            )}
            {isRunning && !result && (
              <div className="flex items-center gap-1.5 py-0.5">
                <Loader2 size={10} className="animate-spin text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground dark:text-[#aab4c7]">等待返回...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PermissionRequestCard({
  request,
  result,
  onRespondPermission,
}: {
  request: ToolActivity
  result?: ToolActivity
  onRespondPermission: (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const requestData = parsePermissionRequestData(request.content)
  const resultData = result ? parsePermissionResultData(result.content) : null
  const isResolved = !!resultData

  const handleRespond = async (approved: boolean, scope: 'once' | 'session', label: string) => {
    if (!request.callId || submitting) return
    setSubmitting(label)
    try {
      await onRespondPermission(request.callId, approved, scope)
    } finally {
      setSubmitting(null)
    }
  }

  const options = requestData?.options?.length
    ? requestData.options
    : [
        { label: '允许这一次', scope: 'once' as const, allow: true },
        { label: '本次会话都允许', scope: 'session' as const, allow: true },
        { label: '拒绝', scope: 'once' as const, allow: false },
      ]

  const resultLabel = resultData
    ? resultData.approved
      ? resultData.scope === 'session' ? '本会话已允许' : '已允许一次'
      : '已拒绝'
    : '等待授权'

  return (
    <div className="mb-1.5">
      <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/80 shadow-sm dark:border-amber-900/40 dark:bg-[#221b12]">
        <div className="flex items-start gap-2 px-3 py-2">
          {isResolved ? (
            resultData?.approved ? (
              <Check size={12} className="mt-0.5 flex-shrink-0 text-green-600" />
            ) : (
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0 text-red-500" />
            )
          ) : (
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0 text-amber-600" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-xs font-medium text-foreground">
                需要你的确认
              </span>
              <span className={cn(
                'flex-shrink-0 text-[10px]',
                isResolved
                  ? resultData?.approved ? 'text-green-600' : 'text-red-500'
                  : 'text-amber-700 dark:text-amber-300'
              )}>
                {resultLabel}
              </span>
            </div>
            <div className="mt-1 rounded-lg border border-amber-200/70 bg-white/70 px-2.5 py-2 dark:border-amber-900/30 dark:bg-[#191f2c]">
              {requestData?.command ? (
                <p className="line-clamp-3 break-all text-[11px] text-foreground/90 dark:text-[#e5ebf4]">
                  Agent 想运行一条命令继续处理当前任务。
                </p>
              ) : (
                <p className="line-clamp-3 break-all text-[11px] text-foreground/90 dark:text-[#e5ebf4]">
                  {requestData?.message || '这个操作需要先得到你的确认。'}
                </p>
              )}
              {requestData?.description && (
                <p className="mt-1 line-clamp-2 break-all text-[10px] text-muted-foreground dark:text-[#aab4c7]">
                  {requestData.description}
                </p>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground dark:text-[#aab4c7]">
              <span>{requestData?.isReadOnly ? '只会读取信息' : '可能修改文件或环境'}</span>
              {request.name && <span>{getToolDisplayName(request.name)}</span>}
            </div>
            {requestData?.message && (requestData.command || requestData.description) && (
              <p className="mt-1 text-[10px] text-muted-foreground dark:text-[#aab4c7]">
                {requestData.message}
              </p>
            )}

            {!isResolved && (
              <div className="mt-2 flex items-center gap-2">
                {options.map((option) => (
                  <button
                    key={`${option.label}-${option.scope}-${String(option.allow)}`}
                    onClick={() => void handleRespond(option.allow, option.scope, option.label)}
                    disabled={!!submitting}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      option.allow
                        ? option.scope === 'session'
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-green-600 text-white hover:bg-green-700'
                        : 'border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:bg-[#191f2c] dark:text-red-300 dark:hover:bg-red-950/30'
                    )}
                  >
                    {submitting === option.label ? '提交中...' : getPermissionOptionLabel(option.label)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
            aria-label={expanded ? '收起审批详情' : '展开审批详情'}
          >
            {expanded ? <ChevronUp size={12} className="text-muted-foreground dark:text-[#aab4c7]" /> : <ChevronDown size={12} className="text-muted-foreground dark:text-[#aab4c7]" />}
          </button>
        </div>

        {expanded && (
          <div className="space-y-2 border-t border-amber-200/70 px-3 py-2 dark:border-amber-900/30">
            {requestData?.toolInput && (
              <div>
                <p className="mb-1 text-[10px] text-muted-foreground">操作详情</p>
                <pre className="max-h-40 overflow-x-auto rounded-lg bg-background/80 p-2 text-[11px] font-mono text-foreground/80 dark:bg-[#191f2c] dark:text-[#dce3ef]">
                  {requestData.toolInput}
                </pre>
              </div>
            )}
            {resultData?.message && (
              <div>
                <p className="mb-1 text-[10px] text-muted-foreground">审批结果</p>
                <pre className="overflow-x-auto rounded-lg bg-background/80 p-2 text-[11px] font-mono text-foreground/80 dark:bg-[#191f2c] dark:text-[#dce3ef]">
                  {resultData.message}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FilePreviewDrawer({ preview, onClose }: { preview: FilePreviewData | null; onClose: () => void }) {
  const isOpen = !!preview

  return (
    <>
      <div
        className={cn(
          'absolute inset-0 z-20 bg-slate-950/12 transition-opacity duration-200',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
      />

      <aside
        className={cn(
          'absolute inset-y-0 right-0 z-30 flex w-full max-w-3xl flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ease-out dark:border-[#2b3246] dark:bg-[#151b27]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="border-b border-border bg-card/95 px-5 py-4 backdrop-blur-sm dark:border-[#2b3246] dark:bg-[#151b27]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-accent shadow-sm dark:bg-[#1b2332]">
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {preview?.fileName || '文件预览'}
                </h3>
                {preview && (
                  <span className="rounded-full border border-border bg-accent/70 px-2 py-0.5 text-[10px] text-muted-foreground dark:border-[#2b3246] dark:bg-[#1b2332] dark:text-[#aab4c7]">
                    {preview.operation === 'read_file' ? 'read_file' : 'write_file'}
                  </span>
                )}
              </div>
              <p className="mt-1 break-all text-[11px] text-muted-foreground dark:text-[#aab4c7]">{preview?.path || ''}</p>
              {preview?.operation === 'read_file' && preview.limit != null && (
                <p className="mt-1 text-[10px] text-muted-foreground dark:text-[#aab4c7]">展示读取结果，调用限制为 {preview.limit} 行</p>
              )}
              {preview?.operation === 'write_file' && (
                <p className="mt-1 text-[10px] text-muted-foreground dark:text-[#aab4c7]">展示写入文件时提交的内容</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted dark:border-[#2b3246] dark:bg-[#151b27] dark:hover:bg-[#202738]"
              aria-label="关闭文件预览"
            >
              <X size={15} className="text-muted-foreground dark:text-[#aab4c7]" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-background/65 p-5 dark:bg-[#101521]">
          {preview?.content ? (
            <pre className="min-h-full overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-border bg-card p-4 font-mono text-[12px] leading-6 text-foreground shadow-sm dark:border-[#2b3246] dark:bg-[#151b27] dark:text-[#e3e9f5]">
              {preview.content}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center dark:border-[#2b3246] dark:bg-[#151b27]">
              <div>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent dark:bg-[#1b2332]">
                  <FileText size={18} className="text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">没有可展示的文件内容</p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-[#aab4c7]">这个工具调用没有返回可预览的文本。</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

function ThinkingIndicator({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex justify-start">
      <button
        onClick={() => setExpanded(!expanded)}
        className="max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/50 dark:border-[#2b3246] dark:bg-[#161b27] dark:hover:bg-[#1b2332]"
      >
        <div className="flex items-center gap-2">
          <Brain size={12} className="animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground dark:text-[#aab4c7]">Agent 正在整理答案</span>
        </div>
        {expanded && (
          <p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground dark:text-[#d6deec]">{content}</p>
        )}
      </button>
    </div>
  )
}
