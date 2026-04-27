import { memo, useState, useRef, useEffect, useCallback, useMemo, useId, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Send, Plus, Copy, Check, Trash2,
  Loader2, Wrench, Brain, AlertCircle, RefreshCw, ChevronDown, ChevronUp,
  FileText, X, ArrowDown, AtSign, GitBranch, ListTodo, Users, MessagesSquare, ChevronLeft, ChevronRight, Search
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { visit, SKIP } from 'unist-util-visit'
import { cn } from '@/lib/utils'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'
import {
  buildSkillComposerPayload,
  SkillComposerInput,
  type SelectedSkillChip,
} from '../common/SkillComposerInput'
import { PastedBlocksBar, usePastedBlocks } from '../common/PastedBlocksBar'
import emmaAvatar from '../../assets/sidebar-logo.png'
import analystAvatar from '../../assets/team/analyst.png'
import developerAvatar from '../../assets/team/developer.png'
import lifestyleAvatar from '../../assets/team/lifestyle.png'
import researcherAvatar from '../../assets/team/researcher.png'
import writerAvatar from '../../assets/team/writer.png'

const TEAM_AVATARS = [analystAvatar, developerAvatar, lifestyleAvatar, researcherAvatar, writerAvatar]

function resolveTeamAvatar(name?: string): string {
  const key = (name || '').toLowerCase()
  if (/analy|分析|数据/.test(key)) return analystAvatar
  if (/dev|develop|engineer|coder|code|程序|开发|工程/.test(key)) return developerAvatar
  if (/life|生活|日常/.test(key)) return lifestyleAvatar
  if (/research|search|explore|调研|研究|搜索/.test(key)) return researcherAvatar
  if (/writ|copy|edit|文案|写作|编辑/.test(key)) return writerAvatar
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return TEAM_AVATARS[Math.abs(hash) % TEAM_AVATARS.length]
}

// ─── File-path linkification ────────────────────────────────────────────────

// Match absolute UNIX paths (/Users/..., /home/..., /var/..., etc.), tilde-prefixed paths
// (~/foo/bar) and Windows drive paths (C:\foo\bar). Each must contain at least one separator
// segment after the root anchor.
const FILE_PATH_REGEX = /(?:~|\/[A-Za-z0-9._-]+|[A-Za-z]:[\\/])(?:[\\/][A-Za-z0-9._-]+)+/g
const FILEPATH_HREF_PREFIX = 'filepath://'

function remarkFilePaths() {
  return (tree: unknown) => {
    visit(tree as never, 'text', (node: { value: string }, index: number | null, parent: { type: string; children: unknown[] } | null) => {
      if (!parent || index == null) return
      if (parent.type === 'link' || parent.type === 'inlineCode' || parent.type === 'code') return
      const value = node.value
      const matches = [...value.matchAll(FILE_PATH_REGEX)]
      if (matches.length === 0) return
      const replacements: unknown[] = []
      let cursor = 0
      for (const match of matches) {
        const start = match.index ?? 0
        if (start > cursor) {
          replacements.push({ type: 'text', value: value.slice(cursor, start) })
        }
        replacements.push({
          type: 'link',
          url: `${FILEPATH_HREF_PREFIX}${match[0]}`,
          children: [{ type: 'text', value: match[0] }],
        })
        cursor = start + match[0].length
      }
      if (cursor < value.length) {
        replacements.push({ type: 'text', value: value.slice(cursor) })
      }
      parent.children.splice(index, 1, ...replacements)
      return [SKIP, index + replacements.length]
    })
  }
}

function FilePathChip({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const fileName = path.split(/[\\/]/).pop() || path
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen(path)
      }}
      title={path}
      className="not-prose mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 align-baseline text-[12px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10"
    >
      <FileText size={12} className="flex-shrink-0 text-primary" />
      <span className="truncate max-w-[280px]">{fileName}</span>
    </button>
  )
}

function renderTextWithFilePaths(text: string, onOpen: (path: string) => void): ReactNode[] {
  const parts: ReactNode[] = []
  const regex = new RegExp(FILE_PATH_REGEX.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null
  let chipIndex = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(<FilePathChip key={`fp-${chipIndex++}-${match.index}`} path={match[0]} onOpen={onOpen} />)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

// ─── Types ──────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant' | 'system'
type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

interface SubagentInfo {
  taskId: string
  label: string
  status: 'ok' | 'error' | string
}

interface ProjectContext {
  projectId: string
  name: string
  description: string
  createdAt?: number
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
  durationMs?: number
  renderHint?: string
  language?: string
  filePath?: string
  metadata?: Record<string, unknown>
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
type RespondPermissionHandler = (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>

// Per-session state
interface SessionState {
  messages: Message[]
  pendingAssistantId: string | null
  isProcessing: boolean
  currentThinking: string
  isPaused: boolean
  isStopping: boolean
  pauseReason?: string
  collaboration: CollaborationState
}

interface CollaborationCapabilities {
  subAgents: boolean
  tasks: boolean
  messaging: boolean
  asyncAgent: boolean
  teams: boolean
}

interface RoutedAgentInfo {
  agentId: string
  agentName: string
  description: string
  agentType: string
  updatedAt: number
}

interface SyncAgentState {
  agentId: string
  agentName: string
  description: string
  agentType: string
  parentAgentId: string
  status: 'running' | 'completed' | 'max_turns' | 'model_error' | 'aborted' | 'timeout' | 'error'
  durationMs?: number
  numTurns?: number
  deniedTools: string[]
  streamText: string
  activeToolName?: string
  activeToolStatus?: 'running' | 'completed' | 'error'
  activeToolSummary?: string
  lastEventAt?: number
  eventCount: number
  updatedAt: number
}

interface CollaborationTask {
  taskId: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner?: string
  activeForm?: string
  scopeId?: string
  updatedAt: number
}

interface AgentMessageInfo {
  id: string
  from: string
  to: string
  summary: string
  teamId?: string
  ts: number
}

interface AsyncAgentState {
  agentId: string
  agentName: string
  description: string
  agentType: string
  parentAgentId: string
  status: 'running' | 'idle' | 'completed' | 'failed'
  durationMs?: number
  errorType?: string
  errorMessage?: string
  updatedAt: number
}

interface TeamState {
  teamId: string
  teamName: string
  members: string[]
  lastEvent: 'created' | 'member_join' | 'member_left' | 'deleted'
  memberName?: string
  memberType?: string
  updatedAt: number
}

interface CollaborationState {
  capabilities: CollaborationCapabilities
  routedAgent?: RoutedAgentInfo
  syncAgents: Record<string, SyncAgentState>
  tasks: Record<string, CollaborationTask>
  agentMessages: AgentMessageInfo[]
  asyncAgents: Record<string, AsyncAgentState>
  teams: Record<string, TeamState>
}

interface PersistedTaskStatusPayload {
  kind: 'task_event'
  taskId: string
  subject: string
  status: CollaborationTask['status']
  owner?: string
  activeForm?: string
  scopeId?: string
  summary: string
}

interface PersistedRoutedAgentPayload {
  kind: 'agent_routed'
  agentId: string
  agentName: string
  description?: string
  agentType?: string
  summary: string
}

interface PersistedAgentMessagePayload {
  kind: 'agent_message'
  id: string
  from: string
  to: string
  summary: string
  teamId?: string
}

interface PersistedAsyncAgentStatusPayload {
  kind: 'async_agent_event'
  agentId: string
  agentName: string
  description: string
  agentType: string
  parentAgentId: string
  status: AsyncAgentState['status']
  durationMs?: number
  errorType?: string
  errorMessage?: string
  summary: string
}

interface PersistedTeamStatusPayload {
  kind: 'team_event'
  teamId: string
  teamName?: string
  members: string[]
  lastEvent: TeamState['lastEvent']
  memberName?: string
  memberType?: string
  summary: string
}

type PersistedCollaborationStatusPayload =
  | PersistedTaskStatusPayload
  | PersistedRoutedAgentPayload
  | PersistedAgentMessagePayload
  | PersistedAsyncAgentStatusPayload
  | PersistedTeamStatusPayload

const ATTACHMENT_BLOCK_START = '[HARNESSCLAW_LOCAL_ATTACHMENTS]'
const ATTACHMENT_BLOCK_END = '[/HARNESSCLAW_LOCAL_ATTACHMENTS]'
const PROJECT_CONTEXT_BLOCK_START = '[HARNESSCLAW_PROJECT_CONTEXT]'
const PROJECT_CONTEXT_BLOCK_END = '[/HARNESSCLAW_PROJECT_CONTEXT]'
const ERROR_ATTACH_WINDOW_MS = 30_000
const noopUnsubscribe = () => {}
const CHAT_LOADING_STEPS = [
  {
    title: '整理上下文',
    detail: '把你刚刚发来的内容、技能和附件先排成同一条工作线。',
  },
  {
    title: '检查可执行路径',
    detail: '确认这轮回复要直接回答，还是先调用工具补足信息。',
  },
  {
    title: '准备清晰回复',
    detail: '优先给出可继续推进任务的下一步，而不是泛泛而谈。',
  },
] as const

interface ChatGreeting {
  tone: string
  title: string
  detail: string
}

interface LoadingStep {
  title: string
  detail: string
}

interface SharedTickerStore {
  now: number
  timerId: number | null
  subscribers: Set<() => void>
}

const sharedTickerStores = new Map<number, SharedTickerStore>()

function getSharedTickerStore(intervalMs: number): SharedTickerStore {
  const existing = sharedTickerStores.get(intervalMs)
  if (existing) return existing

  const store: SharedTickerStore = {
    now: Date.now(),
    timerId: null,
    subscribers: new Set(),
  }
  sharedTickerStores.set(intervalMs, store)
  return store
}

function subscribeSharedTicker(intervalMs: number, listener: () => void): () => void {
  const store = getSharedTickerStore(intervalMs)
  store.subscribers.add(listener)

  if (store.timerId == null) {
    store.timerId = window.setInterval(() => {
      store.now = Date.now()
      store.subscribers.forEach((subscriber) => subscriber())
    }, intervalMs)
  }

  return () => {
    const activeStore = getSharedTickerStore(intervalMs)
    activeStore.subscribers.delete(listener)
    if (activeStore.subscribers.size === 0 && activeStore.timerId != null) {
      window.clearInterval(activeStore.timerId)
      activeStore.timerId = null
    }
  }
}

function getSharedTickerSnapshot(intervalMs: number): number {
  return getSharedTickerStore(intervalMs).now
}

function useSharedNowTicker(enabled: boolean, intervalMs = 250): number {
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled) return noopUnsubscribe
    return subscribeSharedTicker(intervalMs, listener)
  }, [enabled, intervalMs])

  const getSnapshot = useCallback(() => {
    return enabled ? getSharedTickerSnapshot(intervalMs) : 0
  }, [enabled, intervalMs])

  return useSyncExternalStore(subscribe, getSnapshot, () => 0)
}

function getChatGreeting(now = new Date()): ChatGreeting {
  const hour = now.getHours()
  if (hour < 6) {
    return {
      tone: '夜深了',
      title: '把零散想法收进一条对话里',
      detail: '直接提问、附加文件，或把复杂任务拆给 HarnessClaw。',
    }
  }
  if (hour < 12) {
    return {
      tone: '上午好',
      title: '从一个清晰的问题开始今天的推进',
      detail: '新对话会保留上下文、文件与关键审批，适合直接进入任务。',
    }
  }
  if (hour < 18) {
    return {
      tone: '下午好',
      title: '把正在推进的工作继续交给这次对话',
      detail: '你可以补充背景、附上文件，让 Agent 接着往下处理。',
    }
  }
  return {
    tone: '晚上好',
    title: '用一条安静的对话把今天的收尾做好',
    detail: '问题、附件和过程都会留在这里，方便你稍后回来继续。',
  }
}

const ConversationTimeline = memo(function ConversationTimeline({
  collaboration,
  displayMessages,
  isProcessing,
  isPaused,
  isStopping,
  currentThinking,
  pendingAssistantMessage,
  activeLoadingStep,
  messagesViewportRef,
  messagesEndRef,
  onScroll,
  onOpenFilePreview,
  onRespondPermission,
}: {
  collaboration: CollaborationState
  displayMessages: Message[]
  isProcessing: boolean
  isPaused: boolean
  isStopping: boolean
  currentThinking: string
  pendingAssistantMessage: Message | null
  activeLoadingStep: LoadingStep
  messagesViewportRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  onOpenFilePreview: (preview: FilePreviewData) => void
  onRespondPermission: RespondPermissionHandler
}) {
  return (
    <div
      ref={messagesViewportRef}
      onScroll={onScroll}
      className="flex-1 overflow-x-hidden overflow-y-auto px-4 py-5"
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5">
        <CollaborationOverview collaboration={collaboration} />

        {displayMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onOpenFilePreview={onOpenFilePreview}
            onRespondPermission={onRespondPermission}
          />
        ))}

        {isProcessing && currentThinking && (
          <ThinkingIndicator content={currentThinking} />
        )}

        {isProcessing && !isPaused && !isStopping && !currentThinking && !pendingAssistantMessage?.content && !(pendingAssistantMessage?.tools && pendingAssistantMessage.tools.length > 0) && (
          <div className="flex justify-start">
            <div className="chat-processing-card flex max-w-[28rem] items-start gap-3 rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-3 shadow-sm">
              <div className="chat-processing-core mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-accent">
                <Loader2 size={14} className="animate-spin text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{activeLoadingStep.title}</p>
                  <span className="chat-processing-status text-[10px] text-primary">进行中</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {activeLoadingStep.detail}
                </p>
                <div className="chat-processing-rail mt-2" aria-hidden="true">
                  <span />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  )
})

function TeamStackDeck({ teams }: { teams: TeamState[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [detailOpen, setDetailOpen] = useState(false)
  const dialogId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (teams.length === 0) {
      setActiveIndex(0)
      setDetailOpen(false)
      return
    }
    setActiveIndex((current) => Math.min(current, teams.length - 1))
  }, [teams.length])

  useEffect(() => {
    if (!detailOpen) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus) {
        previousFocus.focus()
      } else {
        triggerRef.current?.focus()
      }
    }
  }, [detailOpen])

  if (teams.length === 0) return null

  const wrapIndex = (index: number) => (index + teams.length) % teams.length
  const hasMultipleTeams = teams.length > 1
  const showLeftPreview = teams.length > 2
  const showRightPreview = teams.length > 1
  const activeTeam = teams[activeIndex]
  const previousTeam = teams[wrapIndex(activeIndex - 1)]
  const nextTeam = teams[wrapIndex(activeIndex + 1)]
  const headingId = `${dialogId}-heading`
  const descriptionId = `${dialogId}-description`

  const handlePrev = () => {
    setActiveIndex((current) => wrapIndex(current - 1))
  }

  const handleNext = () => {
    setActiveIndex((current) => wrapIndex(current + 1))
  }

  return (
    <>
      <div className="multi-agent-panel rounded-2xl border border-border/70 bg-background/70 p-3 xl:col-span-2" style={{ animationDelay: '280ms' }}>
        <div className="mb-3 flex items-center gap-2">
          <Users size={14} className="text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">团队</p>
        </div>

        <div className="team-stack-shell">
          {hasMultipleTeams && (
            <button
              type="button"
              onClick={handlePrev}
              className="team-stack-nav team-stack-nav-left"
              aria-label="查看上一个团队"
            >
              <ChevronLeft size={16} />
            </button>
          )}

          <div className="team-stack-stage" data-two-up={teams.length === 2 ? 'true' : undefined}>
            {showLeftPreview && (
              <div className="team-stack-card team-stack-card-left" aria-hidden="true">
                <div className="team-stack-card-top">
                  <span className="team-stack-card-name">{previousTeam.teamName}</span>
                  <span className="team-stack-card-meta">{previousTeam.members.length} 成员</span>
                </div>
              </div>
            )}

            <button
              type="button"
              ref={triggerRef}
              onClick={() => setDetailOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' && hasMultipleTeams) {
                  event.preventDefault()
                  handlePrev()
                }
                if (event.key === 'ArrowRight' && hasMultipleTeams) {
                  event.preventDefault()
                  handleNext()
                }
              }}
              className="team-stack-card team-stack-card-active"
              aria-haspopup="dialog"
              aria-expanded={detailOpen}
              aria-controls={dialogId}
            >
              <div className="team-stack-card-top">
                <span className="team-stack-card-name">{activeTeam.teamName}</span>
                <span className="team-stack-card-meta">{activeTeam.members.length} 成员</span>
              </div>
              <div className="team-stack-card-body">
                <div className="team-stack-card-badge">{getTeamEventLabel(activeTeam)}</div>
                <p className="team-stack-card-summary">{getTeamEventSummary(activeTeam)}</p>
                <div className="team-stack-card-members">
                  {activeTeam.members.slice(0, 4).map((member) => (
                    <span key={`${activeTeam.teamId}-${member}`} className="team-stack-chip">
                      {member}
                    </span>
                  ))}
                  {activeTeam.members.length > 4 && (
                    <span className="team-stack-chip">+{activeTeam.members.length - 4}</span>
                  )}
                </div>
              </div>
              <div className="team-stack-card-foot">
                <span>最近更新 {formatTeamUpdateTime(activeTeam.updatedAt)}</span>
                <span className="inline-flex items-center gap-2">
                  <span>查看详情</span>
                  <span className="team-stack-card-dot" />
                </span>
              </div>
            </button>

            {showRightPreview && (
              <div className="team-stack-card team-stack-card-right" aria-hidden="true">
                <div className="team-stack-card-top">
                  <span className="team-stack-card-name">{nextTeam.teamName}</span>
                  <span className="team-stack-card-meta">{nextTeam.members.length} 成员</span>
                </div>
              </div>
            )}
          </div>

          {hasMultipleTeams && (
            <button
              type="button"
              onClick={handleNext}
              className="team-stack-nav team-stack-nav-right"
              aria-label="查看下一个团队"
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {hasMultipleTeams && (
          <div className="team-stack-dots" aria-label="团队切换进度">
            {teams.map((team, index) => (
              <button
                key={team.teamId}
                type="button"
                onClick={() => setActiveIndex(index)}
                className="team-stack-dot"
                data-active={index === activeIndex ? 'true' : undefined}
                aria-label={`切换到 ${team.teamName}`}
                aria-pressed={index === activeIndex}
              />
            ))}
          </div>
        )}
      </div>

      {detailOpen && (
        <div className="team-stack-dialog-backdrop" role="presentation" onClick={() => setDetailOpen(false)}>
          <div
            className="team-stack-dialog"
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            aria-describedby={descriptionId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="team-stack-dialog-head">
              <div>
                <p className="team-stack-dialog-eyebrow">Agent Team</p>
                <h3 id={headingId} className="team-stack-dialog-title">{activeTeam.teamName}</h3>
              </div>
              <button
                type="button"
                ref={closeButtonRef}
                onClick={() => setDetailOpen(false)}
                className="team-stack-dialog-close"
                aria-label="关闭团队详情"
              >
                <X size={15} />
              </button>
            </div>

            <div className="team-stack-dialog-grid">
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">当前状态</p>
                <div className="team-stack-dialog-badge">{getTeamEventLabel(activeTeam)}</div>
                <p id={descriptionId} className="team-stack-dialog-copy">{getTeamEventSummary(activeTeam)}</p>
              </div>
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">团队规模</p>
                <p className="team-stack-dialog-stat">{activeTeam.members.length}</p>
                <p className="team-stack-dialog-copy">最近更新 {formatTeamUpdateTime(activeTeam.updatedAt)}</p>
              </div>
            </div>

            <div className="team-stack-dialog-panel">
              <p className="team-stack-dialog-label">成员列表</p>
              <div className="team-stack-dialog-members">
                {activeTeam.members.map((member) => (
                  <span key={`${activeTeam.teamId}-detail-${member}`} className="team-stack-chip">
                    {member}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function createEmptyCollaborationState(): CollaborationState {
  return {
    capabilities: {
      subAgents: false,
      tasks: false,
      messaging: false,
      asyncAgent: false,
      teams: false,
    },
    syncAgents: {},
    tasks: {},
    agentMessages: [],
    asyncAgents: {},
    teams: {},
  }
}

function createSyncAgentState(agentId: string, now: number): SyncAgentState {
  return {
    agentId,
    agentName: 'subagent',
    description: '正在执行子 Agent 任务',
    agentType: 'sync',
    parentAgentId: 'main',
    status: 'running',
    deniedTools: [],
    streamText: '',
    eventCount: 0,
    updatedAt: now,
  }
}

function createEmptySessionState(): SessionState {
  return {
    messages: [],
    pendingAssistantId: null,
    isProcessing: false,
    currentThinking: '',
    isPaused: false,
    isStopping: false,
    collaboration: createEmptyCollaborationState(),
  }
}

function createPersistentSessionId(): string {
  return `harnessclaw:session:${globalThis.crypto.randomUUID()}`
}

function normalizeProjectContext(raw: unknown): ProjectContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const projectId = typeof candidate.projectId === 'string'
    ? candidate.projectId
    : typeof candidate.project_id === 'string'
      ? candidate.project_id
      : ''
  const name = typeof candidate.name === 'string' ? candidate.name : ''
  const description = typeof candidate.description === 'string' ? candidate.description : ''
  const createdAt = typeof candidate.createdAt === 'number'
    ? candidate.createdAt
    : typeof candidate.created_at === 'number'
      ? candidate.created_at
      : undefined

  if (!projectId || !name) return null
  return { projectId, name, description, createdAt }
}

function parseProjectContextJson(jsonText: string | null): ProjectContext | null {
  if (!jsonText) return null
  try {
    return normalizeProjectContext(JSON.parse(jsonText))
  } catch {
    return null
  }
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

function stripProjectContextBlock(content: string): string {
  const startIndex = content.indexOf(PROJECT_CONTEXT_BLOCK_START)
  const endIndex = content.indexOf(PROJECT_CONTEXT_BLOCK_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return content

  return `${content.slice(0, startIndex)}${content.slice(endIndex + PROJECT_CONTEXT_BLOCK_END.length)}`.trim()
}

function extractAttachments(content: string): { content: string; attachments: AttachmentItem[] } {
  const withoutProjectContext = stripProjectContextBlock(content)
  const startIndex = withoutProjectContext.indexOf(ATTACHMENT_BLOCK_START)
  const endIndex = withoutProjectContext.indexOf(ATTACHMENT_BLOCK_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { content: withoutProjectContext, attachments: [] }
  }

  const jsonStart = startIndex + ATTACHMENT_BLOCK_START.length
  const jsonText = withoutProjectContext.slice(jsonStart, endIndex).trim()
  const body = withoutProjectContext.slice(0, startIndex).trim()

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function normalizeEventType(type: string): string {
  return type.replace(/\./g, '_')
}

function stringifyToolPayload(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getToolEventName(source: Record<string, unknown>): string | undefined {
  if (typeof source.name === 'string' && source.name) return source.name
  if (typeof source.tool_name === 'string' && source.tool_name) return source.tool_name
  return undefined
}

function getToolEventCallId(source: Record<string, unknown>): string | undefined {
  if (typeof source.call_id === 'string' && source.call_id) return source.call_id
  if (typeof source.tool_use_id === 'string' && source.tool_use_id) return source.tool_use_id
  if (typeof source.request_id === 'string' && source.request_id) return source.request_id
  return undefined
}

function getToolCallEventContent(source: Record<string, unknown>): string {
  if ('arguments' in source) return stringifyToolPayload(source.arguments)
  if ('input' in source) return stringifyToolPayload(source.input)
  if (typeof source.tool_input === 'string') return source.tool_input
  if (typeof source.content === 'string') return source.content
  return ''
}

function getToolResultEventContent(source: Record<string, unknown>): string {
  if (typeof source.output === 'string') return source.output
  if (typeof source.content === 'string') return source.content
  return ''
}

function getToolDurationMs(source: Record<string, unknown>): number | undefined {
  return typeof source.duration_ms === 'number' && Number.isFinite(source.duration_ms)
    ? source.duration_ms
    : undefined
}

function getToolRenderHint(source: Record<string, unknown>): string | undefined {
  return typeof source.render_hint === 'string' && source.render_hint ? source.render_hint : undefined
}

function getToolLanguage(source: Record<string, unknown>): string | undefined {
  return typeof source.language === 'string' && source.language ? source.language : undefined
}

function getToolFilePath(source: Record<string, unknown>): string | undefined {
  return typeof source.file_path === 'string' && source.file_path ? source.file_path : undefined
}

function getToolMetadata(source: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(source.metadata) ? source.metadata : undefined
}

function summarizeInlineText(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function createSubagentInfo(agentId: string, agentName: string, status = 'running'): SubagentInfo {
  return {
    taskId: agentId,
    label: agentName || 'subagent',
    status,
  }
}

function createTaskStatusPayload(task: {
  taskId: string
  subject: string
  status: CollaborationTask['status']
  owner?: string
  activeForm?: string
  scopeId?: string
}): PersistedTaskStatusPayload {
  return {
    kind: 'task_event',
    taskId: task.taskId,
    subject: task.subject,
    status: task.status,
    owner: task.owner,
    activeForm: task.activeForm,
    scopeId: task.scopeId,
    summary:
      task.status === 'in_progress'
        ? `任务进行中 · ${task.activeForm || task.subject}${task.owner ? ` · ${task.owner}` : ''}`
        : task.status === 'completed'
          ? `任务已完成 · ${task.subject}${task.owner ? ` · ${task.owner}` : ''}`
          : task.status === 'deleted'
            ? `任务已移除 · ${task.subject}`
            : `任务已创建 · ${task.subject}`,
  }
}

function createRoutedAgentStatusPayload(agent: {
  agentId: string
  agentName: string
  description?: string
  agentType?: string
}): PersistedRoutedAgentPayload {
  return {
    kind: 'agent_routed',
    agentId: agent.agentId,
    agentName: agent.agentName || 'agent',
    description: agent.description,
    agentType: agent.agentType,
    summary: `已路由到 @${agent.agentName || 'agent'}`,
  }
}

function createAgentMessageStatusPayload(message: {
  id: string
  from: string
  to: string
  summary: string
  teamId?: string
}): PersistedAgentMessagePayload {
  return {
    kind: 'agent_message',
    id: message.id,
    from: message.from || 'unknown',
    to: message.to || '*',
    summary: message.summary || `${message.from || 'Agent'} 发来协作消息`,
    teamId: message.teamId,
  }
}

function createAsyncAgentStatusPayload(agent: {
  agentId: string
  agentName: string
  description: string
  agentType: string
  parentAgentId: string
  status: AsyncAgentState['status']
  durationMs?: number
  errorType?: string
  errorMessage?: string
}): PersistedAsyncAgentStatusPayload {
  const summary = agent.status === 'running'
    ? `${agent.agentName || 'agent'} 已启动`
    : agent.status === 'idle'
      ? `${agent.agentName || 'agent'} 进入等待`
      : agent.status === 'completed'
        ? `${agent.agentName || 'agent'} 已完成`
        : `${agent.agentName || 'agent'} 执行失败`

  return {
    kind: 'async_agent_event',
    agentId: agent.agentId,
    agentName: agent.agentName || 'agent',
    description: agent.description,
    agentType: agent.agentType,
    parentAgentId: agent.parentAgentId,
    status: agent.status,
    durationMs: agent.durationMs,
    errorType: agent.errorType,
    errorMessage: agent.errorMessage,
    summary: agent.errorMessage ? `${summary} · ${agent.errorMessage}` : summary,
  }
}

function createTeamStatusPayload(team: {
  teamId: string
  teamName?: string
  members: string[]
  lastEvent: TeamState['lastEvent']
  memberName?: string
  memberType?: string
}): PersistedTeamStatusPayload {
  const resolvedName = team.teamName || team.teamId
  const summary = team.lastEvent === 'member_join'
    ? `${team.memberName || '新成员'} 加入了 ${resolvedName}`
    : team.lastEvent === 'member_left'
      ? `${team.memberName || '成员'} 离开了 ${resolvedName}`
      : team.lastEvent === 'deleted'
        ? `${resolvedName} 已归档`
        : `${resolvedName} 已建立`

  return {
    kind: 'team_event',
    teamId: team.teamId,
    teamName: team.teamName,
    members: team.members,
    lastEvent: team.lastEvent,
    memberName: team.memberName,
    memberType: team.memberType,
    summary,
  }
}

function parseTaskStatusPayload(raw: string): PersistedTaskStatusPayload | null {
  const parsed = parseJsonObject(raw)
  if (!parsed || parsed.kind !== 'task_event') return null
  const taskId = typeof parsed.taskId === 'string' ? parsed.taskId : ''
  const subject = typeof parsed.subject === 'string' ? parsed.subject : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
  if (!taskId || !subject || !summary) return null
  const status = parsed.status === 'in_progress' || parsed.status === 'completed' || parsed.status === 'deleted'
    ? parsed.status
    : 'pending'
  return {
    kind: 'task_event',
    taskId,
    subject,
    status,
    owner: typeof parsed.owner === 'string' ? parsed.owner : undefined,
    activeForm: typeof parsed.activeForm === 'string' ? parsed.activeForm : undefined,
    scopeId: typeof parsed.scopeId === 'string' ? parsed.scopeId : undefined,
    summary,
  }
}

function parsePersistedCollaborationStatusPayload(raw: string): PersistedCollaborationStatusPayload | null {
  const parsed = parseJsonObject(raw)
  if (!parsed || typeof parsed.kind !== 'string') return null

  if (parsed.kind === 'task_event') {
    return parseTaskStatusPayload(raw)
  }

  if (parsed.kind === 'agent_routed') {
    const agentId = typeof parsed.agentId === 'string' ? parsed.agentId : ''
    const agentName = typeof parsed.agentName === 'string' ? parsed.agentName : ''
    const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
    if (!agentId || !agentName || !summary) return null
    return {
      kind: 'agent_routed',
      agentId,
      agentName,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      agentType: typeof parsed.agentType === 'string' ? parsed.agentType : undefined,
      summary,
    }
  }

  if (parsed.kind === 'agent_message') {
    const id = typeof parsed.id === 'string' ? parsed.id : ''
    const from = typeof parsed.from === 'string' ? parsed.from : ''
    const to = typeof parsed.to === 'string' ? parsed.to : ''
    const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
    if (!id || !from || !to || !summary) return null
    return {
      kind: 'agent_message',
      id,
      from,
      to,
      summary,
      teamId: typeof parsed.teamId === 'string' ? parsed.teamId : undefined,
    }
  }

  if (parsed.kind === 'async_agent_event') {
    const agentId = typeof parsed.agentId === 'string' ? parsed.agentId : ''
    const agentName = typeof parsed.agentName === 'string' ? parsed.agentName : ''
    const description = typeof parsed.description === 'string' ? parsed.description : ''
    const agentType = typeof parsed.agentType === 'string' ? parsed.agentType : 'async'
    const parentAgentId = typeof parsed.parentAgentId === 'string' ? parsed.parentAgentId : 'main'
    const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
    const status = parsed.status === 'running' || parsed.status === 'idle' || parsed.status === 'completed' || parsed.status === 'failed'
      ? parsed.status
      : null
    if (!agentId || !agentName || !status || !summary) return null
    return {
      kind: 'async_agent_event',
      agentId,
      agentName,
      description,
      agentType,
      parentAgentId,
      status,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      errorType: typeof parsed.errorType === 'string' ? parsed.errorType : undefined,
      errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : undefined,
      summary,
    }
  }

  if (parsed.kind === 'team_event') {
    const teamId = typeof parsed.teamId === 'string' ? parsed.teamId : ''
    const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
    const lastEvent = parsed.lastEvent === 'created' || parsed.lastEvent === 'member_join' || parsed.lastEvent === 'member_left' || parsed.lastEvent === 'deleted'
      ? parsed.lastEvent
      : null
    if (!teamId || !lastEvent || !summary) return null
    return {
      kind: 'team_event',
      teamId,
      teamName: typeof parsed.teamName === 'string' ? parsed.teamName : undefined,
      members: asStringArray(parsed.members),
      lastEvent,
      memberName: typeof parsed.memberName === 'string' ? parsed.memberName : undefined,
      memberType: typeof parsed.memberType === 'string' ? parsed.memberType : undefined,
      summary,
    }
  }

  return null
}

function applyPersistedCollaborationStatus(
  collaboration: CollaborationState,
  payload: PersistedCollaborationStatusPayload,
  timestamp: number,
) {
  if (payload.kind === 'task_event') {
    collaboration.capabilities.tasks = true
    if (payload.status === 'deleted') {
      delete collaboration.tasks[payload.taskId]
      return
    }

    collaboration.tasks[payload.taskId] = {
      taskId: payload.taskId,
      subject: payload.subject,
      status: payload.status,
      owner: payload.owner,
      activeForm: payload.activeForm,
      scopeId: payload.scopeId,
      updatedAt: timestamp,
    }
    return
  }

  if (payload.kind === 'agent_routed') {
    collaboration.routedAgent = {
      agentId: payload.agentId,
      agentName: payload.agentName,
      description: payload.description || '',
      agentType: payload.agentType || '',
      updatedAt: timestamp,
    }
    return
  }

  if (payload.kind === 'agent_message') {
    collaboration.capabilities.messaging = true
    collaboration.agentMessages = [
      ...collaboration.agentMessages,
      {
        id: payload.id,
        from: payload.from,
        to: payload.to,
        summary: payload.summary,
        teamId: payload.teamId,
        ts: timestamp,
      },
    ].slice(-8)
    return
  }

  if (payload.kind === 'async_agent_event') {
    collaboration.capabilities.asyncAgent = true
    collaboration.asyncAgents[payload.agentId] = {
      agentId: payload.agentId,
      agentName: payload.agentName,
      description: payload.description,
      agentType: payload.agentType,
      parentAgentId: payload.parentAgentId,
      status: payload.status,
      durationMs: payload.durationMs,
      errorType: payload.errorType,
      errorMessage: payload.errorMessage,
      updatedAt: timestamp,
    }
    return
  }

  collaboration.capabilities.teams = true
  if (payload.lastEvent === 'deleted') {
    delete collaboration.teams[payload.teamId]
    return
  }

  const previous = collaboration.teams[payload.teamId]
  collaboration.teams[payload.teamId] = {
    teamId: payload.teamId,
    teamName: payload.teamName || previous?.teamName || payload.teamId,
    members: payload.members.length > 0 ? payload.members : previous?.members || [],
    lastEvent: payload.lastEvent,
    memberName: payload.memberName,
    memberType: payload.memberType,
    updatedAt: timestamp,
  }
}

function inferLegacyCollaborationFromMessages(messages: Message[]): CollaborationState {
  const collaboration = createEmptyCollaborationState()
  let currentTeamId = ''

  for (const message of messages) {
    for (const tool of message.tools || []) {
      if (tool.type !== 'call' && tool.type !== 'result') continue

      if (tool.name === 'TeamCreate') {
        const args = tool.type === 'call' ? parseJsonObject(tool.content) : null
        const fromResult = tool.type === 'result'
          ? tool.content.match(/team "([^"]+)"/)?.[1]
          : ''
        const teamName = typeof args?.team_name === 'string' && args.team_name.trim()
          ? args.team_name.trim()
          : fromResult || 'Agent Team'
        const teamId = `legacy-team:${teamName}`
        const existing = collaboration.teams[teamId]

        currentTeamId = teamId
        collaboration.capabilities.teams = true
        collaboration.teams[teamId] = {
          teamId,
          teamName,
          members: existing?.members || [],
          lastEvent: 'created',
          updatedAt: tool.ts,
        }
        continue
      }

      if (tool.name === 'Agent' && tool.type === 'call') {
        const args = parseJsonObject(tool.content)
        const agentName = typeof args?.name === 'string' && args.name.trim()
          ? args.name.trim()
          : typeof args?.description === 'string' && args.description.trim()
            ? args.description.trim()
            : 'agent'
        const teamId = currentTeamId || Object.keys(collaboration.teams)[0] || 'legacy-team:Agent Team'
        const previous = collaboration.teams[teamId]
        const teamName = previous?.teamName || (teamId.startsWith('legacy-team:') ? teamId.slice('legacy-team:'.length) : 'Agent Team')
        const members = previous?.members ? [...previous.members] : []

        if (!members.includes(agentName)) {
          members.push(agentName)
        }

        collaboration.capabilities.teams = true
        collaboration.teams[teamId] = {
          teamId,
          teamName,
          members,
          lastEvent: 'member_join',
          memberName: agentName,
          memberType: typeof args?.subagent_type === 'string' ? args.subagent_type : undefined,
          updatedAt: tool.ts,
        }
      }
    }
  }

  return collaboration
}

function mergeLegacyCollaborationFallback(
  collaboration: CollaborationState,
  messages: Message[],
): CollaborationState {
  if (Object.keys(collaboration.teams).length > 0) {
    return collaboration
  }

  const legacy = inferLegacyCollaborationFromMessages(messages)
  if (Object.keys(legacy.teams).length === 0) {
    return collaboration
  }

  return {
    ...collaboration,
    capabilities: {
      ...collaboration.capabilities,
      teams: collaboration.capabilities.teams || legacy.capabilities.teams,
    },
    teams: legacy.teams,
  }
}

function getPersistedStatusTone(payload: PersistedCollaborationStatusPayload): 'error' | 'running' | 'neutral' | 'done' {
  if (payload.kind === 'task_event') {
    if (payload.status === 'in_progress') return 'running'
    if (payload.status === 'deleted' || payload.status === 'pending') return 'neutral'
    return 'done'
  }

  if (payload.kind === 'async_agent_event') {
    if (payload.status === 'failed') return 'error'
    if (payload.status === 'running') return 'running'
    if (payload.status === 'idle') return 'neutral'
    return 'done'
  }

  if (payload.kind === 'team_event') {
    return payload.lastEvent === 'deleted' ? 'neutral' : 'done'
  }

  return 'done'
}

function inferCollaborationFromMessages(messages: Message[]): CollaborationState {
  const collaboration = createEmptyCollaborationState()
  const statusTools = messages
    .flatMap((message) => message.tools || [])
    .filter((tool) => tool.type === 'status')
    .sort((left, right) => left.ts - right.ts)

  for (const tool of statusTools) {
    const payload = parsePersistedCollaborationStatusPayload(tool.content)
    if (!payload) continue
    applyPersistedCollaborationStatus(collaboration, payload, tool.ts)
  }

  return collaboration
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

function getFileLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript (JSX)', js: 'JavaScript', jsx: 'JavaScript (JSX)',
    py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin',
    swift: 'Swift', c: 'C', cpp: 'C++', h: 'C Header', hpp: 'C++ Header',
    cs: 'C#', php: 'PHP', lua: 'Lua', sh: 'Shell', bash: 'Bash', zsh: 'Zsh',
    sql: 'SQL', html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
    json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
    md: 'Markdown', mdx: 'MDX', txt: 'Text', csv: 'CSV',
    vue: 'Vue', svelte: 'Svelte', dart: 'Dart', r: 'R',
    dockerfile: 'Dockerfile', makefile: 'Makefile',
    graphql: 'GraphQL', proto: 'Protobuf', prisma: 'Prisma',
  }
  return map[ext] || ''
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatTeamUpdateTime(timestamp: number): string {
  const target = new Date(timestamp)
  const now = new Date()
  const isSameDay = target.toDateString() === now.toDateString()
  return target.toLocaleString('zh-CN', isSameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function findAttachableAssistantMessageIndex(
  messages: Message[],
  referenceTs: number,
  preferredId?: string | null,
): number {
  if (preferredId) {
    const preferredIndex = messages.findIndex((message) => message.id === preferredId)
    if (preferredIndex >= 0) return preferredIndex
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') break
    if (message.role !== 'assistant') continue
    if (referenceTs - message.timestamp > ERROR_ATTACH_WINDOW_MS) break
    return index
  }

  return -1
}

function isVisualErrorOnlyAssistantMessage(message: Message): boolean {
  return message.role === 'assistant'
    && !!message.systemNotice
    && !message.content.trim()
    && !message.attachments?.length
    && !message.tools?.length
    && !(message.contentSegments || []).some((segment) => segment.text.trim())
}

function compactMessagesForDisplay(messages: Message[]): Message[] {
  const compacted: Message[] = []

  for (const message of messages) {
    if (isVisualErrorOnlyAssistantMessage(message) && compacted.length > 0) {
      const previous = compacted[compacted.length - 1]
      if (
        previous.role === 'assistant'
        && message.timestamp - previous.timestamp <= ERROR_ATTACH_WINDOW_MS
      ) {
        compacted[compacted.length - 1] = {
          ...previous,
          systemNotice: message.systemNotice,
          timestamp: message.timestamp,
          isStreaming: false,
        }
        continue
      }
    }

    compacted.push(message)
  }

  return compacted
}

function extractFilePreviewData(call: ToolActivity, result?: ToolActivity): FilePreviewData | null {
  if (call.type !== 'call') return null
  if (call.name !== 'read_file' && call.name !== 'write_file' && call.name !== 'Read' && call.name !== 'Write') return null

  const args = parseJsonObject(call.content)
  const path = typeof args?.path === 'string'
    ? args.path
    : result?.filePath || ''
  if (!path) return null

  const directContent = typeof args?.content === 'string' ? args.content : ''
  const limit = typeof args?.limit === 'number' ? args.limit : undefined
  const content = call.name === 'write_file' || call.name === 'Write'
    ? (directContent || result?.content || '')
    : (result?.content || '')

  return {
    path,
    fileName: getFileName(path),
    operation: call.name === 'read_file' || call.name === 'Read' ? 'read_file' : 'write_file',
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
    Bash: '命令执行',
    Read: '读取文件',
    Edit: '编辑文件',
    Write: '写入文件',
    Grep: '内容搜索',
    Glob: '文件匹配',
    WebFetch: '网页抓取',
    WebSearch: '在线搜索',
    TavilySearch: 'Tavily 搜索',
    Agent: '子 Agent',
    Skill: '技能执行',
    TaskCreate: '创建任务',
    TaskGet: '查询任务',
    TaskUpdate: '更新任务',
    TaskList: '任务列表',
    SendMessage: '发送消息',
    TeamCreate: '创建团队',
    TeamDelete: '删除团队',
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

function formatDurationMs(durationMs?: number): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return ''
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function getToolRenderHintLabel(renderHint?: string): string {
  const labels: Record<string, string> = {
    terminal: '终端输出',
    code: '代码内容',
    diff: '变更对比',
    file_info: '文件结果',
    search: '搜索结果',
    markdown: 'Markdown',
    agent: 'Agent 输出',
    skill: '技能结果',
    task: '任务结果',
    message: '消息结果',
    team: '团队结果',
    plain: '文本结果',
  }
  if (!renderHint) return '文本结果'
  return labels[renderHint] || renderHint
}

function getToolResultSummary(call: ToolActivity, result?: ToolActivity, filePreview?: FilePreviewData | null): string {
  if (!result) return 'Agent 正在执行这个步骤。'
  if (filePreview) return `涉及文件 ${filePreview.fileName}`
  if (result.filePath) return `关联文件 ${getFileName(result.filePath)}`
  if (result.renderHint === 'search') return '已返回搜索结果摘要。'
  if (result.renderHint === 'markdown') return '已抓取并整理为 Markdown 内容。'
  if (result.renderHint === 'terminal') return result.isError ? '命令执行返回错误输出。' : '命令执行已完成。'
  if (result.renderHint === 'agent') return result.isError ? '子 Agent 执行失败。' : '子 Agent 已返回摘要。'
  if (result.isError) return '这个步骤没有顺利完成。'
  if (call.name === 'Write' || call.name === 'write_file') return '文件写入已完成。'
  if (call.name === 'Edit') return '文件变更已生成。'
  return '这个步骤已执行完成。'
}

function getTaskStatusLabel(status: CollaborationTask['status']): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'completed') return '已完成'
  if (status === 'deleted') return '已移除'
  return '待处理'
}

function getTaskStatusClasses(status: CollaborationTask['status']): string {
  if (status === 'in_progress') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'deleted') return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
}

function getSyncAgentStatusLabel(status: SyncAgentState['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'completed') return '已完成'
  if (status === 'max_turns') return '达到轮次上限'
  if (status === 'model_error') return '模型错误'
  if (status === 'aborted') return '已中止'
  if (status === 'timeout') return '已超时'
  return '失败'
}

function getSyncAgentStatusClasses(status: SyncAgentState['status']): string {
  if (status === 'running') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
}

function getSyncAgentToolStatusClasses(status?: SyncAgentState['activeToolStatus']): string {
  if (status === 'running') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'error') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
}

function getAsyncAgentStatusLabel(status: AsyncAgentState['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'idle') return '等待中'
  if (status === 'completed') return '已完成'
  return '失败'
}

function getAsyncAgentStatusClasses(status: AsyncAgentState['status']): string {
  if (status === 'running') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (status === 'idle') return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
}

function getSubagentVisualStatus(status?: string): 'running' | 'completed' | 'failed' {
  if (status === 'running') return 'running'
  if (status === 'completed' || status === 'ok' || status === 'success') return 'completed'
  return 'failed'
}

function getTeamEventLabel(team: TeamState): string {
  if (team.lastEvent === 'member_join') return '成员加入'
  if (team.lastEvent === 'member_left') return '成员离开'
  if (team.lastEvent === 'deleted') return '团队已归档'
  return '团队已建立'
}

function getTeamEventSummary(team: TeamState): string {
  if (team.memberName) {
    return `${team.memberName}${team.lastEvent === 'member_left' ? ' 已离开' : team.lastEvent === 'member_join' ? ' 已加入' : ' 发生变更'}`
  }
  if (team.lastEvent === 'deleted') return '这个团队当前不再接收新的协作消息。'
  return '团队成员保持在当前编组中。'
}

// ─── Chat Page ──────────────────────────────────────────────────────────────

export function ChatPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const initialMessage = location.state?.initialMessage || ''
  const initialAttachments = (location.state?.initialAttachments || []) as AttachmentItem[]
  const selectedSessionIdFromRoute = typeof location.state?.sessionId === 'string' ? location.state.sessionId : ''
  const createSessionOnOpen = location.state?.createSession === true
  const routeProjectContext = useMemo(() => normalizeProjectContext(location.state?.projectContext), [location.state])
  const [sessionMap, setSessionMap] = useState<Record<string, SessionState>>({})
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sessionProjectContexts, setSessionProjectContexts] = useState<Record<string, ProjectContext>>({})
  const [filePreview, setFilePreview] = useState<FilePreviewData | null>(null)
  const [input, setInput] = useState(initialMessage)
  const [selectedSkills, setSelectedSkills] = useState<SelectedSkillChip[]>([])
  const [attachments, setAttachments] = useState<AttachmentItem[]>(initialAttachments)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [harnessclawStatus, setHarnessclawStatus] = useState<HarnessclawStatus>('disconnected')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [sendBurstActive, setSendBurstActive] = useState(false)
  const [dropBurstActive, setDropBurstActive] = useState(false)
  const pasted = usePastedBlocks()
  const messagesViewportRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const isNearBottomRef = useRef(true)
  const sendBurstTimerRef = useRef<number | null>(null)
  const dropBurstTimerRef = useRef<number | null>(null)
  const pendingInitialTurn = useRef<{ content: string; attachments: AttachmentItem[] } | null>(
    initialMessage || initialAttachments.length > 0
      ? { content: initialMessage, attachments: initialAttachments }
      : null
  )
  const initialTurnHandledKeyRef = useRef<string | null>(
    initialMessage || initialAttachments.length > 0 ? location.key : null
  )
  const createSessionOnOpenHandledKeyRef = useRef<string | null>(null)
  // Track pendingAssistantId per session in a ref map
  const pendingAssistantIds = useRef<Record<string, string | null>>({})
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const maxLength = 4000

  const [dbSessions, setDbSessions] = useState<DbSessionRow[]>([])
  const emptyGreeting = useMemo(() => getChatGreeting(), [])
  const composerPayload = useMemo(() => buildSkillComposerPayload(input, selectedSkills), [input, selectedSkills])
  const canSend = !!composerPayload || attachments.length > 0 || pasted.blocks.length > 0

  // Get or create session state
  const getSession = useCallback((sid: string): SessionState => {
    return sessionMap[sid] || createEmptySessionState()
  }, [sessionMap])

  // Update a specific session's state
  const updateSession = useCallback((sid: string, updater: (prev: SessionState) => SessionState) => {
    setSessionMap((prev) => ({
      ...prev,
      [sid]: updater(prev[sid] || createEmptySessionState()),
    }))
  }, [])

  const ensureLocalSession = useCallback((sid?: string, context: ProjectContext | null = routeProjectContext) => {
    const resolvedSessionId = sid || createPersistentSessionId()
    setSessionMap((prev) => ({
      ...prev,
      [resolvedSessionId]: prev[resolvedSessionId] || createEmptySessionState(),
    }))
    setActiveSessionId(resolvedSessionId)
    navigate('/chat', { replace: true, state: { sessionId: resolvedSessionId } })
    if (context) {
      setSessionProjectContexts((prev) => ({
        ...prev,
        [resolvedSessionId]: context,
      }))
      void window.db.createProjectSession({
        sessionId: resolvedSessionId,
        projectId: context.projectId,
      })
    } else {
      void window.db.createSession(resolvedSessionId)
    }
    return resolvedSessionId
  }, [navigate, routeProjectContext])

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

  const updateCollaboration = useCallback((sid: string, updater: (prev: CollaborationState) => CollaborationState) => {
    updateSession(sid, (prev) => ({
      ...prev,
      collaboration: updater(prev.collaboration || createEmptyCollaborationState()),
    }))
  }, [updateSession])

  const activeSession = getSession(activeSessionId)
  const hasActiveSessionMessages = activeSession.messages.some((message) => message.role !== 'system')
  const hasDraftComposerState = Boolean(input.trim()) || attachments.length > 0 || selectedSkills.length > 0
  const isActiveSessionPristine =
    Boolean(activeSessionId)
    && !hasActiveSessionMessages
    && !activeSession.isProcessing
    && !activeSession.isPaused
    && !activeSession.isStopping
    && !activeSession.currentThinking
    && !hasDraftComposerState
  const shouldRotatePreparation = activeSession.isProcessing && !activeSession.isPaused && !activeSession.isStopping && !activeSession.currentThinking
  const loadingNow = useSharedNowTicker(shouldRotatePreparation, 1800)
  const activeLoadingStep = CHAT_LOADING_STEPS[Math.floor(loadingNow / 1800) % CHAT_LOADING_STEPS.length]
  const pendingAssistantMessage = useMemo(() => {
    const pendingAssistantId = pendingAssistantIds.current[activeSessionId]
    if (!pendingAssistantId) return null
    return activeSession.messages.find((message) => message.id === pendingAssistantId) || null
  }, [activeSession.messages, activeSessionId])
  const displayMessages = useMemo(
    () => compactMessagesForDisplay(activeSession.messages),
    [activeSession.messages],
  )
  const displayCollaboration = useMemo(
    () => mergeLegacyCollaborationFallback(activeSession.collaboration, activeSession.messages),
    [activeSession.collaboration, activeSession.messages],
  )

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
  const activeSessionPromptRaw = activeSessionMeta?.title || activeSessionMeta?.firstMsg || '新对话'
  const activeSessionPrompt = (() => {
    const oneLine = activeSessionPromptRaw.replace(/\n/g, ' ').trim()
    return oneLine.length > 20 ? oneLine.slice(0, 20) + '...' : oneLine
  })()
  const activeProjectContext = activeSessionId ? sessionProjectContexts[activeSessionId] : routeProjectContext
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
          durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : undefined,
          renderHint: t.render_hint || undefined,
          language: t.language || undefined,
          filePath: t.file_path || undefined,
          metadata: t.metadata_json ? parseJsonObject(t.metadata_json) || undefined : undefined,
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
      setSessionProjectContexts({})
      return rows
    }

    setDbSessions(rows)
    setSessions(rows.map((row) => ({ key: row.session_id, updatedAt: new Date(row.updated_at).toLocaleString('zh-CN') })))
    setSessionProjectContexts((prev) => {
      const next = { ...prev }
      for (const row of rows) {
        const context = parseProjectContextJson(row.project_context_json)
        if (context) {
          next[row.session_id] = context
        }
      }
      return next
    })

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
        collaboration: inferCollaborationFromMessages(msgs.length > 0 ? dbRowsToMessages(msgs) : []),
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

  useEffect(() => {
    if (!initialMessage && initialAttachments.length === 0) return
    if (initialTurnHandledKeyRef.current === location.key) return

    initialTurnHandledKeyRef.current = location.key
    pendingInitialTurn.current = {
      content: initialMessage,
      attachments: initialAttachments,
    }
    setInput(initialMessage)
    setAttachments(initialAttachments)
  }, [initialAttachments, initialMessage, location.key])

  const handleSwitchSession = useCallback((key: string) => {
    if (!key) return
    if (key !== activeSessionIdRef.current) {
      setActiveSessionId(key)
    }

    void window.db.getMessages(key).then((rows) => {
      setSessionMap((prev) => {
        const existing = prev[key]
        // If the session is already live (processing or has messages from streaming),
        // do NOT overwrite with stale DB data — the live state is more current.
        if (existing && (existing.isProcessing || existing.messages.length > 0)) {
          return prev
        }

        if (rows.length > 0) {
          return {
            ...prev,
            [key]: {
              messages: dbRowsToMessages(rows),
              pendingAssistantId: null,
              isProcessing: false,
              currentThinking: '',
              isPaused: false,
              isStopping: false,
              collaboration: inferCollaborationFromMessages(dbRowsToMessages(rows)),
            },
          }
        }

        if (existing) return prev
        return {
          ...prev,
          [key]: createEmptySessionState(),
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
    if (initialMessage || initialAttachments.length > 0) return
    if (pendingInitialTurn.current) return
    if (activeSessionIdRef.current) return
    if (createSessionOnOpenHandledKeyRef.current === location.key) return

    createSessionOnOpenHandledKeyRef.current = location.key
    ensureLocalSession()
  }, [createSessionOnOpen, initialAttachments.length, initialMessage, selectedSessionIdFromRoute, ensureLocalSession, location.key])

  // Sync Harnessclaw status on mount
  useEffect(() => {
   const offStatus = window.harnessclaw.onStatus((s) => {
     setHarnessclawStatus(s as HarnessclawStatus)
   })

   const offEvent = window.harnessclaw.onEvent((event) => {
     handleHarnessclawEventRef.current(event)
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
    const normalizedType = normalizeEventType(type)
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

    const appendPassiveAssistantActivity = (sid: string, activity: ToolActivity) => {
      updateSession(sid, (prev) => {
        const pendingId = pendingAssistantIds.current[sid]
        if (pendingId) {
          return {
            ...prev,
            messages: prev.messages.map((message) => (
              message.id === pendingId
                ? { ...message, tools: [...(message.tools || []), activity] }
                : message
            )),
          }
        }

        const lastIndex = prev.messages.length - 1
        const lastMessage = prev.messages[lastIndex]
        const canAppendToLast =
          lastMessage
          && lastMessage.role === 'assistant'
          && !lastMessage.isStreaming
          && !lastMessage.content.trim()
          && !lastMessage.systemNotice
          && !(lastMessage.attachments && lastMessage.attachments.length > 0)
          && Date.now() - lastMessage.timestamp < 30_000

        if (canAppendToLast) {
          const nextMessages = [...prev.messages]
          nextMessages[lastIndex] = {
            ...lastMessage,
            timestamp: activity.ts,
            tools: [...(lastMessage.tools || []), activity],
          }
          return {
            ...prev,
            messages: nextMessages,
          }
        }

        return {
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: `ast-collab-${activity.ts}-${prev.messages.length}`,
              role: 'assistant',
              content: '',
              timestamp: activity.ts,
              isStreaming: false,
              tools: [activity],
              contentSegments: [],
            },
          ],
        }
      })
    }

    switch (normalizedType) {
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

      case 'session_created': {
        const sid = eventSessionId
          || (isRecord(event.session) && typeof event.session.session_id === 'string' ? event.session.session_id : '')
        if (!sid) break

        const rawCapabilities = isRecord(event.capabilities)
          ? event.capabilities
          : isRecord(event.session) && isRecord(event.session.capabilities)
            ? event.session.capabilities
            : {}

        updateCollaboration(sid, (prev) => ({
          ...prev,
          capabilities: {
            ...prev.capabilities,
            subAgents: rawCapabilities.sub_agents === true || prev.capabilities.subAgents,
            tasks: rawCapabilities.tasks === true || prev.capabilities.tasks,
            messaging: rawCapabilities.messaging === true || prev.capabilities.messaging,
            asyncAgent: rawCapabilities.async_agent === true || prev.capabilities.asyncAgent,
            teams: rawCapabilities.teams === true || prev.capabilities.teams,
          },
        }))
        break
      }

      case 'subagent_start': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        if (!sid) break
        const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
        if (!agentId) break
        const updatedAt = Date.now()

        updateCollaboration(sid, (prev) => ({
          ...(prev || createEmptyCollaborationState()),
          ...prev,
          capabilities: { ...prev.capabilities, subAgents: true },
          syncAgents: {
            ...prev.syncAgents,
            [agentId]: {
              ...(prev.syncAgents[agentId] || createSyncAgentState(agentId, updatedAt)),
              agentName: typeof event.agent_name === 'string' ? event.agent_name : prev.syncAgents[agentId]?.agentName || 'subagent',
              description: typeof event.description === 'string' ? event.description : prev.syncAgents[agentId]?.description || '正在执行子 Agent 任务',
              agentType: typeof event.agent_type === 'string' ? event.agent_type : prev.syncAgents[agentId]?.agentType || 'sync',
              parentAgentId: typeof event.parent_agent_id === 'string' ? event.parent_agent_id : prev.syncAgents[agentId]?.parentAgentId || 'main',
              status: 'running',
              deniedTools: [],
              activeToolName: undefined,
              activeToolStatus: undefined,
              activeToolSummary: undefined,
              streamText: prev.syncAgents[agentId]?.streamText || '',
              lastEventAt: prev.syncAgents[agentId]?.lastEventAt,
              eventCount: prev.syncAgents[agentId]?.eventCount || 0,
              updatedAt,
            },
          },
        }))
        break
      }

      case 'subagent_event': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        if (!sid) break
        const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
        if (!agentId) break
        const agentName = typeof event.agent_name === 'string' ? event.agent_name : 'subagent'
        const payload = isRecord(event.payload) ? event.payload : {}
        const eventType = typeof payload.event_type === 'string' ? payload.event_type : ''
        if (!eventType) break
        const now = Date.now()
        const subagentInfo = createSubagentInfo(agentId, agentName, 'running')

        updateCollaboration(sid, (prev) => {
          const existing = prev.syncAgents[agentId] || createSyncAgentState(agentId, now)
          const nextState: SyncAgentState = {
            ...existing,
            agentName: agentName || existing.agentName,
            status: existing.status === 'completed' ? 'running' : existing.status,
            lastEventAt: now,
            updatedAt: now,
            eventCount: existing.eventCount + 1,
          }

          if (eventType === 'text') {
            const text = typeof payload.text === 'string' ? payload.text : ''
            nextState.streamText = `${existing.streamText}${text}`.slice(-2000)
            nextState.activeToolName = undefined
            nextState.activeToolStatus = undefined
            nextState.activeToolSummary = summarizeInlineText(text, 90) || existing.activeToolSummary
          } else if (eventType === 'tool_start') {
            nextState.activeToolName = getToolEventName(payload) || existing.activeToolName
            nextState.activeToolStatus = 'running'
            nextState.activeToolSummary = summarizeInlineText(getToolCallEventContent(payload), 90) || '准备执行工具'
          } else if (eventType === 'tool_end') {
            nextState.activeToolName = getToolEventName(payload) || existing.activeToolName
            nextState.activeToolStatus = payload.is_error === true ? 'error' : 'completed'
            nextState.activeToolSummary = summarizeInlineText(getToolResultEventContent(payload), 90) || (payload.is_error === true ? '工具执行失败' : '工具执行完成')
          }

          return {
            ...prev,
            capabilities: { ...prev.capabilities, subAgents: true },
            syncAgents: {
              ...prev.syncAgents,
              [agentId]: nextState,
            },
          }
        })

        if (eventType === 'text') {
          const aid = ensureAssistantMessage(sid, now)
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text) break
          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => {
              if (m.id !== aid) return m
              const segments = m.contentSegments || []
              const moduleKey = getModuleKey(subagentInfo)
              const lastSegIndex = [...segments].reverse().findIndex((seg) => getModuleKey(seg.subagent) === moduleKey)
              const resolvedLastSegIndex = lastSegIndex === -1 ? -1 : segments.length - 1 - lastSegIndex
              const lastSeg = resolvedLastSegIndex >= 0 ? segments[resolvedLastSegIndex] : undefined
              const lastRelatedToolTs = Math.max(
                0,
                ...(m.tools || [])
                  .filter((tool) => getModuleKey(tool.subagent) === moduleKey)
                  .map((tool) => tool.ts),
              )

              if (lastSeg && lastRelatedToolTs > lastSeg.ts) {
                return { ...m, content: m.content + text, contentSegments: [...segments, { text, ts: now, subagent: subagentInfo }] }
              }

              if (lastSeg && isSameSubagent(lastSeg.subagent, subagentInfo)) {
                const updated = [...segments]
                updated[resolvedLastSegIndex] = { ...lastSeg, text: lastSeg.text + text, ts: lastSeg.ts }
                return { ...m, content: m.content + text, contentSegments: updated }
              }

              return { ...m, content: m.content + text, contentSegments: [...segments, { text, ts: now, subagent: subagentInfo }] }
            }),
          }))
          break
        }

        if (eventType === 'tool_start' || eventType === 'tool_end') {
          const aid = ensureAssistantMessage(sid, now)
          const callId = typeof payload.tool_use_id === 'string' && payload.tool_use_id
            ? payload.tool_use_id
            : `${agentId}-${typeof event.event_id === 'string' ? event.event_id : now}`

          const activity: ToolActivity = eventType === 'tool_start'
            ? {
                type: 'call',
                name: getToolEventName(payload) || 'tool',
                content: getToolCallEventContent(payload),
                callId,
                ts: now,
                subagent: subagentInfo,
              }
            : {
                type: 'result',
                name: getToolEventName(payload) || 'tool',
                content: getToolResultEventContent(payload),
                callId,
                isError: payload.is_error === true,
                durationMs: getToolDurationMs(payload),
                renderHint: getToolRenderHint(payload),
                language: getToolLanguage(payload),
                filePath: getToolFilePath(payload),
                metadata: getToolMetadata(payload),
                ts: now,
                subagent: subagentInfo,
              }

          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
          }))
        }
        break
      }

      case 'subagent_end': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        if (!sid) break
        const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
        if (!agentId) break
        const rawStatus = typeof event.status === 'string' ? event.status : 'completed'
        const status = rawStatus === 'completed' || rawStatus === 'max_turns' || rawStatus === 'model_error' || rawStatus === 'aborted' || rawStatus === 'timeout'
          ? rawStatus
          : 'error'
        const updatedAt = Date.now()

        updateCollaboration(sid, (prev) => ({
          ...prev,
          capabilities: { ...prev.capabilities, subAgents: true },
          syncAgents: {
            ...prev.syncAgents,
            [agentId]: {
              ...(prev.syncAgents[agentId] || createSyncAgentState(agentId, updatedAt)),
              agentName: typeof event.agent_name === 'string' ? event.agent_name : prev.syncAgents[agentId]?.agentName || 'subagent',
              description: prev.syncAgents[agentId]?.description || '',
              agentType: prev.syncAgents[agentId]?.agentType || 'sync',
              parentAgentId: prev.syncAgents[agentId]?.parentAgentId || 'main',
              status,
              durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : prev.syncAgents[agentId]?.durationMs,
              numTurns: typeof event.num_turns === 'number' ? event.num_turns : prev.syncAgents[agentId]?.numTurns,
              deniedTools: asStringArray(event.denied_tools),
              streamText: prev.syncAgents[agentId]?.streamText || '',
              activeToolName: prev.syncAgents[agentId]?.activeToolName,
              activeToolStatus: prev.syncAgents[agentId]?.activeToolStatus,
              activeToolSummary: prev.syncAgents[agentId]?.activeToolSummary,
              lastEventAt: prev.syncAgents[agentId]?.lastEventAt,
              eventCount: prev.syncAgents[agentId]?.eventCount || 0,
              updatedAt,
            },
          },
        }))

        const aid = ensureAssistantMessage(sid, updatedAt)
        const finalSubagentInfo = createSubagentInfo(
          agentId,
          typeof event.agent_name === 'string' ? event.agent_name : 'subagent',
          status,
        )
        const statusActivity: ToolActivity = {
          type: 'status',
          name: 'subagent_end',
          content: getSubagentVisualStatus(status) === 'failed' ? '子 Agent 执行失败' : '子 Agent 执行完成',
          ts: updatedAt,
          subagent: finalSubagentInfo,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((message) => (
            message.id === aid
              ? { ...message, tools: [...(message.tools || []), statusActivity] }
              : message
          )),
        }))
        break
      }

      case 'agent_routed': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        if (!sid) break
        const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
        if (!agentId) break
        const now = Date.now()
        const payload = createRoutedAgentStatusPayload({
          agentId,
          agentName: typeof event.agent_name === 'string' ? event.agent_name : 'agent',
          description: typeof event.description === 'string' ? event.description : '',
          agentType: typeof event.agent_type === 'string' ? event.agent_type : '',
        })

        updateCollaboration(sid, (prev) => ({
          ...prev,
          routedAgent: {
            agentId,
            agentName: payload.agentName,
            description: payload.description || '',
            agentType: payload.agentType || '',
            updatedAt: now,
          },
        }))
        appendPassiveAssistantActivity(sid, {
          type: 'status',
          name: 'agent_routed',
          content: JSON.stringify(payload),
          ts: now,
        })
        break
      }

      case 'task_created':
      case 'task_updated': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        const task = isRecord(event.task) ? event.task : {}
        const taskId = typeof task.task_id === 'string' ? task.task_id : ''
        if (!sid || !taskId) break
        const status = task.status === 'in_progress' || task.status === 'completed' || task.status === 'deleted'
          ? task.status
          : 'pending'

        updateCollaboration(sid, (prev) => {
          const nextTasks = { ...prev.tasks }
          if (status === 'deleted') {
            delete nextTasks[taskId]
          } else {
            nextTasks[taskId] = {
              taskId,
              subject: typeof task.subject === 'string' ? task.subject : '未命名任务',
              status,
              owner: typeof task.owner === 'string' ? task.owner : undefined,
              activeForm: typeof task.active_form === 'string' ? task.active_form : undefined,
              scopeId: typeof task.scope_id === 'string' ? task.scope_id : undefined,
              updatedAt: Date.now(),
            }
          }
          return {
            ...prev,
            capabilities: { ...prev.capabilities, tasks: true },
            tasks: nextTasks,
          }
        })

        const now = Date.now()
        const subject = typeof task.subject === 'string' ? task.subject : '未命名任务'
        const owner = typeof task.owner === 'string' ? task.owner : ''
        const activeForm = typeof task.active_form === 'string' ? task.active_form : ''
        const payload = createTaskStatusPayload({
          taskId,
          subject,
          status,
          owner: owner || undefined,
          activeForm: activeForm || undefined,
          scopeId: typeof task.scope_id === 'string' ? task.scope_id : undefined,
        })
        const activity: ToolActivity = {
          type: 'status',
          name: 'task_event',
          content: JSON.stringify(payload),
          ts: now,
        }
        appendPassiveAssistantActivity(sid, activity)
        break
      }

      case 'agent_message': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        const payload = isRecord(event.message) ? event.message : {}
        if (!sid) break
        const now = Date.now()
        const statusPayload = createAgentMessageStatusPayload({
          id: typeof event.event_id === 'string' ? event.event_id : `agent-message-${now}`,
          from: typeof payload.from === 'string' ? payload.from : 'unknown',
          to: typeof payload.to === 'string' ? payload.to : '*',
          summary: typeof payload.summary === 'string' ? payload.summary : '',
          teamId: typeof payload.team_id === 'string' ? payload.team_id : undefined,
        })

        updateCollaboration(sid, (prev) => ({
          ...prev,
          capabilities: { ...prev.capabilities, messaging: true },
          agentMessages: [
            ...prev.agentMessages,
            {
              id: statusPayload.id,
              from: statusPayload.from,
              to: statusPayload.to,
              summary: statusPayload.summary,
              teamId: statusPayload.teamId,
              ts: now,
            },
          ].slice(-8),
        }))
        appendPassiveAssistantActivity(sid, {
          type: 'status',
          name: 'agent_message',
          content: JSON.stringify(statusPayload),
          ts: now,
        })
        break
      }

      case 'agent_spawned':
      case 'agent_idle':
      case 'agent_completed':
      case 'agent_failed': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
        if (!sid || !agentId) break
        const nextStatus: AsyncAgentState['status'] =
          normalizedType === 'agent_idle'
            ? 'idle'
            : normalizedType === 'agent_completed'
              ? 'completed'
              : normalizedType === 'agent_failed'
                ? 'failed'
              : 'running'
        const error = isRecord(event.error) ? event.error : {}
        const now = Date.now()
        const statusPayload = createAsyncAgentStatusPayload({
          agentId,
          agentName: typeof event.agent_name === 'string' ? event.agent_name : 'agent',
          description: typeof event.description === 'string' ? event.description : '',
          agentType: typeof event.agent_type === 'string' ? event.agent_type : 'async',
          parentAgentId: typeof event.parent_agent_id === 'string' ? event.parent_agent_id : 'main',
          status: nextStatus,
          durationMs: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
          errorType: typeof error.type === 'string' ? error.type : undefined,
          errorMessage: typeof error.message === 'string' ? error.message : undefined,
        })

        updateCollaboration(sid, (prev) => ({
          ...prev,
          capabilities: { ...prev.capabilities, asyncAgent: true },
          asyncAgents: {
            ...prev.asyncAgents,
            [agentId]: {
              agentId,
              agentName: statusPayload.agentName || prev.asyncAgents[agentId]?.agentName || 'agent',
              description: statusPayload.description || prev.asyncAgents[agentId]?.description || '',
              agentType: statusPayload.agentType || prev.asyncAgents[agentId]?.agentType || 'async',
              parentAgentId: statusPayload.parentAgentId || prev.asyncAgents[agentId]?.parentAgentId || 'main',
              status: nextStatus,
              durationMs: statusPayload.durationMs ?? prev.asyncAgents[agentId]?.durationMs,
              errorType: statusPayload.errorType ?? prev.asyncAgents[agentId]?.errorType,
              errorMessage: statusPayload.errorMessage ?? prev.asyncAgents[agentId]?.errorMessage,
              updatedAt: now,
            },
          },
        }))
        appendPassiveAssistantActivity(sid, {
          type: 'status',
          name: 'async_agent_event',
          content: JSON.stringify(statusPayload),
          ts: now,
        })
        break
      }

      case 'team_created':
      case 'team_member_join':
      case 'team_member_left':
      case 'team_deleted': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        const team = isRecord(event.team) ? event.team : {}
        const teamId = typeof team.team_id === 'string' ? team.team_id : ''
        if (!sid || !teamId) break
        const now = Date.now()
        const statusPayload = createTeamStatusPayload({
          teamId,
          teamName: typeof team.team_name === 'string' ? team.team_name : undefined,
          members: asStringArray(team.members),
          lastEvent: normalizedType === 'team_member_join'
            ? 'member_join'
            : normalizedType === 'team_member_left'
              ? 'member_left'
              : normalizedType === 'team_deleted'
                ? 'deleted'
                : 'created',
          memberName: typeof team.member_name === 'string' ? team.member_name : undefined,
          memberType: typeof team.member_type === 'string' ? team.member_type : undefined,
        })

        updateCollaboration(sid, (prev) => {
          const nextTeams = { ...prev.teams }
          if (normalizedType === 'team_deleted') {
            delete nextTeams[teamId]
          } else {
            const previous = prev.teams[teamId]
            nextTeams[teamId] = {
              teamId,
              teamName: statusPayload.teamName || previous?.teamName || teamId,
              members: statusPayload.members.length > 0 ? statusPayload.members : previous?.members || [],
              lastEvent: statusPayload.lastEvent === 'deleted' ? 'created' : statusPayload.lastEvent,
              memberName: statusPayload.memberName,
              memberType: statusPayload.memberType,
              updatedAt: now,
            }
          }

          return {
            ...prev,
            capabilities: { ...prev.capabilities, teams: true },
            teams: nextTeams,
          }
        })
        appendPassiveAssistantActivity(sid, {
          type: 'status',
          name: 'team_event',
          content: JSON.stringify(statusPayload),
          ts: now,
        })
        break
      }

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

      case 'tool_call':
      case 'tool_start': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'call',
          name: getToolEventName(event),
          content: getToolCallEventContent(event),
          callId: getToolEventCallId(event),
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

      case 'tool_result':
      case 'tool_end': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        const activity: ToolActivity = {
          type: 'result',
          name: getToolEventName(event),
          content: getToolResultEventContent(event),
          callId: getToolEventCallId(event),
          isError: event.is_error as boolean,
          durationMs: getToolDurationMs(event),
          renderHint: getToolRenderHint(event),
          language: getToolLanguage(event),
          filePath: getToolFilePath(event),
          metadata: getToolMetadata(event),
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
          const errorAt = Date.now()
          pendingAssistantIds.current[sid] = null
          updateSession(sid, (prev) => ({
            ...prev,
            isProcessing: false,
            isPaused: false,
            isStopping: false,
            pauseReason: undefined,
            messages: (() => {
              const nextMessages = [...prev.messages]
              const attachIndex = findAttachableAssistantMessageIndex(nextMessages, errorAt, pendingAssistantId)

              if (attachIndex >= 0) {
                nextMessages[attachIndex] = {
                  ...nextMessages[attachIndex],
                  isStreaming: false,
                  systemNotice,
                  timestamp: errorAt,
                }
                return nextMessages
              }

              nextMessages.push({
                id: `err-${errorAt}`,
                role: 'assistant',
                content: '',
                systemNotice,
                timestamp: errorAt,
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
  }, [updateCollaboration, updateSession])

  // Keep a stable ref to the latest event handler so the mount-only listener
  // never captures a stale closure.
  const handleHarnessclawEventRef = useRef(handleHarnessclawEvent)
  handleHarnessclawEventRef.current = handleHarnessclawEvent

  const handleSend = () => {
    const message = composerPayload
    if ((!message && attachments.length === 0 && pasted.blocks.length === 0) || activeSession.isProcessing) return

    const sid = activeSessionId || ensureLocalSession(undefined, activeProjectContext || null)

    const pastedSuffix = pasted.buildPastedSuffix()
    const fullMessage = [message, pastedSuffix].filter(Boolean).join('\n\n')
    const payload = buildMessagePayload(fullMessage, attachments)
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
        content: fullMessage,
        attachments: attachedFiles,
        timestamp: Date.now(),
      }],
    }))
    void window.harnessclaw.send(payload, sid)
    if (sendBurstTimerRef.current != null) {
      window.clearTimeout(sendBurstTimerRef.current)
    }
    setSendBurstActive(true)
    sendBurstTimerRef.current = window.setTimeout(() => {
      setSendBurstActive(false)
      sendBurstTimerRef.current = null
    }, 820)
    setInput('')
    setSelectedSkills([])
    setAttachments([])
    pasted.clearBlocks()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleNewSession = () => {
    if (isActiveSessionPristine) {
      composerTextareaRef.current?.focus()
      return
    }
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
    if (dropBurstTimerRef.current != null) {
      window.clearTimeout(dropBurstTimerRef.current)
    }
    setDropBurstActive(true)
    dropBurstTimerRef.current = window.setTimeout(() => {
      setDropBurstActive(false)
      dropBurstTimerRef.current = null
    }, 900)
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

  useEffect(() => {
    return () => {
      if (sendBurstTimerRef.current != null) {
        window.clearTimeout(sendBurstTimerRef.current)
      }
      if (dropBurstTimerRef.current != null) {
        window.clearTimeout(dropBurstTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="relative flex h-full overflow-hidden bg-background">
      {/* Main chat area */}
      <div className="relative flex-1 flex min-w-0 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="titlebar-drag border-b border-border/70 px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-foreground">
                <MessagesSquare size={16} className="flex-shrink-0 text-muted-foreground" />
                <h1 className="truncate text-lg font-semibold tracking-tight">
                  {activeSessionId ? activeSessionPrompt : '新对话'}
                </h1>
                {activeSessionId && activeSession.messages.length > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {activeSession.messages.filter((m) => m.role !== 'system').length}
                  </span>
                )}
              </div>
              {activeProjectContext ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  项目：{activeProjectContext.name}
                </p>
              ) : null}
            </div>

            {activeSessionId && (
              <div className="flex justify-start sm:justify-end">
                <button
                  onClick={handleClearHistory}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Trash2 size={14} />
                  <span>清空历史</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {!activeSessionId ? (
          /* Empty state — no session selected */
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="chat-empty-state relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-border/80 bg-card/80 px-6 py-7 text-left shadow-[0_16px_48px_color-mix(in_srgb,var(--foreground)_6%,transparent)] backdrop-blur-sm sm:px-8 sm:py-8">
              <div className="chat-empty-pixels" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="relative z-[1]">
                <span className="inline-flex items-center rounded-full border border-border bg-background/80 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  {emptyGreeting.tone}
                </span>
                <h2 className="mt-4 max-w-xl text-[clamp(1.6rem,3vw,2.4rem)] font-semibold leading-[1.08] text-foreground">
                  {emptyGreeting.title}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  {emptyGreeting.detail}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-[11px] text-foreground/80">
                    Enter 发送，Shift + Enter 换行
                  </span>
                  <span className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-[11px] text-foreground/80">
                    支持直接拖入文件
                  </span>
                  <span className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-[11px] text-foreground/80">
                    敏感操作会先向你确认
                  </span>
                </div>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleNewSession}
                    className="chat-empty-cta inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 dark:bg-primary dark:text-primary-foreground"
                  >
                    <Plus size={14} />
                    开始新对话
                  </button>
                  <p className="text-xs text-muted-foreground">
                    让问题、附件和进度留在同一条对话里。
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <ConversationTimeline
              collaboration={displayCollaboration}
              displayMessages={displayMessages}
              isProcessing={activeSession.isProcessing}
              isPaused={activeSession.isPaused}
              isStopping={activeSession.isStopping}
              currentThinking={activeSession.currentThinking}
              pendingAssistantMessage={pendingAssistantMessage}
              activeLoadingStep={activeLoadingStep}
              messagesViewportRef={messagesViewportRef}
              messagesEndRef={messagesEndRef}
              onScroll={updateScrollState}
              onOpenFilePreview={setFilePreview}
              onRespondPermission={respondPermission}
            />

            {showJumpToBottom && (
              <button
                onClick={() => scrollToBottom('smooth')}
                className="chat-jump-to-bottom absolute bottom-[calc(100px+1.5rem)] left-1/2 z-20 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-border/80 bg-white shadow-[0_14px_30px_rgba(15,23,42,0.14)] transition-transform hover:scale-[1.03] dark:bg-card"
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
                    'chat-composer-shell relative overflow-hidden rounded-[28px] border bg-card shadow-[0_12px_36px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow]',
                    isDragOver
                      ? 'border-primary shadow-[0_18px_50px_rgba(37,99,235,0.14)]'
                      : 'border-border focus-within:border-primary'
                  )}
                  data-dropped={dropBurstActive ? 'true' : undefined}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {isDragOver && (
                    <div className="chat-drop-overlay pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-card text-sm text-primary">
                      <div className="text-center">
                        <p className="text-sm font-medium">松开即可把文件交给这次对话</p>
                        <p className="mt-1 text-xs text-muted-foreground">附件会和你的问题一起进入当前上下文。</p>
                      </div>
                    </div>
                  )}
                  <div className="p-3 sm:p-3.5">
                    {pasted.blocks.length > 0 && (
                      <div className="mb-2">
                        <PastedBlocksBar blocks={pasted.blocks} onRemove={pasted.removeBlock} removable={!activeSession.isProcessing} />
                      </div>
                    )}
                    <SkillComposerInput
                      textareaRef={composerTextareaRef}
                      value={input}
                      onChange={setInput}
                      selectedSkills={selectedSkills}
                      onSelectedSkillsChange={setSelectedSkills}
                      onKeyDown={handleKeyDown}
                      onPaste={pasted.handlePaste}
                      disabled={activeSession.isProcessing}
                      placeholder={
                        harnessclawStatus === 'connected'
                          ? '+ 想让 HarnessClaw 帮你做什么？'
                          : '+ 先写下你的问题，发送时会自动尝试连接。'
                      }
                      maxLength={maxLength}
                      className="min-h-[26px] max-h-[120px] leading-6"
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
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
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
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
                            title="停止当前任务"
                            aria-label="停止当前任务"
                          >
                            <span className="h-2 w-2 rounded-sm bg-current" />
                          </button>
                        ) : (
                          <button
                            onClick={handleSend}
                            disabled={!canSend}
                            className="chat-send-button inline-flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-primary dark:text-primary-foreground"
                            aria-label="发送消息"
                            data-ready={canSend ? 'true' : 'false'}
                            data-burst={sendBurstActive ? 'true' : undefined}
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

// ─── Agent Avatar ────────────────────────────────────────────────────────────

/** Extensible avatar: pass agentId to resolve a per-agent icon in the future. */
function AgentAvatar({ agentId, agentName, size = 'md' }: { agentId?: string; agentName?: string; size?: 'md' | 'sm' }) {
  const dim = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
  // Main agent (emma) — or fallback when no agentId is given
  if (!agentId) {
    return <img src={emmaAvatar} alt="Emma" className={cn(dim, 'flex-shrink-0 rounded-full object-cover')} />
  }
  // Sub-agent — resolve to one of the 5 team member avatars
  const src = resolveTeamAvatar(agentName || agentId)
  return (
    <img
      src={src}
      alt={agentName || agentId}
      className={cn(dim, 'flex-shrink-0 rounded-full bg-muted object-cover')}
    />
  )
}

// ─── Sub Components ─────────────────────────────────────────────────────────

function CollaborationOverview({ collaboration }: { collaboration: CollaborationState }) {
  const tasks = Object.values(collaboration.tasks)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 6)
  const asyncAgents = Object.values(collaboration.asyncAgents)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 4)
  const agentMessages = [...collaboration.agentMessages]
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 5)
  const capabilityTags = [
    collaboration.capabilities.tasks ? 'Tasks' : '',
    collaboration.capabilities.messaging ? 'Messaging' : '',
    collaboration.capabilities.asyncAgent ? 'Async Agents' : '',
  ].filter(Boolean)

  const hasContent = !!collaboration.routedAgent
    || tasks.length > 0
    || asyncAgents.length > 0
    || agentMessages.length > 0
  const hasTopBar = !!collaboration.routedAgent

  if (!hasContent) return null

  return (
    <section className="multi-agent-overview rounded-[28px] border border-border/80 bg-card/90 px-4 py-4 shadow-[0_12px_36px_rgba(15,23,42,0.05)] backdrop-blur-sm">
      {hasTopBar && (
        <div className="flex justify-end">
        {collaboration.routedAgent && (
          <div className="multi-agent-route-pill inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
            <AtSign size={12} className="text-primary" />
            <span>
              已路由到 <span className="font-medium text-foreground">@{collaboration.routedAgent.agentName}</span>
            </span>
          </div>
        )}
        </div>
      )}

      <div className={cn('grid gap-3 xl:grid-cols-2', hasTopBar ? 'mt-3' : 'mt-0')}>
        {tasks.length > 0 && (
          <div className="multi-agent-panel rounded-2xl border border-border/70 bg-background/70 p-3" style={{ animationDelay: '100ms' }}>
            <div className="mb-3 flex items-center gap-2">
              <ListTodo size={14} className="text-primary" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">任务</p>
            </div>
            <div className="space-y-2">
              {tasks.map((task, index) => (
                <div
                  key={task.taskId}
                  className="multi-agent-card rounded-xl border border-border/70 bg-card px-3 py-2.5"
                  data-state={task.status}
                  style={{ animationDelay: `${140 + index * 60}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{task.subject}</p>
                      {(task.owner || task.activeForm) && (
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {task.activeForm || '任务状态已更新'}{task.owner ? ` · ${task.owner}` : ''}
                        </p>
                      )}
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getTaskStatusClasses(task.status), task.status === 'in_progress' && 'multi-agent-badge-running')}>
                      {task.status === 'in_progress' ? (
                        <span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" />进行中</span>
                      ) : (
                        getTaskStatusLabel(task.status)
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {asyncAgents.length > 0 && (
          <div className="multi-agent-panel rounded-2xl border border-border/70 bg-background/70 p-3" style={{ animationDelay: '160ms' }}>
            <div className="mb-3 flex items-center gap-2">
              <GitBranch size={14} className="text-primary" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">异步 Agent</p>
            </div>
            <div className="space-y-2">
              {asyncAgents.map((agent, index) => (
                <div
                  key={agent.agentId}
                  className="multi-agent-card rounded-xl border border-border/70 bg-card px-3 py-2.5"
                  data-state={agent.status}
                  style={{ animationDelay: `${200 + index * 70}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{agent.agentName}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {agent.description || '后台协作任务'}
                      </p>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getAsyncAgentStatusClasses(agent.status), agent.status === 'running' && 'multi-agent-badge-running')}>
                      {agent.status === 'running' ? (
                        <span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" />运行中</span>
                      ) : (
                        getAsyncAgentStatusLabel(agent.status)
                      )}
                    </span>
                  </div>
                  {(agent.durationMs || agent.errorMessage) && (
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                      {agent.errorMessage ? agent.errorMessage : `总耗时 ${formatDurationMs(agent.durationMs)}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {agentMessages.length > 0 && (
          <div className="multi-agent-panel rounded-2xl border border-border/70 bg-background/70 p-3" style={{ animationDelay: '220ms' }}>
            <div className="mb-3 flex items-center gap-2">
              <MessagesSquare size={14} className="text-primary" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent 通信</p>
            </div>
            <div className="space-y-2">
              {agentMessages.map((item, index) => (
                <div
                  key={item.id}
                  className="multi-agent-card rounded-xl border border-border/70 bg-card px-3 py-2.5"
                  data-state="message"
                  style={{ animationDelay: `${260 + index * 55}ms` }}
                >
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{item.from}</span>
                    <span>→</span>
                    <span>{item.to === '*' ? '全部成员' : item.to}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-foreground/85 dark:text-[#dce3ef]">{item.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {capabilityTags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {capabilityTags.map((item, index) => (
            <span
              key={item}
              className="multi-agent-chip rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-muted-foreground"
              style={{ animationDelay: `${360 + index * 45}ms` }}
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

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
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const now = useSharedNowTicker(!isUser && !isSystem && !!message.isStreaming, 250)
  const systemNotice = message.systemNotice
  const errorNotice = systemNotice?.kind === 'error' ? systemNotice : undefined

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const renderErrorNoticeCard = (notice: SystemNoticeData) => (
    <div className="rounded-2xl border border-red-200 bg-white px-4 py-3 shadow-sm dark:border-red-900/40 dark:bg-red-950/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">{notice.title}</p>
            {notice.reason && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-950/30 dark:text-red-300">
                {notice.reason}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-foreground">{notice.message}</p>
          {notice.hint && (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              建议：{notice.hint}
            </p>
          )}
        </div>
      </div>
    </div>
  )

  if (isSystem) {
    if (errorNotice) {
      return (
        <div className="flex justify-start">
          <div className="w-full sm:w-[min(88%,56rem)] xl:w-[min(80%,56rem)]">
            {renderErrorNoticeCard(errorNotice)}
            <p className="mt-1 px-1 text-[10px] text-muted-foreground">
              {formatMessageTime(message.timestamp)}
            </p>
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

  type AgentTeamMember = {
    task: SubagentInfo
    items: Segment[]
    ts: number
  }

  type DisplaySegment =
    | { kind: 'main'; items: Segment[]; ts: number }
    | { kind: 'agent-team'; agents: AgentTeamMember[]; ts: number }

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

  for (const seg of segments) {
    if (!seg.subagent) {
      const lastSegment = displaySegments[displaySegments.length - 1]
      if (lastSegment?.kind === 'main') {
        lastSegment.items.push(seg)
      } else {
        displaySegments.push({
          kind: 'main',
          items: [seg],
          ts: seg.ts,
        })
      }
      continue
    }

    const lastSegment = displaySegments[displaySegments.length - 1]
    const teamSegment = lastSegment?.kind === 'agent-team'
      ? lastSegment
      : (() => {
          const next: Extract<DisplaySegment, { kind: 'agent-team' }> = {
            kind: 'agent-team',
            agents: [],
            ts: seg.ts,
          }
          displaySegments.push(next)
          return next
        })()

    const existingMember = teamSegment.agents.find((member) => member.task.taskId === seg.subagent?.taskId)
    if (existingMember) {
      existingMember.task = seg.subagent
      existingMember.items.push(seg)
      continue
    }

    teamSegment.agents.push({
      task: seg.subagent,
      items: [seg],
      ts: seg.ts,
    })
  }

  const attachments = message.attachments || []
  const lastVisibleActivityTs = segments.reduce((latest, seg) => Math.max(latest, seg.ts), message.timestamp)
  const shouldShowBreathingDot = !isUser
    && !isSystem
    && !!message.isStreaming
    && segments.length > 0
    && now - lastVisibleActivityTs > 1000
  const shouldShowTimestamp = !message.isStreaming
  const hasRenderableAssistantBody = displaySegments.length > 0 || attachments.length > 0 || !!errorNotice

  if (!isUser && !isSystem && !message.isStreaming && !hasRenderableAssistantBody) {
    return null
  }

  const openFilePathPreview = useCallback(async (path: string) => {
    try {
      const result = await window.files.read(path)
      const resolvedPath = result?.path || path
      const fileName = resolvedPath.split(/[\\/]/).pop() || resolvedPath
      onOpenFilePreview({
        path: resolvedPath,
        fileName,
        operation: 'read_file',
        content: result?.ok && typeof result.content === 'string' ? result.content : '',
      })
    } catch (error) {
      console.error('Failed to read file path:', error)
      const fileName = path.split(/[\\/]/).pop() || path
      onOpenFilePreview({ path, fileName, operation: 'read_file', content: '' })
    }
  }, [onOpenFilePreview])

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
            ? 'w-full rounded-bl-sm border border-border bg-card text-foreground shadow-sm'
            : 'text-foreground'
      )}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap">{renderTextWithFilePaths(text, openFilePathPreview)}</p>
      ) : (
        <div className={cn(
          'prose max-w-none break-words [overflow-wrap:anywhere] text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-hr:my-4 prose-hr:border-border/70 prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-code:break-all prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:text-foreground dark:prose-invert',
          compact ? 'prose-xs' : 'prose-sm'
        )}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkFilePaths]}
            components={{
              a: ({ href, children, ...props }) => {
                if (typeof href === 'string' && href.startsWith(FILEPATH_HREF_PREFIX)) {
                  const path = href.slice(FILEPATH_HREF_PREFIX.length)
                  return <FilePathChip path={path} onOpen={openFilePathPreview} />
                }
                return <a href={href} {...props}>{children}</a>
              },
            }}
          >
            {text}
          </ReactMarkdown>
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
          ? 'rounded-lg bg-accent/55 px-2 py-1.5'
          : 'rounded-full bg-accent/45 px-2.5 py-1'
      )}
    >
      <Wrench size={10} className="text-muted-foreground" />
      <span className={cn(
        compact
          ? 'text-[11px] text-foreground/80'
          : 'text-[11px] text-muted-foreground'
      )}>{text}</span>
    </div>
  )

  const getStatusTone = (activity: ToolActivity, status?: string): 'error' | 'running' | 'neutral' | 'done' => {
    const persistedStatus = parsePersistedCollaborationStatusPayload(activity.content)
    if (status === 'error') return 'error'
    if (status === 'running') return 'running'
    if (persistedStatus) return getPersistedStatusTone(persistedStatus)
    return 'done'
  }

  const renderStatus = (activity: ToolActivity, key: string, status?: string) => {
    const tone = getStatusTone(activity, status)
    const persistedStatus = parsePersistedCollaborationStatusPayload(activity.content)
    return (
    <div key={key} className="mb-2 flex items-center gap-2 rounded-xl border border-border/70 bg-background/75 px-2.5 py-2">
      <span className={cn(
        'inline-block h-2.5 w-2.5 rounded-sm',
        tone === 'error' ? 'bg-red-500' : tone === 'running' ? 'bg-amber-500' : tone === 'neutral' ? 'bg-slate-400 dark:bg-slate-500' : 'bg-emerald-500'
      )} />
      <span className="text-[11px] text-muted-foreground">{persistedStatus?.summary || activity.content}</span>
    </div>
    )
  }

  return (
    <div className={cn('flex min-w-0 max-w-full group', isUser ? 'justify-end' : 'justify-start')}>
      {/* Assistant avatar — Feishu IM style */}
      {!isUser && (
        <div className="mr-2.5 mt-0.5 flex-shrink-0">
          <AgentAvatar />
        </div>
      )}
      <div
        className={cn(
          'relative min-w-0 max-w-full',
          isUser ? 'max-w-[88%] sm:max-w-[80%] items-end' : 'w-full sm:w-[min(88%,52rem)] xl:w-[min(80%,52rem)] items-start'
        )}
      >
        {!isUser && (
          <p className="mb-1 text-xs font-medium text-muted-foreground">Emma</p>
        )}
        <div className={cn(
          'mb-1 flex justify-end gap-1 opacity-100 transition-opacity md:absolute md:top-1 md:z-10 md:mb-0 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
          isUser ? 'md:-left-14 md:right-auto' : 'md:-right-14'
        )}>
          <button onClick={handleCopy} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-background/90 hover:bg-muted" aria-label="复制消息">
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-muted-foreground" />}
          </button>
        </div>

        {displaySegments.map((seg, i) => {
          if (seg.kind === 'main') {
            return (
              <div key={`main-${i}`}>
                {seg.items.map((item, itemIndex) => {
                  if (item.kind === 'status') {
                    return renderStatus(item.data, `status-${i}-${itemIndex}`, item.subagent?.status)
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
          if (seg.kind === 'agent-team') {
            return (
              <div key={`agent-team-${seg.ts}-${i}`} className="space-y-3">
                {seg.agents.map((agent, agentIdx) => {
                  const latestTask = agent.items.reduce<SubagentInfo>(
                    (cur, item) => item.subagent || cur,
                    agent.task
                  )
                  const visualStatus = getSubagentVisualStatus(latestTask.status)
                  const visibleItems = agent.items.filter((item) => item.kind !== 'status')
                  return (
                    <div key={latestTask.taskId || `sub-${agentIdx}`} className="ml-2 border-l-2 border-primary/20 pl-3">
                      <div className="mb-1.5 flex items-center gap-2">
                        <AgentAvatar agentId={latestTask.taskId || latestTask.label} agentName={latestTask.label} size="sm" />
                        <span className="text-xs font-medium text-foreground/80">{latestTask.label}</span>
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px]',
                          visualStatus === 'failed'
                            ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                            : visualStatus === 'running'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        )}>
                          {visualStatus === 'failed' ? '失败' : visualStatus === 'running' ? '进行中' : '已完成'}
                        </span>
                      </div>
                      {visibleItems.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">等待更多处理结果…</p>
                      ) : (
                        visibleItems.map((item, itemIndex) => {
                          if (item.kind === 'hint') {
                            return renderHint(item.data.content, `sub-hint-${i}-${agentIdx}-${itemIndex}`)
                          }
                          if (item.kind === 'tool') {
                            return (
                              <ToolCallCard
                                key={item.call.callId || `sub-tool-${i}-${agentIdx}-${itemIndex}`}
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
                                key={item.request.callId || `sub-perm-${i}-${agentIdx}-${itemIndex}`}
                                request={item.request}
                                result={item.result}
                                onRespondPermission={onRespondPermission}
                              />
                            )
                          }
                          return renderTextBlock(item.text, `sub-text-${i}-${agentIdx}-${itemIndex}`)
                        })
                      )}
                    </div>
                  )
                })}
              </div>
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

        {errorNotice && (
          <div className="mb-1.5">
            {renderErrorNoticeCard(errorNotice)}
          </div>
        )}

        {shouldShowBreathingDot && (
          <div className="mb-1.5 flex justify-end pr-1">
            <span className="streaming-breathing-dot" aria-label="服务仍在继续" />
          </div>
        )}

        {shouldShowTimestamp && (
          <div className="mt-1 px-1">
            <p className="text-[10px] text-muted-foreground">
              {formatMessageTime(message.timestamp)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function AgentTeamPanel({
  agents,
  onOpenFilePreview,
  onRespondPermission,
  renderHint,
  renderTextBlock,
}: {
  agents: Array<{
    task: SubagentInfo
    items: Array<
      | { kind: 'status'; data: ToolActivity; ts: number; subagent?: SubagentInfo }
      | { kind: 'hint'; data: ToolActivity; ts: number; subagent?: SubagentInfo }
      | { kind: 'tool'; call: ToolActivity; result?: ToolActivity; isRunning: boolean; ts: number; subagent?: SubagentInfo }
      | { kind: 'permission'; request: ToolActivity; result?: ToolActivity; ts: number; subagent?: SubagentInfo }
      | { kind: 'text'; text: string; ts: number; subagent?: SubagentInfo }
    >
    ts: number
  }>
  onOpenFilePreview: (preview: FilePreviewData) => void
  onRespondPermission: (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
  renderHint: (text: string, key: string, compact?: boolean) => JSX.Element
  renderTextBlock: (text: string, key: string, compact?: boolean) => JSX.Element
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [detailOpen, setDetailOpen] = useState(false)
  const [switchDirection, setSwitchDirection] = useState<'next' | 'prev'>('next')
  const [switchToken, setSwitchToken] = useState(0)
  const [isSwitchAnimating, setIsSwitchAnimating] = useState(false)
  const dialogId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (agents.length === 0) {
      setActiveIndex(0)
      setDetailOpen(false)
      return
    }
    setActiveIndex((current) => Math.min(current, agents.length - 1))
  }, [agents.length])

  useEffect(() => {
    if (!detailOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [detailOpen])

  useEffect(() => {
    if (!isSwitchAnimating) return

    const timer = window.setTimeout(() => {
      setIsSwitchAnimating(false)
    }, 460)

    return () => window.clearTimeout(timer)
  }, [isSwitchAnimating])

  if (agents.length === 0) return null

  const wrapIndex = (index: number) => (index + agents.length) % agents.length
  const activeAgent = agents[activeIndex]
  const previousAgent = agents[wrapIndex(activeIndex - 1)]
  const nextAgent = agents[wrapIndex(activeIndex + 1)]
  const hasMultipleAgents = agents.length > 1
  const showLeftPreview = agents.length > 2
  const showRightPreview = agents.length > 1

  const moveToIndex = (nextIndex: number, direction: 'next' | 'prev') => {
    if (nextIndex === activeIndex) return
    setSwitchDirection(direction)
    setSwitchToken((current) => current + 1)
    setIsSwitchAnimating(true)
    setActiveIndex(nextIndex)
  }

  const getLatestTask = (agent: typeof activeAgent): SubagentInfo =>
    agent.items.reduce<SubagentInfo>((current, item) => item.subagent || current, agent.task)

  const getVisibleItems = (agent: typeof activeAgent) => agent.items.filter((item) => item.kind !== 'status')

  const getAgentSummary = (agent: typeof activeAgent) => {
    const visibleItems = getVisibleItems(agent)
    const latestPreview = [...visibleItems].reverse().find((item) => item.kind === 'text')
    if (latestPreview && latestPreview.kind === 'text') {
      return summarizeInlineText(latestPreview.text, 104)
    }

    const latestTool = [...visibleItems].reverse().find((item) => item.kind === 'tool')
    if (latestTool && latestTool.kind === 'tool') {
      return latestTool.isRunning
        ? `正在执行 ${getToolDisplayName(latestTool.call.name)}`
        : latestTool.result?.isError
          ? `${getToolDisplayName(latestTool.call.name)} 执行失败`
          : `${getToolDisplayName(latestTool.call.name)} 已完成`
    }

    const latestHint = [...visibleItems].reverse().find((item) => item.kind === 'hint')
    if (latestHint && latestHint.kind === 'hint') {
      return summarizeInlineText(latestHint.data.content, 104)
    }

    return '正在补充处理过程。'
  }

  const getStatusLabel = (status: string) => {
    const visualStatus = getSubagentVisualStatus(status)
    return visualStatus === 'failed' ? '失败' : visualStatus === 'running' ? '进行中' : '已完成'
  }

  const getStatusClasses = (status: string) => cn(
    'team-stack-card-badge',
    getSubagentVisualStatus(status) === 'failed'
      ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300'
      : getSubagentVisualStatus(status) === 'running'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  )

  const getStatusDotClasses = (status: string) => cn(
    'team-stack-status-dot',
    getSubagentVisualStatus(status) === 'failed'
      ? 'bg-red-500 text-red-500'
      : getSubagentVisualStatus(status) === 'running'
        ? 'bg-amber-500 text-amber-500'
        : 'bg-emerald-500 text-emerald-500'
  )

  const latestActiveTask = getLatestTask(activeAgent)
  const activeVisibleItems = getVisibleItems(activeAgent)
  const activeLatestItemTs = activeAgent.items.reduce((latest, item) => Math.max(latest, item.ts), activeAgent.ts)
  const activeVisualStatus = getSubagentVisualStatus(latestActiveTask.status)
  const liveNow = useSharedNowTicker(activeVisualStatus === 'running', 250)
  const hasLivePulse = activeVisualStatus === 'running' && liveNow - activeLatestItemTs < 1800
  const headingId = `${dialogId}-heading`

  const renderAgentPreviewCard = (agent: typeof activeAgent, side: 'left' | 'right') => {
    const latestTask = getLatestTask(agent)
    return (
      <div className={`team-stack-card team-stack-card-${side}`} aria-hidden="true">
        <div className="team-stack-card-top">
          <span className="team-stack-card-name">{latestTask.label}</span>
          <span className="team-stack-card-meta">{getVisibleItems(agent).length} 记录</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <section
        className="agent-team-panel chat-surface-elevated mb-3 ml-2 rounded-[1.55rem] border border-border/80 bg-card/85 p-3 sm:ml-4"
        data-live={hasLivePulse ? 'true' : undefined}
        data-state={latestActiveTask.status}
      >
        <div className="mb-3 flex items-center gap-2">
          <Users size={14} className="text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent Team</p>
          <span className="rounded-full border border-border bg-background/75 px-2 py-0.5 text-[10px] text-muted-foreground">
            {agents.length} 个 subagent
          </span>
        </div>

        <div className="team-stack-shell">
          {hasMultipleAgents && (
            <button
              type="button"
              onClick={() => moveToIndex(wrapIndex(activeIndex - 1), 'prev')}
              className="team-stack-nav team-stack-nav-left"
              aria-label="查看上一个 subagent"
            >
              <ChevronLeft size={16} />
            </button>
          )}

          <div
            className="team-stack-stage"
            data-two-up={agents.length === 2 ? 'true' : undefined}
            data-animating={isSwitchAnimating ? 'true' : undefined}
            data-direction={switchDirection}
          >
            {showLeftPreview && (
              <div key={`left-${previousAgent.task.taskId}-${switchToken}`}>
                {renderAgentPreviewCard(previousAgent, 'left')}
              </div>
            )}

            <button
              key={`active-${latestActiveTask.taskId}-${switchToken}`}
              type="button"
              onClick={() => setDetailOpen(true)}
              className="team-stack-card team-stack-card-active"
              aria-haspopup="dialog"
              aria-expanded={detailOpen}
              aria-controls={dialogId}
            >
              <div className="team-stack-card-top">
                <div className="team-stack-agent-head">
                  <div className="team-stack-agent-avatar">
                    <img
                      src={resolveTeamAvatar(latestActiveTask.label)}
                      alt={latestActiveTask.label}
                      className="h-full w-full rounded-[0.85rem] object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="team-stack-card-name">{latestActiveTask.label}</span>
                    <p className="team-stack-agent-copy">{activeVisibleItems.length || activeAgent.items.length} 条过程记录</p>
                  </div>
                </div>
                <span className="team-stack-card-meta team-stack-card-status">
                  <span>{getStatusLabel(latestActiveTask.status)}</span>
                  <span className={getStatusDotClasses(latestActiveTask.status)} aria-hidden="true" />
                </span>
              </div>

              <div className="team-stack-card-body">
                <p className="team-stack-card-summary">{getAgentSummary(activeAgent)}</p>
              </div>

              <div className="team-stack-card-foot">
                <span>子 Agent 协作成员</span>
                <span className="inline-flex items-center gap-2">
                  <span>查看详情</span>
                  <span className="team-stack-card-dot" />
                </span>
              </div>
            </button>

            {showRightPreview && (
              <div key={`right-${nextAgent.task.taskId}-${switchToken}`}>
                {renderAgentPreviewCard(nextAgent, 'right')}
              </div>
            )}
          </div>

          {hasMultipleAgents && (
            <button
              type="button"
              onClick={() => moveToIndex(wrapIndex(activeIndex + 1), 'next')}
              className="team-stack-nav team-stack-nav-right"
              aria-label="查看下一个 subagent"
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {hasMultipleAgents && (
          <div className="team-stack-dots" aria-label="subagent 切换进度">
            {agents.map((agent, index) => (
              <button
                key={agent.task.taskId}
                type="button"
                onClick={() => {
                  const direction = index > activeIndex ? 'next' : 'prev'
                  moveToIndex(index, direction)
                }}
                className="team-stack-dot"
                data-active={index === activeIndex ? 'true' : undefined}
                aria-label={`切换到 ${getLatestTask(agent).label}`}
                aria-pressed={index === activeIndex}
              />
            ))}
          </div>
        )}
      </section>

      {detailOpen && (
        <div className="team-stack-dialog-backdrop" role="presentation" onClick={() => setDetailOpen(false)}>
          <div
            id={dialogId}
            className="team-stack-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="team-stack-dialog-head">
              <div>
                <p className="team-stack-dialog-eyebrow">Agent Team Member</p>
                <h3 id={headingId} className="team-stack-dialog-title">{latestActiveTask.label}</h3>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setDetailOpen(false)}
                className="team-stack-dialog-close"
                aria-label="关闭 subagent 详情"
              >
                <X size={15} />
              </button>
            </div>

            <div className="team-stack-dialog-grid">
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">当前状态</p>
                <div className={getStatusClasses(latestActiveTask.status)}>{getStatusLabel(latestActiveTask.status)}</div>
                <p className="team-stack-dialog-copy">{getAgentSummary(activeAgent)}</p>
              </div>
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">过程记录</p>
                <p className="team-stack-dialog-stat">{activeVisibleItems.length || activeAgent.items.length}</p>
                <p className="team-stack-dialog-copy">当前 subagent 已输出的明细条数</p>
              </div>
            </div>

            <div className="team-stack-dialog-panel team-stack-dialog-panel-scroll">
              <p className="team-stack-dialog-label">详细内容</p>
              <div className="agent-team-dialog-flow mt-3">
                {activeVisibleItems.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">等待更多处理结果…</p>
                ) : (
                  activeVisibleItems.map((item, index) => {
                    const itemKey = item.kind === 'text'
                      ? `team-text-${latestActiveTask.taskId}-${index}`
                      : item.kind === 'hint'
                        ? `team-hint-${latestActiveTask.taskId}-${index}`
                        : item.kind === 'tool'
                          ? `team-tool-${item.call.callId || index}`
                          : `team-perm-${item.request.callId || index}`
                    const itemIsLive = activeVisualStatus === 'running' && liveNow - item.ts < 1500

                    if (item.kind === 'hint') {
                      return (
                        <div key={itemKey} className="subagent-stream-item" data-live={itemIsLive ? 'true' : undefined}>
                          {renderHint(item.data.content, itemKey, true)}
                        </div>
                      )
                    }

                    if (item.kind === 'tool') {
                      return (
                        <div key={itemKey} className="subagent-stream-item" data-live={itemIsLive ? 'true' : undefined}>
                          <ToolCallCard
                            call={item.call}
                            result={item.result}
                            isRunning={item.isRunning}
                            onOpenFilePreview={onOpenFilePreview}
                          />
                        </div>
                      )
                    }

                    if (item.kind === 'permission') {
                      return (
                        <div key={itemKey} className="subagent-stream-item" data-live={itemIsLive ? 'true' : undefined}>
                          <PermissionRequestCard
                            request={item.request}
                            result={item.result}
                            onRespondPermission={onRespondPermission}
                          />
                        </div>
                      )
                    }

                    return (
                      <div key={itemKey} className="subagent-stream-item" data-live={itemIsLive ? 'true' : undefined}>
                        {renderTextBlock(item.text, itemKey, true)}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function truncateToolContent(content: string, limit = 2400): string {
  return content.length > limit ? `${content.slice(0, limit)}...` : content
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
  const contentId = useId()
  const filePreview = extractFilePreviewData(call, result)
  const toolName = getToolDisplayName(call.name)
  const durationLabel = formatDurationMs(result?.durationMs)
  const renderHintLabel = result?.renderHint ? getToolRenderHintLabel(result.renderHint) : ''
  const metadataText = result?.metadata ? JSON.stringify(result.metadata, null, 2) : ''

  return (
    <div className="mb-1.5">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/40">
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
              {renderHintLabel && result && (
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                  {renderHintLabel}
                </span>
              )}
              {durationLabel && result && (
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                  {durationLabel}
                </span>
              )}
              <span className={cn(
                'text-[10px] flex-shrink-0',
                isRunning ? 'text-yellow-500' : result?.isError ? 'text-red-500' : result ? 'text-green-600' : 'text-muted-foreground'
              )}>
                {isRunning ? '执行中' : result?.isError ? '失败' : result ? '完成' : ''}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {isRunning ? 'Agent 正在执行这个步骤。' : getToolResultSummary(call, result, filePreview)}
            </p>

            {filePreview && (
              <button
                onClick={() => onOpenFilePreview(filePreview)}
                className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-accent/55 px-2.5 py-2 text-left transition-colors hover:bg-accent"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-card shadow-sm">
                  <FileText size={15} className="text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium text-foreground">{filePreview.fileName}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{filePreview.path}</div>
                </div>
                <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                  {filePreview.operation === 'read_file' ? '查看内容' : '查看写入'}
                </span>
              </button>
            )}

          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg hover:bg-muted"
            aria-label={expanded ? '收起工具详情' : '展开工具详情'}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            {expanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
          </button>
        </div>

        <div id={contentId} hidden={!expanded} className="space-y-2 border-t border-border px-3 py-2">
          {call.name && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">工具名</p>
              <pre className="rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{call.name}</pre>
            </div>
          )}
          {call.content && call.content !== '{}' && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">输入参数</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{call.content}</pre>
            </div>
          )}
          {result?.filePath && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">关联文件</p>
              <pre className="rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{result.filePath}</pre>
            </div>
          )}
          {metadataText && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">Metadata</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{metadataText}</pre>
            </div>
          )}
          {isRunning && !result && (
            <div className="flex items-center gap-1.5 py-0.5">
              <Loader2 size={10} className="animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">等待返回...</span>
            </div>
          )}
        </div>
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
  const contentId = useId()
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
      <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/80 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
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
            <div className="mt-1 rounded-lg border border-amber-200/70 bg-white/70 px-2.5 py-2 dark:border-amber-900/30 dark:bg-background/80">
              {requestData?.command ? (
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-black/[0.04] px-2 py-1.5 text-[11px] font-mono text-foreground/90 dark:bg-white/[0.05]">
                  {requestData.command}
                </pre>
              ) : (
                <p className="line-clamp-3 break-all text-[11px] text-foreground/90">
                  {requestData?.message || '这个操作需要先得到你的确认。'}
                </p>
              )}
              {!requestData?.command && requestData?.description && (
                <p className="mt-1 line-clamp-2 break-all text-[10px] text-muted-foreground">
                  {requestData.description}
                </p>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{requestData?.isReadOnly ? '只会读取信息' : '可能修改文件或环境'}</span>
              {request.name && <span>{getToolDisplayName(request.name)}</span>}
            </div>
            {!requestData?.command && requestData?.message && requestData.description && (
              <p className="mt-1 text-[10px] text-muted-foreground">
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
                      'min-h-11 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
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
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
            aria-label={expanded ? '收起审批详情' : '展开审批详情'}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            {expanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
          </button>
        </div>

        <div id={contentId} hidden={!expanded} className="space-y-2 border-t border-amber-200/70 px-3 py-2 dark:border-amber-900/30">
          {requestData?.toolInput && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">操作详情</p>
              <pre className="max-h-40 overflow-x-auto rounded-lg bg-background/80 p-2 text-[11px] font-mono text-foreground/80">
                {requestData.toolInput}
              </pre>
            </div>
          )}
          {resultData?.message && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">审批结果</p>
              <pre className="overflow-x-auto rounded-lg bg-background/80 p-2 text-[11px] font-mono text-foreground/80">
                {resultData.message}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FilePreviewDrawer({ preview, onClose }: { preview: FilePreviewData | null; onClose: () => void }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!preview) return
    closeButtonRef.current?.focus()
  }, [preview])

  useEffect(() => {
    if (!preview) return

    const dialog = dialogRef.current
    if (!dialog) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (!first || !last) {
        event.preventDefault()
        closeButtonRef.current?.focus()
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [preview])

  if (!preview) return null

  const ext = preview.fileName.includes('.') ? preview.fileName.split('.').pop()!.toLowerCase() : ''
  const language = getFileLanguage(ext)
  const isImage = /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(ext)
  const isMarkdown = ext === 'md' || ext === 'mdx'

  return createPortal(
    <div className="fixed inset-0 z-[200] flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        ref={dialogRef}
        className="relative ml-auto flex h-full w-full max-w-3xl flex-col border-l border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="border-b border-border bg-card/95 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-accent shadow-sm">
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 id={titleId} className="truncate text-sm font-semibold text-foreground">
                  {preview.fileName || '文件预览'}
                </h3>
                <span className="rounded-full border border-border bg-accent/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {preview.operation === 'read_file' ? 'read_file' : 'write_file'}
                </span>
                {language && (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                    {language}
                  </span>
                )}
              </div>
              <p className="mt-1 break-all text-[11px] text-muted-foreground">{preview.path || ''}</p>
              {preview.operation === 'read_file' && preview.limit != null && (
                <p className="mt-1 text-[10px] text-muted-foreground">展示读取结果，调用限制为 {preview.limit} 行</p>
              )}
              {preview.operation === 'write_file' && (
                <p className="mt-1 text-[10px] text-muted-foreground">展示写入文件时提交的内容</p>
              )}
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="relative z-10 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted"
              aria-label="关闭文件预览"
            >
              <X size={15} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-background/65 p-5">
          {!preview.content ? (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
              <div>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                  <FileText size={18} className="text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">没有可展示的文件内容</p>
                <p className="mt-1 text-xs text-muted-foreground">这个工具调用没有返回可预览的文本。</p>
              </div>
            </div>
          ) : isImage ? (
            <div className="flex h-full items-center justify-center">
              <img
                src={`file://${preview.path}`}
                alt={preview.fileName}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
          ) : isMarkdown ? (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="prose max-w-none break-words text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-hr:my-4 prose-hr:border-border/70 prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-code:break-all prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:text-foreground prose-img:rounded-lg dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="min-h-full overflow-auto rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <span className="text-[11px] text-muted-foreground">{preview.fileName}</span>
                {language && <span className="text-[10px] text-muted-foreground">{language}</span>}
              </div>
              <pre className="overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-6 text-foreground">
                {preview.content.split('\n').map((line, i) => (
                  <div key={i} className="flex">
                    <span className="mr-4 inline-block w-8 flex-shrink-0 select-none text-right text-muted-foreground/50">{i + 1}</span>
                    <span className="min-w-0 flex-1">{line || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  )
}

function ThinkingIndicator({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return (
    <div className="flex justify-start">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full max-w-full rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/50 sm:max-w-[88%] xl:max-w-[80%]"
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        <div className="flex items-center gap-2">
          <Brain size={12} className="animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">Agent 正在整理答案</span>
        </div>
        <p id={contentId} hidden={!expanded} className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{content}</p>
      </button>
    </div>
  )
}
