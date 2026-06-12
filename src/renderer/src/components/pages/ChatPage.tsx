import { memo, useState, useRef, useEffect, useCallback, useMemo, useId, useSyncExternalStore, useContext, createContext, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Send, Plus, Copy, Check, Trash2,
  Loader2, Wrench, Brain, AlertCircle, RefreshCw, ChevronDown, ChevronUp,
  FileText, File, Folder, X, ArrowDown, AtSign, GitBranch, ListTodo, Users, MessagesSquare, ChevronLeft, ChevronRight, Search, HelpCircle, FolderOpen, Download,
  Globe, ExternalLink, Pencil, FolderPlus, FolderMinus,
  PenLine, Clock, ShieldQuestion, ThumbsUp, ThumbsDown, Image as ImageIcon
} from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { visit, SKIP } from 'unist-util-visit'
import { cn, localFileUrl } from '@/lib/utils'
import { trackSessionCreate, trackMessageSent } from '@/lib/telemetry'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'
import { FilePreviewModal } from '../attachments/FilePreviewModal'
import {
  buildSkillComposerPayload,
  SkillComposerInput,
  type SelectedSkillChip,
} from '../common/SkillComposerInput'
import { useAppConfig } from '@/hooks/useEngineConfig'
import { getProjectDisplayDescription, getProjectDisplayName } from '@/lib/projectDisplay'
import { PastedBlocksBar, usePastedBlocks } from '../common/PastedBlocksBar'
import { PlanDraftCard, type PlanDraftStep } from '../common/PlanDraftCard'
import { PlanStatusButton } from '../common/PlanStatusButton'
import { SessionStatsButton } from '../common/SessionStatsButton'
import { AvatarLightbox } from '../common/AvatarLightbox'
import { ConfirmDeleteSessionDialog } from '../common/ConfirmDeleteSessionDialog'
import { ConversationSidePanel } from '../common/ConversationSidePanel'
import { SystemNoticeModal, type SystemNotice } from '../common/SystemNoticeModal'
import emmaAvatar from '../../assets/emma-avatar.svg'
import emmaText from '../../assets/emma-text.svg'
import analystAvatar from '../../assets/team/analyst.png'
import developerAvatar from '../../assets/team/developer.png'
import lifestyleAvatar from '../../assets/team/lifestyle.png'
import researcherAvatar from '../../assets/team/researcher.png'
import writerAvatar from '../../assets/team/writer.png'

const TEAM_AVATARS = [analystAvatar, developerAvatar, lifestyleAvatar, researcherAvatar, writerAvatar]

function resolveTeamAvatar(name?: string): string {
  const key = (name || '').toLowerCase()
  if (/analy|analyst|data|分析|数据/.test(key)) return analystAvatar
  if (/dev|develop|engineer|coder|code|程序|开发|工程/.test(key)) return developerAvatar
  if (/life|lifestyle|生活|日常/.test(key)) return lifestyleAvatar
  if (/research|search|explore|调研|研究|搜索/.test(key)) return researcherAvatar
  if (/writ|writer|copy|edit|文案|写作|编辑/.test(key)) return writerAvatar
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return TEAM_AVATARS[Math.abs(hash) % TEAM_AVATARS.length]
}

// ─── File-path linkification ────────────────────────────────────────────────

// Match absolute UNIX paths, tilde-prefixed paths and Windows drive paths.
//
// The leading segment is constrained to a whitelist of well-known filesystem
// roots so that arbitrary slash-separated labels like `/CRM/Jira/Figma`,
// `/Marketing/Q3/Plan` or `/Sales/Pipeline` (which are category breadcrumbs,
// NOT real paths) don't get rendered as clickable FilePathChips. Anything
// that the OS would actually accept as the start of a path on macOS / Linux
// (or any drive-prefixed Windows path) is still linkified normally.
//
// Each match must contain at least one separator segment after the root
// anchor — bare `/Users` or `~` alone won't match.
const FILE_PATH_REGEX = /(?:~|\/(?:Users|home|var|tmp|usr|opt|etc|private|Library|Applications|System|mnt|media|dev|proc|sys|srv|root|bin|sbin|run)|[A-Za-z]:[\\/])(?:[\\/][A-Za-z0-9._-]+)+/g
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
      // Force a solid white background + dark text so the chip stays readable
      // even when it appears inside dark/contrast-heavy contexts (e.g., a
      // shell error string like `"~/.config/amp/settings.json" E212: Can't
      // open file for writing` rendered inside a code block / stderr panel).
      // Without this, `bg-muted/40 + text-foreground` collapsed to white-on-
      // white in some themes and the path became unreadable.
      className="not-prose mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 align-baseline text-[12px] font-medium text-slate-900 shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/5 dark:border-slate-300 dark:bg-white dark:text-slate-900"
    >
      <FileText size={12} className="flex-shrink-0 text-primary" />
      <span className="truncate max-w-[280px]">{fileName}</span>
    </button>
  )
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

/**
 * v1.13: ArtifactRef wire shape (see harnessclaw-engine websocket protocol §10.6).
 * Stored inside `ToolActivity.metadata.artifacts` so it round-trips through the
 * existing metadata_json DB column without a schema change.
 */
export interface ArtifactRef {
  artifact_id: string
  name?: string
  type?: string
  mime_type?: string
  size_bytes?: number
  description?: string
  preview_text?: string
  uri?: string
  role?: string
}

interface ToolErrorRecovery {
  action?: string
  next_card_id?: string
}

interface ToolActivity {
  type:
    | 'hint'
    | 'call'
    | 'result'
    | 'status'
    | 'permission'
    | 'permission_result'
    | 'question'
    | 'question_result'
    // v0.5.0 — failure decision gate (continue / retry / cancel) surfaced
    // by Scheduler / PlanCoordinator when retries / re-plans run out.
    | 'step_decision'
    | 'step_decision_result'
  name?: string
  content: string
  callId?: string
  isError?: boolean
  durationMs?: number
  renderHint?: string
  language?: string
  filePath?: string
  metadata?: Record<string, unknown>
  /** v1.12: agent.intent attached at sub-agent tool_start, rendered as the tool card header line. */
  intent?: string
  ts: number
  subagent?: SubagentInfo
  /**
   * v2 §6.5 — terminal status from card.close.payload.status:
   * `ok` / `failed` / `cancelled` / `skipped`. The renderer uses this to
   * route between green-completed, red/orange-failed and gray
   * cancelled/skipped treatments. `cancelled` is deliberately decoupled
   * from `isError` so abort flows render as neutral gray, not error red.
   */
  status?: string
  /**
   * v2 §12 — categorized failure type. One of
   * invalid_input / permission_denied / tool_timeout / user_aborted /
   * rate_limit / overloaded / model_error / contract_fail /
   * dependency_fail / internal. Unknown values fall back to `internal`
   * presentation (never thrown / never rendered raw).
   */
  errorType?: string
  /** v2 §12 — opaque error code for diagnostics, e.g. "HTTP 429". */
  errorCode?: string
  /** v2 §12 — engine hint that an automatic retry is in progress / will be attempted. */
  retryable?: boolean
  /** v2 §12 — countdown until next retry in ms. Display-only, not a control. */
  retryAfterMs?: number
  /** v2 §12 — recovery hint reserved for future engine versions. Render defensively. */
  recovery?: ToolErrorRecovery
  /**
   * v2 §12 — developer-facing `error.message` (e.g. "unknown tool: WebFetch").
   * Hidden from the main UI; only rendered inside the collapsible "详情"
   * panel or a hover tooltip for diagnostics. The primary user-facing
   * string lives in `content` and is sourced from `error.user_message`.
   */
  devMessage?: string
  /** v2 phases — 仅在 type='call' 且 result 未到达时有效。
   *  引擎流式追踪到的卡片阶段。 */
  phase?: 'planning' | 'planning_args' | 'queued'
        | 'permission_wait' | 'executing'
  phaseHint?: string      // 引擎解析好的中文
  phaseBytes?: number     // 字节计数（开发者面板用，UI 通常显示 phaseHint）
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
  hintSummary?: string // v2.2 M4: from card.add(message) Hint.Summary; shown while content is empty
}

interface SessionItem {
  key: string
  updatedAt?: string
}

export interface FilePreviewData {
  path: string
  fileName: string
  operation: 'read_file' | 'write_file'
  content: string
  limit?: number
  /**
   * `true` when the underlying file is a binary format (e.g. .docx, .pdf,
   * .xlsx, images) that cannot be safely round-tripped through a UTF-8
   * string. In that case `content` is usually empty (placeholder UI) and
   * exporting uses the original `path` as `sourcePath` so the raw bytes are
   * copied verbatim instead of being written as garbled text.
   */
  isBinary?: boolean
  /**
   * When the main process was able to convert a binary file (docx / xlsx /
   * pptx / pdf) into something readable, `content` is populated and this
   * flag tells the renderer how to display it:
   *   - 'html': dangerouslySetInnerHTML inside a prose container (docx via
   *     mammoth, xlsx via SheetJS, pptx via the inline parser).
   *   - 'text': render in a whitespace-preserving prose surface (pdf via
   *     pdf-parse).
   * `isBinary` is still set so export copies the original file bytes
   * verbatim instead of writing the converted preview back out.
   */
  previewKind?: 'html' | 'text'
  /**
   * When the preview originated from an ArtifactRef (top-bar dropdown /
   * in-drawer file list / inline `artifact://` link), the artifact_id is
   * kept here so the drawer's side-list can still match this preview
   * against the session's artifact list — `path` swaps from
   * `artifact://art_xxx` to the cached temp-file path during fetch+read,
   * so we can no longer match on `path` alone.
   */
  artifactId?: string
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

interface AskQuestionRequestData {
  question: string
  options: Array<{ label: string; description?: string }>
  multi: boolean
  allowCustom: boolean
}

interface AskQuestionResultData {
  status: 'success' | 'cancelled'
  output: string
  errorMessage?: string
}

// v0.5.0 §7.1 kind=step_decision — payload shape used by StepDecisionCard.
interface StepDecisionRequestData {
  scope: 'step' | 'plan'
  stepId: string
  stepDescription: string
  reason: string
  attempts: number
  allowRetry: boolean
}

interface StepDecisionResultData {
  decision: 'continue' | 'retry' | 'cancel'
  note?: string
}

type RespondStepDecisionHandler = (
  requestId: string,
  decision: 'continue' | 'retry' | 'cancel',
  note?: string,
) => Promise<{ ok: boolean; error?: string }>

interface SystemNoticeData {
  kind: 'error'
  title: string
  message: string
  reason?: string
  sessionId?: string
  hint?: string
}

/**
 * Search-result URL extracted from a tool result's metadata.urls (WebSearch /
 * TavilySearch). Rendered as a clickable chip in the tool card; clicking
 * opens the WebPreviewDrawer.
 */
interface SearchResultUrl {
  url: string
  title?: string
}

interface WebPreviewData {
  url: string
  title?: string
  query?: string
}

interface GeneratedImagePreview {
  path: string
  fileName: string
  mime?: string
  bytes?: number
  model?: string
  prompt?: string
  size?: string
}

/**
 * Lightweight context so any tool card (or any future surface) can request
 * an in-app web preview without prop-drilling through MessageBubble /
 * ToolActivityList. The provider lives at the ChatPage root so the drawer
 * outlives session switching and bubble re-renders.
 */
const WebPreviewContext = createContext<((data: WebPreviewData) => void) | null>(null)

function useOpenWebPreview(): ((data: WebPreviewData) => void) | null {
  return useContext(WebPreviewContext)
}

/**
 * User preference for how plain http(s) links inside markdown messages should
 * open: in the built-in WebPreviewDrawer (`'drawer'`) or via the system's
 * default browser through `shell.openExternal` (`'external'`). Configured in
 * Settings → UI 设置. Default is `'drawer'`.
 */
export type LinkOpenBehavior = 'drawer' | 'external'
const LinkOpenBehaviorContext = createContext<LinkOpenBehavior>('drawer')

type AttachmentItem = LocalAttachmentItem
type RespondPermissionHandler = (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
type RespondAskQuestionHandler = (toolUseId: string, status: 'success' | 'cancelled', output?: string, errorMessage?: string) => Promise<{ ok: boolean; error?: string }>

// Per-session state
interface SessionState {
  messages: Message[]
  pendingAssistantId: string | null
  isProcessing: boolean
  currentThinking: string
  /**
   * v1.12: agent.intent — pre-tool progress sentence (e.g. "正在搜索 vLLM 论文").
   * Set on `agent_intent`, cleared when the matching tool finishes (matched by
   * `toolUseId`) or when the assistant turn ends.
   */
  currentIntent?: {
    text: string
    toolUseId: string
    agentName: string
    fromSubagent: boolean
  }
  isPaused: boolean
  isStopping: boolean
  pauseReason?: string
  collaboration: CollaborationState
  /**
   * v1.15+ pending plan-confirmation draft for this session.
   * Set on `plan_proposed` (or implicitly on `plan_created` for auto mode);
   * cleared on `response_end`. While `confirmed` is true the inline review
   * card is replaced by a small top-right `PlanStatusButton` that shows
   * live execution status.
   *
   * v1.16: per-step `skill` was renamed to optional `subagent_type` and
   * `availableSkills` to `availableSubagents`. The standard frontend doesn't
   * render the field — the server-side SubagentResolver picks the L3 at
   * dispatch time — so we keep it on the type only for advanced overrides.
   *
   * v1.16 §6.13/§6.16: PlanCoordinator now emits `plan.*` / `step.*`
   * lifecycle events. We keep the resolved subagent_type / per-step status /
   * output summary here so PlanStatusButton can show "执行情况".
   */
  /**
   * v0.5.0 §11 — transient engine note (e.g. retry-status from Scheduler).
   * Shown as a colored banner above the composer until a newer note arrives
   * or the current turn ends.
   */
  engineNote?: {
    text: string
    severity: 'info' | 'warn' | 'error' | string
    stepId?: string
    stepDescription?: string
    agentName?: string
    ts: number
  }
  planDraft?: {
    planId: string
    agentId?: string
    goal: string
    rationale?: string
    steps: Array<{
      id: string
      subagent_type?: string
      description?: string
      prompt?: string
      depends_on?: string[]
      /** v1.16+ live status, populated from `step.*` emit events. */
      status?: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'skipped'
      /** v1.16+ short output / failure / skip summary. */
      summary?: string
    }>
    availableSubagents: string[]
    confirmed: boolean
    /**
     * v1.16+ overall plan status driven by `plan.*` events. `running` is the
     * default once the plan is approved; `completed` / `failed` are terminal.
     */
    planStatus?: 'created' | 'running' | 'completed' | 'failed'
  }
  /**
   * v1.16: tracks whether the current turn was sent with
   * `plan_confirmation="required"`. PlanCoordinator emits `plan.created`
   * BEFORE `plan.proposed` (per §6.16); without this flag the renderer
   * would synthesize a `confirmed: true` draft on `plan.created` and never
   * show the inline review card. While true, `plan_created` skips synthesis
   * and waits for `plan_proposed`. Cleared on `plan_proposed` /
   * `plan_approved` / `response_end`.
   */
  awaitingPlanProposed?: boolean
  /**
   * v0.6.0 §10.9 — pending system notices (card_kind=system) that the user
   * has not yet acknowledged. Each notice is shown as a modal that MUST be
   * manually dismissed via "我已知晓"; we FIFO-queue them per-session so
   * concurrent notices don't overwrite each other. Dedup is by `id` (=
   * server's card_id, which is session-deduped upstream).
   */
  systemNotices?: SystemNotice[]
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

interface LoadedSkillInfo {
  name: string
  version?: string
  source?: string
}

interface SyncAgentState {
  agentId: string
  agentName: string
  description: string
  /** v1.12: full task prompt (≤800 runes) handed from parent to sub-agent. */
  task?: string
  /** Runtime execution shape — sync | async. Returns "sync" for every leaf
   *  L3 so it's nearly useless for "which worker did this" UX. */
  agentType: string
  /** LLM-facing dispatch label: writer / researcher / analyst / developer
   *  / freelancer / ... — empty for legacy events that didn't carry it.
   *  Use this (not agentType) anywhere the user needs to tell workers
   *  apart in a dashboard / list. */
  subagentType?: string
  /** Skills preloaded by SpawnSync (candidate) or LoadSkill (runtime) on
   *  this agent's first turn. Empty unless the agent definition opts
   *  into skill self-management (freelancer always; fixed L3s when they
   *  list SearchSkill / LoadSkill in AllowedTools). */
  loadedSkills?: LoadedSkillInfo[]
  parentAgentId: string
  status: 'running' | 'completed' | 'max_turns' | 'model_error' | 'aborted' | 'timeout' | 'error'
  durationMs?: number
  numTurns?: number
  deniedTools: string[]
  streamText: string
  activeToolName?: string
  activeToolStatus?: 'running' | 'completed' | 'error'
  activeToolSummary?: string
  /** v1.12: latest agent.intent for this sub-agent. Cleared on matching tool_end / subagent_end. */
  currentIntent?: { text: string; toolUseId: string }
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

interface ChatGreeting {
  tone: string
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

function getChatGreeting(t: (key: string) => string, now = new Date()): ChatGreeting {
  const hour = now.getHours()
  if (hour < 6) {
    return {
      tone: t('chat.greetings.night.tone'),
      title: t('chat.greetings.night.title'),
      detail: t('chat.greetings.night.detail'),
    }
  }
  if (hour < 12) {
    return {
      tone: t('chat.greetings.morning.tone'),
      title: t('chat.greetings.morning.title'),
      detail: t('chat.greetings.morning.detail'),
    }
  }
  if (hour < 18) {
    return {
      tone: t('chat.greetings.afternoon.tone'),
      title: t('chat.greetings.afternoon.title'),
      detail: t('chat.greetings.afternoon.detail'),
    }
  }
  return {
    tone: t('chat.greetings.evening.tone'),
    title: t('chat.greetings.evening.title'),
    detail: t('chat.greetings.evening.detail'),
  }
}

const ConversationTimeline = memo(function ConversationTimeline({
  collaboration,
  displayMessages,
  isProcessing,
  isPaused,
  isStopping,
  currentThinking,
  currentIntent,
  pendingAssistantMessage,
  planDraft,
  messagesViewportRef,
  messagesEndRef,
  onScroll,
  onOpenFilePreview,
  onPreviewUserImage,
  onOpenArtifact,
  onRespondPermission,
  onRespondAskQuestion,
  onRespondStepDecision,
  onRespondPlan,
}: {
  collaboration: CollaborationState
  displayMessages: Message[]
  isProcessing: boolean
  isPaused: boolean
  isStopping: boolean
  currentThinking: string
  currentIntent?: SessionState['currentIntent']
  pendingAssistantMessage: Message | null
  planDraft?: SessionState['planDraft']
  messagesViewportRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  onOpenFilePreview: (preview: FilePreviewData) => void
  /** v1.x: 用户消息中的图片附件改走居中 FilePreviewModal（与首页一致），
   * 不再使用右侧 FilePreviewDrawer。非图片附件仍走 onOpenFilePreview。 */
  onPreviewUserImage: (attachment: LocalAttachmentItem) => void
  onOpenArtifact?: (artifactId: string) => void
  onRespondPermission: RespondPermissionHandler
  onRespondAskQuestion: RespondAskQuestionHandler
  /** v0.5.0 — continue/retry/cancel decision reply for step_decision. */
  onRespondStepDecision: RespondStepDecisionHandler
  onRespondPlan: (planId: string, approved: boolean, options?: { steps?: PlanDraftStep[]; reason?: string }) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      ref={messagesViewportRef}
      onScroll={onScroll}
      className="flex-1 overflow-x-hidden overflow-y-auto px-4 py-5"
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5">
        <CollaborationOverview collaboration={collaboration} />

        {displayMessages.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            data-message-role={message.role}
          >
            <MessageBubble
              message={message}
              syncAgents={collaboration.syncAgents}
              onOpenFilePreview={onOpenFilePreview}
              onPreviewUserImage={onPreviewUserImage}
              onOpenArtifact={onOpenArtifact}
              onRespondPermission={onRespondPermission}
              onRespondAskQuestion={onRespondAskQuestion}
              onRespondStepDecision={onRespondStepDecision}
            />
          </div>
        ))}

        {/* v1.15+ render the editable plan draft inline while the user is
            still reviewing. After approval the inline card collapses and the
            plan migrates to the floating PlanStatusButton in the messages
            area's top-right corner (rendered by ChatPage, not here), so the
            running conversation isn't shoved down by a tall, now-read-only
            card.

            Indented by `pl-[2.625rem]` to clear the assistant avatar gutter
            so the card lines up flush with assistant message bodies (and
            with the Thinking… indicator below) instead of hugging the
            container's left edge. */}
        {/* Inline card visibility:
            • While the user is reviewing the proposed plan (`!confirmed`)
              the editable card is shown so the user can edit / approve.
            • Once the user confirms, the inline card collapses and the
              floating PlanStatusButton takes over while the engine is
              executing.
            • After the engine reaches a terminal state (`completed` /
              `failed`), the inline card is no longer shown in the chat
              area; the floating PlanStatusButton in the top-right
              continues to expose the final plan for review. */}
        {planDraft && !planDraft.confirmed && (
          <div className="flex justify-start pl-[2.625rem]" data-plan-draft-id={planDraft.planId}>
            <PlanDraftCard
              plan={{
                planId: planDraft.planId,
                agentId: planDraft.agentId,
                goal: planDraft.goal,
                rationale: planDraft.rationale,
                steps: planDraft.steps,
                availableSubagents: planDraft.availableSubagents,
              }}
              isConfirmed={planDraft.confirmed}
              onConfirm={(steps) => onRespondPlan(planDraft.planId, true, { steps })}
              onCancel={() => onRespondPlan(planDraft.planId, false, { reason: 'User declined the proposed plan' })}
            />
          </div>
        )}

        {isProcessing && currentThinking && (
          <ThinkingIndicator content={currentThinking} />
        )}

        {/* Emma intent 鎏光：作为"呼应节点"渲染在列表底部，跟着 messagesEndRef
            一起永远靠近视口底部。优先级低于 ThinkingIndicator（thinking-mode
            reasoning 内容更重要），但优先于通用 Thinking… 兜底。
            呼吸闪烁小点和鎏金字体放在同一行。 */}
        {isProcessing && !isPaused && !isStopping && !currentThinking && currentIntent?.text && (
          <div className="-my-[17px] flex items-center gap-2 justify-start pl-[2.625rem]">
            <span className="streaming-breathing-dot shrink-0" aria-label={t('chat.status.serviceContinuing')} />
            <span
              className="chat-thinking-shimmer min-w-0 truncate"
              aria-live="polite"
              title={currentIntent.text}
            >
              {currentIntent.text}
            </span>
          </div>
        )}

        {isProcessing && !isPaused && !isStopping && !currentThinking && !currentIntent?.text && !pendingAssistantMessage?.content && !(pendingAssistantMessage?.tools && pendingAssistantMessage.tools.length > 0) && (
          <div className="-my-[17px] flex items-center gap-2 justify-start pl-[2.625rem]">
            <span className="streaming-breathing-dot shrink-0" aria-label={t('chat.status.serviceContinuing')} />
            <span className="chat-thinking-shimmer" aria-live="polite">Thinking…</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  )
})

const ConversationQuickNav = memo(function ConversationQuickNav({
  displayMessages,
  messagesViewportRef,
}: {
  displayMessages: Message[]
  messagesViewportRef: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const userMessages = useMemo(
    () => displayMessages.filter((m) => m.role === 'user'),
    [displayMessages]
  )

  const [isHovered, setIsHovered] = useState(false)
  const [isScrollLong, setIsScrollLong] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const upWheelTimestampsRef = useRef<number[]>([])
  const upWheelDistancesRef = useRef<number[]>([])
  const idleTimerRef = useRef<number | null>(null)
  const fadeTimerRef = useRef<number | null>(null)
  const navRef = useRef<HTMLDivElement>(null)

  const userMessagesRef = useRef(userMessages)
  userMessagesRef.current = userMessages
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex

  const updateActiveIndex = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    const viewportRect = viewport.getBoundingClientRect()
    const anchor = viewportRect.top + 16
    let bestIdx = -1
    let bestDist = Infinity
    userMessagesRef.current.forEach((msg, idx) => {
      const el = viewport.querySelector(
        `[data-message-id="${msg.id}"]`
      ) as HTMLElement | null
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom) return
      const dist = Math.abs(rect.top - anchor)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = idx
      }
    })
    if (bestIdx !== -1) setActiveIndex(bestIdx)
  }, [messagesViewportRef])

  const scrollToIndex = useCallback(
    (idx: number) => {
      const viewport = messagesViewportRef.current
      const target = userMessagesRef.current[idx]
      if (!viewport || !target) return
      const el = viewport.querySelector(
        `[data-message-id="${target.id}"]`
      ) as HTMLElement | null
      if (!el) return
      const top = Math.max(0, el.offsetTop - 16)
      viewport.scrollTo({ top, behavior: 'smooth' })
      setActiveIndex(idx)
    },
    [messagesViewportRef]
  )
  const scrollToIndexRef = useRef(scrollToIndex)
  scrollToIndexRef.current = scrollToIndex

  // Listeners:
  // - wheel: trigger panel when user pages UP repeatedly (>3 upward events within 2s window)
  // - scroll: keep active index in sync; auto-fade panel after scroll idle
  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return

    const UP_WINDOW_MS = 2000
    const UP_EVENT_THRESHOLD = 8 // strictly greater than 8 upward wheel events in window
    const UP_DISTANCE_THRESHOLD = 800 // and accumulated upward |deltaY| >= 800px

    const onWheel = (e: WheelEvent) => {
      // Downward scroll → close the panel immediately
      if (e.deltaY > 0) {
        upWheelTimestampsRef.current = []
        upWheelDistancesRef.current = []
        if (fadeTimerRef.current != null) {
          window.clearTimeout(fadeTimerRef.current)
          fadeTimerRef.current = null
        }
        setIsScrollLong(false)
        return
      }
      // Only count upward (negative deltaY) wheel events
      if (e.deltaY >= 0) return
      const now = Date.now()
      const ts = upWheelTimestampsRef.current
      const distances = upWheelDistancesRef.current
      ts.push(now)
      distances.push(Math.abs(e.deltaY))
      // Drop entries older than the rolling window
      while (ts.length > 0 && now - ts[0] > UP_WINDOW_MS) {
        ts.shift()
        distances.shift()
      }
      const totalDistance = distances.reduce((sum, d) => sum + d, 0)
      if (ts.length > UP_EVENT_THRESHOLD && totalDistance >= UP_DISTANCE_THRESHOLD) {
        setIsScrollLong(true)
        if (fadeTimerRef.current != null) {
          window.clearTimeout(fadeTimerRef.current)
          fadeTimerRef.current = null
        }
      }
    }

    const onScroll = () => {
      updateActiveIndex()
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(() => {
        // Scroll idle — clear upward-event history and queue fade-out
        upWheelTimestampsRef.current = []
        upWheelDistancesRef.current = []
        if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = window.setTimeout(() => {
          setIsScrollLong(false)
        }, 1500)
      }, 600)
    }

    viewport.addEventListener('wheel', onWheel, { passive: true })
    viewport.addEventListener('scroll', onScroll, { passive: true })
    updateActiveIndex()
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('scroll', onScroll)
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current)
      if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current)
    }
  }, [messagesViewportRef, updateActiveIndex])

  // Recalc when message list changes
  useEffect(() => {
    updateActiveIndex()
  }, [userMessages, updateActiveIndex])

  // Wheel inside the nav steps between messages
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    let lastWheel = 0
    const onWheel = (e: WheelEvent) => {
      const msgs = userMessagesRef.current
      if (msgs.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      const now = Date.now()
      if (now - lastWheel < 120) return
      lastWheel = now
      const direction = e.deltaY > 0 ? 1 : -1
      const cur = activeIndexRef.current < 0 ? 0 : activeIndexRef.current
      const next = Math.max(0, Math.min(msgs.length - 1, cur + direction))
      if (next !== cur) scrollToIndexRef.current(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  if (userMessages.length === 0) return null

  const visible = isHovered || isScrollLong

  return (
    <>
      {/* Right-edge hover hot-zone (always interactive, invisible) */}
      <div
        className="pointer-events-auto absolute bottom-0 right-0 top-0 z-20 w-12"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-hidden="true"
      />
      {/* Quick nav pill */}
      <div
        ref={navRef}
        className={cn(
          'absolute right-3 top-1/2 z-30 -translate-y-1/2 transition-all duration-200 ease-out',
          visible
            ? 'pointer-events-auto translate-x-0 opacity-100'
            : 'pointer-events-none translate-x-2 opacity-0'
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role="navigation"
        aria-label={t('chat.chatQuickSwitch')}
      >
        <div className="flex max-h-[60vh] flex-col items-center gap-2 overflow-y-auto px-1 py-2">
          {userMessages.map((msg, idx) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => scrollToIndex(idx)}
              title={(msg.content || '').slice(0, 60) || t('chat.header.chatIndex', { n: idx + 1 })}
              aria-label={t('chat.header.jumpToIndex', { n: idx + 1 })}
              aria-current={activeIndex === idx ? 'true' : undefined}
              className={cn(
                'h-1.5 rounded-full transition-all',
                activeIndex === idx
                  ? 'w-7 bg-orange-500'
                  : 'w-5 bg-slate-400 hover:w-6 hover:bg-slate-600 dark:bg-slate-300 dark:hover:bg-slate-100'
              )}
            />
          ))}
        </div>
      </div>
    </>
  )
})

function TeamStackDeck({ teams }: { teams: TeamState[] }) {
  const { t } = useTranslation()
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
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('chat.team.title')}</p>
        </div>

        <div className="team-stack-shell">
          {hasMultipleTeams && (
            <button
              type="button"
              onClick={handlePrev}
              className="team-stack-nav team-stack-nav-left"
              aria-label={t('chat.team.prevTeamAria')}
            >
              <ChevronLeft size={16} />
            </button>
          )}

          <div className="team-stack-stage" data-two-up={teams.length === 2 ? 'true' : undefined}>
            {showLeftPreview && (
              <div className="team-stack-card team-stack-card-left" aria-hidden="true">
                <div className="team-stack-card-top">
                  <span className="team-stack-card-name">{previousTeam.teamName}</span>
                  <span className="team-stack-card-meta">{t('chat.team.memberCount', { n: previousTeam.members.length })}</span>
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
                <span className="team-stack-card-meta">{t('chat.team.memberCount', { n: activeTeam.members.length })}</span>
              </div>
              <div className="team-stack-card-body">
                <div className="team-stack-card-badge">{getTeamEventLabel(t, activeTeam)}</div>
                <p className="team-stack-card-summary">{getTeamEventSummary(t, activeTeam)}</p>
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
                <span>{t('chat.team.lastUpdate', { time: formatTeamUpdateTime(activeTeam.updatedAt) })}</span>
                <span className="inline-flex items-center gap-2">
                  <span>{t('chat.team.details')}</span>
                  <span className="team-stack-card-dot" />
                </span>
              </div>
            </button>

            {showRightPreview && (
              <div className="team-stack-card team-stack-card-right" aria-hidden="true">
                <div className="team-stack-card-top">
                  <span className="team-stack-card-name">{nextTeam.teamName}</span>
                  <span className="team-stack-card-meta">{t('chat.team.memberCount', { n: nextTeam.members.length })}</span>
                </div>
              </div>
            )}
          </div>

          {hasMultipleTeams && (
            <button
              type="button"
              onClick={handleNext}
              className="team-stack-nav team-stack-nav-right"
              aria-label={t('chat.team.nextTeamAria')}
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {hasMultipleTeams && (
          <div className="team-stack-dots" aria-label={t('chat.team.switchProgress')}>
            {teams.map((team, index) => (
              <button
                key={team.teamId}
                type="button"
                onClick={() => setActiveIndex(index)}
                className="team-stack-dot"
                data-active={index === activeIndex ? 'true' : undefined}
                aria-label={t('chat.team.switchTeamAria', { name: team.teamName })}
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
                aria-label={t('chat.team.closeDetails')}
              >
                <X size={15} />
              </button>
            </div>

            <div className="team-stack-dialog-grid">
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">{t('chat.team.status')}</p>
                <div className="team-stack-dialog-badge">{getTeamEventLabel(t, activeTeam)}</div>
                <p id={descriptionId} className="team-stack-dialog-copy">{getTeamEventSummary(t, activeTeam)}</p>
              </div>
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">{t('chat.team.size')}</p>
                <p className="team-stack-dialog-stat">{activeTeam.members.length}</p>
                <p className="team-stack-dialog-copy">{t('chat.team.lastUpdate', { time: formatTeamUpdateTime(activeTeam.updatedAt) })}</p>
              </div>
            </div>

            <div className="team-stack-dialog-panel">
              <p className="team-stack-dialog-label">{t('chat.team.membersLabel')}</p>
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

function createSyncAgentState(t: (key: string) => string, agentId: string, now: number): SyncAgentState {
  return {
    agentId,
    agentName: 'subagent',
    description: t('chat.status.subagentTask'),
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
  return globalThis.crypto.randomUUID()
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

  // v1.x: 之前只把非图片附件写进 JSON 元数据块，导致切换会话后图片附件
  // 无法从 DB 恢复（extractAttachments 拿不到它们的元信息），UI 上图片就
  // 丢失了。现在把所有附件元数据都持久化进 JSON 块；图片的 base64 内容
  // 仍然只通过 multimodal 通道发送，不会出现在 prompt 文本里。
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

  const hasImages = attachments.some((a) => a.kind === 'image')
  const instructions = [
    'Attached local files are listed below.',
    hasImages
      ? 'Image entries (kind = "image") are already supplied as inline multimodal content in this turn — do NOT try to re-read them with filesystem tools; use the local path or URL only for non-image files.'
      : 'Use the local path or file URL with filesystem tools when you need to inspect file contents.',
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

/**
 * Pull a clickable URL list out of a tool-result's metadata. WebSearch and
 * TavilySearch populate `metadata.urls` as `[{url, title}, ...]` per the
 * current engine protocol (card.close inner.metadata.urls).
 */
function extractSearchResultUrls(metadata?: Record<string, unknown>): SearchResultUrl[] {
  if (!metadata) return []
  const raw = metadata.urls
  if (!Array.isArray(raw)) return []
  const out: SearchResultUrl[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const url = typeof entry.url === 'string' ? entry.url.trim() : ''
    if (!/^https?:\/\//i.test(url)) continue
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : undefined
    out.push({ url, title })
  }
  return out
}

function extractSearchQuery(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata) return undefined
  return typeof metadata.query === 'string' && metadata.query.trim() ? metadata.query.trim() : undefined
}

function extractSearchResultCount(metadata?: Record<string, unknown>): number | undefined {
  if (!metadata) return undefined
  return typeof metadata.result_count === 'number' && Number.isFinite(metadata.result_count)
    ? metadata.result_count
    : undefined
}

function extractGeneratedImagesFromMetadata(metadata?: Record<string, unknown>): GeneratedImagePreview[] {
  const raw = metadata?.images
  if (!Array.isArray(raw)) return []
  const images: GeneratedImagePreview[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    if (!path || !path.startsWith('/')) continue
    images.push({
      path,
      fileName: getFileName(path),
      mime: typeof item.mime === 'string' ? item.mime : undefined,
      bytes: typeof item.bytes === 'number' && Number.isFinite(item.bytes) ? item.bytes : undefined,
      model: typeof item.model === 'string' ? item.model : undefined,
      prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
      size: typeof item.size === 'string' ? item.size : undefined,
    })
  }
  return images
}

function safeUrlHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Resolve a favicon URL for the given site host. Uses Google's public
 * favicon proxy so we get a normalized PNG regardless of whether the
 * site itself exposes a fetchable /favicon.ico. Returns an empty string
 * when the host cannot be derived (which short-circuits `<FaviconImage>`
 * to the default Globe glyph).
 */
function faviconUrl(host: string, size = 32): string {
  if (!host) return ''
  // Strip any path/protocol just in case; Google's proxy only wants the
  // bare domain. Encodes high-bit characters defensively.
  const bare = host.replace(/^https?:\/\//i, '').split('/')[0]
  if (!bare) return ''
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(bare)}&sz=${size}`
}

/**
 * Small `<img>` wrapper that tries to fetch the site's real favicon and
 * silently falls back to the lucide `Globe` glyph on network / 404 / CORS
 * failure. The fallback ensures we never render a broken-image icon next
 * to search results even when the favicon service is unreachable (e.g.
 * offline mode, restrictive corp proxy).
 */
function FaviconImage({ url, size = 16, className }: { url: string; size?: number; className?: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const host = safeUrlHostname(url)
  const src = faviconUrl(host, Math.max(16, size * 2))

  // Stack the placeholder Globe behind the favicon `<img>`. While the
  // network fetch is in flight (or if it 404s / is blocked by CSP / the
  // host has no favicon), the Globe glyph remains visible. Once the
  // image successfully loads we fade the placeholder out so the real
  // favicon takes over without a flash of blank space.
  if (!src || status === 'failed') {
    return <Globe size={Math.round(size * 0.7)} className={className} />
  }
  return (
    <span
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <Globe
        size={Math.round(size * 0.7)}
        className={cn(
          'absolute inset-0 m-auto transition-opacity',
          status === 'loaded' ? 'opacity-0' : 'opacity-100'
        )}
      />
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('failed')}
        className={cn(
          'relative block transition-opacity',
          status === 'loaded' ? 'opacity-100' : 'opacity-0'
        )}
        style={{ width: size, height: size }}
      />
    </span>
  )
}

/**
 * v0.3 (websocket protocol §2.4.2): when the server replays an unanswered
 * prompt after reconnect, it uses the same `request_id`. Search the whole
 * session's tool history for an existing card with the same callId+type and
 * replace it in-place; otherwise append to the fallback (current) message.
 * This preserves the original turn placement so a replayed prompt rejoins
 * its original card instead of duplicating onto the latest message.
 */
function upsertSessionToolByCallId(
  messages: Message[],
  fallbackMessageId: string,
  activity: ToolActivity,
): Message[] {
  if (activity.callId) {
    for (let i = 0; i < messages.length; i += 1) {
      const tools = messages[i].tools
      if (!tools) continue
      const index = tools.findIndex((t) => t.callId === activity.callId && t.type === activity.type)
      if (index === -1) continue
      const nextTools = tools.slice()
      nextTools[index] = activity
      const nextMessages = messages.slice()
      nextMessages[i] = { ...messages[i], tools: nextTools }
      return nextMessages
    }
  }
  return messages.map((m) => m.id === fallbackMessageId ? { ...m, tools: [...(m.tools || []), activity] } : m)
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

function createTaskStatusPayload(t: any, task: {
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
        ? t('chat.status.taskInProgress', { subject: task.activeForm || task.subject }) + (task.owner ? ` · ${task.owner}` : '')
        : task.status === 'completed'
          ? t('chat.status.taskDone', { subject: task.subject }) + (task.owner ? ` · ${task.owner}` : '')
          : task.status === 'deleted'
            ? t('chat.status.taskRemoved', { subject: task.subject })
            : t('chat.status.taskCreated', { subject: task.subject }),
  }
}

function createRoutedAgentStatusPayload(t: any, agent: {
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
    summary: t('chat.status.routedTo', { name: agent.agentName || 'agent' }),
  }
}

function createAgentMessageStatusPayload(t: any, message: {
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
    summary: message.summary || t('chat.status.collabMessage', { name: message.from || 'Agent' }),
    teamId: message.teamId,
  }
}

function createAsyncAgentStatusPayload(t: any, agent: {
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
    ? t('chat.status.agentStarted', { name: agent.agentName || 'agent' })
    : agent.status === 'idle'
      ? t('chat.status.agentWaiting', { name: agent.agentName || 'agent' })
      : agent.status === 'completed'
        ? t('chat.status.agentDone', { name: agent.agentName || 'agent' })
        : t('chat.status.agentFailed', { name: agent.agentName || 'agent' })

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

function createTeamStatusPayload(t: any, team: {
  teamId: string
  teamName?: string
  members: string[]
  lastEvent: TeamState['lastEvent']
  memberName?: string
  memberType?: string
}): PersistedTeamStatusPayload {
  const resolvedName = team.teamName || team.teamId
  const summary = team.lastEvent === 'member_join'
    ? t('chat.status.memberJoined', { name: team.memberName || t('chat.status.newMember'), team: resolvedName })
    : team.lastEvent === 'member_left'
      ? t('chat.status.memberLeft', { name: team.memberName || t('chat.status.member'), team: resolvedName })
      : team.lastEvent === 'deleted'
        ? t('chat.status.teamArchived', { team: resolvedName })
        : t('chat.status.teamCreated', { team: resolvedName })

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

function buildErrorHint(t: (key: string) => string, reason: string, message: string): string | undefined {
  if (reason === 'model_error' && message.toLowerCase().includes('not supported')) {
    return t('chat.errors.accountIssue')
  }
  if (message.toLowerCase().includes('websocket')) {
    return t('chat.errors.serviceIssue')
  }
  return undefined
}

function buildSystemErrorNotice(t: (key: string) => string, raw: unknown): SystemNoticeData {
  const root = typeof raw === 'string'
    ? (parseJsonObject(raw) || raw)
    : raw
  const payload = isRecord(root) && isRecord(root.payload) ? root.payload : root
  const record = isRecord(payload) ? payload : {}
  const fallbackContent = isRecord(root) && typeof root.content === 'string' ? root.content : ''
  const message = typeof record.message === 'string'
    ? record.message
    : fallbackContent || (typeof root === 'string' ? root : t('chat.errors.requestFailed'))
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
    title: t('chat.errors.requestFailedTitle'),
    message: message.trim() || t('chat.errors.requestFailed'),
    reason,
    sessionId,
    hint: buildErrorHint(t, reason || '', message),
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

function formatMessageTime(lang: string, timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
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

function parseAskQuestionRequestData(raw: string): AskQuestionRequestData | null {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  const options = Array.isArray(parsed.options)
    ? parsed.options.flatMap((option) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) return []
        const candidate = option as { label?: unknown; description?: unknown }
        const label = typeof candidate.label === 'string' ? candidate.label : ''
        if (!label) return []
        const description = typeof candidate.description === 'string' ? candidate.description : undefined
        return [description ? { label, description } : { label }]
      })
    : []
  return {
    question: typeof parsed.question === 'string' ? parsed.question : '',
    options,
    multi: parsed.multi === true,
    allowCustom: parsed.allow_custom !== false, // default true
  }
}

function parseAskQuestionResultData(raw: string): AskQuestionResultData | null {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  const status = parsed.status === 'cancelled' ? 'cancelled' : 'success'
  return {
    status,
    output: typeof parsed.output === 'string' ? parsed.output : '',
    errorMessage: typeof parsed.error_message === 'string' ? parsed.error_message : undefined,
  }
}

function parseStepDecisionRequestData(raw: string): StepDecisionRequestData | null {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  return {
    scope: parsed.scope === 'plan' ? 'plan' : 'step',
    stepId: typeof parsed.step_id === 'string' ? parsed.step_id : '',
    stepDescription: typeof parsed.step_description === 'string' ? parsed.step_description : '',
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    attempts: typeof parsed.attempts === 'number' ? parsed.attempts : 0,
    allowRetry: parsed.allow_retry === true,
  }
}

function parseStepDecisionResultData(raw: string): StepDecisionResultData | null {
  const parsed = parseJsonObject(raw)
  if (!parsed) return null
  const decision = parsed.decision === 'continue' || parsed.decision === 'retry' || parsed.decision === 'cancel'
    ? parsed.decision
    : 'cancel'
  return {
    decision,
    note: typeof parsed.note === 'string' ? parsed.note : undefined,
  }
}

function getConversationLabel(t: (key: string) => string, title = '', firstMessage = ''): string {
  const raw = title.trim() || firstMessage.trim() || t('chat.newChat')
  return raw.length > 24 ? `${raw.slice(0, 24)}...` : raw
}

function getToolDisplayName(t: (key: string) => string, name?: string): string {
  const toolLabels: Record<string, string> = {
    Bash: t('chat.tools.Bash'),
    Read: t('chat.tools.Read'),
    Edit: t('chat.tools.Edit'),
    Write: t('chat.tools.Write'),
    Grep: t('chat.tools.Grep'),
    Glob: t('chat.tools.Glob'),
    WebFetch: t('chat.tools.WebFetch'),
    WebSearch: t('chat.tools.WebSearch'),
    TavilySearch: t('chat.tools.TavilySearch'),
    Agent: t('chat.tools.Agent'),
    Skill: t('chat.tools.Skill'),
    TaskCreate: t('chat.tools.TaskCreate'),
    TaskGet: t('chat.tools.TaskGet'),
    TaskUpdate: t('chat.tools.TaskUpdate'),
    TaskList: t('chat.tools.TaskList'),
    SendMessage: t('chat.tools.SendMessage'),
    TeamCreate: t('chat.tools.TeamCreate'),
    TeamDelete: t('chat.tools.TeamDelete'),
    image_generate: t('chat.tools.ImageGenerate'),
    read_file: t('chat.tools.Read'),
    write_file: t('chat.tools.Write'),
    search_query: t('chat.tools.WebSearch'),
  }

  if (!name) return t('chat.defaultToolName')
  return toolLabels[name] || name.replace(/_/g, ' ')
}

function getPermissionOptionLabel(t: (key: string) => string, label: string): string {
  const normalized = label.trim().toLowerCase()
  if (normalized === 'allow once') return t('chat.permissions.allowOnce')
  if (normalized === 'always allow in this session') return t('chat.permissions.alwaysAllow')
  if (normalized === 'deny') return t('chat.permissions.deny')
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

function getToolRenderHintLabel(t: (key: string) => string, renderHint?: string): string {
  const labels: Record<string, string> = {
    terminal: t('chat.toolRenderHint.terminal'),
    code: t('chat.toolRenderHint.code'),
    diff: t('chat.toolRenderHint.diff'),
    file_info: t('chat.toolRenderHint.fileInfo'),
    search: t('chat.toolRenderHint.search'),
    markdown: t('chat.toolRenderHint.markdown'),
    agent: t('chat.toolRenderHint.agent'),
    skill: t('chat.toolRenderHint.skill'),
    task: t('chat.toolRenderHint.task'),
    message: t('chat.toolRenderHint.message'),
    team: t('chat.toolRenderHint.team'),
    plain: t('chat.toolRenderHint.plain'),
  }
  if (!renderHint) return t('chat.toolRenderHint.default')
  return labels[renderHint] || renderHint
}

function getToolResultSummary(t: (key: string) => string, call: ToolActivity, result?: ToolActivity, filePreview?: FilePreviewData | null): string {
  if (!result) return t('chat.toolResult.executing')
  // v2 §6.5 — status routing. `cancelled` / `skipped` are NOT errors;
  // surface a neutral message instead of the red error string. For
  // `failed` we always prefer the engine's user-facing message
  // (sourced from error.user_message via the main-process tool_result
  // event) over any heuristic hint, so categorized errors like rate
  // limits or contract failures get accurate copy.
  if (result.status === 'cancelled') return t('chat.toolResult.cancelled')
  if (result.status === 'skipped') return t('chat.toolResult.skipped')
  if (result.status === 'failed' || result.isError) {
    if (result.content) return result.content
    return t('chat.toolResult.failed')
  }
  if (filePreview) return t('chat.toolResult.fileInvolved', { name: filePreview.fileName })
  if (result.filePath) return t('chat.toolResult.fileAssociated', { name: getFileName(result.filePath) })
  if (result.renderHint === 'search') return t('chat.toolResult.searchSummary')
  if (result.renderHint === 'markdown') return t('chat.toolResult.markdownSummary')
  if (result.renderHint === 'terminal') return t('chat.toolResult.terminalSummary')
  if (result.renderHint === 'agent') return t('chat.toolResult.agentSummary')
  if (call.name === 'Write' || call.name === 'write_file') return t('chat.toolResult.writeSummary')
  if (call.name === 'Edit') return t('chat.toolResult.editSummary')
  return t('chat.toolResult.stepCompleted')
}

interface BrowserSessionCardState {
  session_id: string
  visible: boolean
  closed?: boolean
}

function normalizeBrowserSession(raw: unknown): BrowserSessionCardState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const candidate = raw as Record<string, unknown>
  const sessionID = typeof candidate.session_id === 'string' ? candidate.session_id.trim() : ''
  if (!sessionID) return undefined
  return {
    session_id: sessionID,
    visible: candidate.visible === true,
    closed: candidate.closed === true,
  }
}

function extractBrowserSessionID(call: ToolActivity, result?: ToolActivity): string {
  if ((call.name || '').toLowerCase() !== 'browser_session_create') return ''
  const metadataSessionID = typeof result?.metadata?.session_id === 'string' ? result.metadata.session_id.trim() : ''
  if (metadataSessionID) return metadataSessionID
  if (!result?.content) return ''
  try {
    const parsed = JSON.parse(result.content) as Record<string, unknown>
    return typeof parsed.session_id === 'string' ? parsed.session_id.trim() : ''
  } catch {
    return ''
  }
}

function extractBrowserSessionIDs(messages: Message[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const message of messages) {
    const tools = message.tools || []
    const results = tools.filter((tool) => tool.type === 'result')
    for (const tool of tools) {
      if (tool.type !== 'call') continue
      const result = results.find((candidate) => candidate.callId === tool.callId)
      const sessionID = extractBrowserSessionID(tool, result)
      if (!sessionID || seen.has(sessionID)) continue
      seen.add(sessionID)
      ids.push(sessionID)
    }
  }
  return ids
}

function normalizeBrowserSessionIDs(sessionIDs: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const raw of sessionIDs) {
    const sessionID = typeof raw === 'string' ? raw.trim() : ''
    if (!sessionID || seen.has(sessionID)) continue
    seen.add(sessionID)
    next.push(sessionID)
  }
  return next
}

async function closeBrowserSessionIDs(sessionIDs: string[]): Promise<boolean> {
  if (!window.browserAgent) return false
  const targetIDs = normalizeBrowserSessionIDs(sessionIDs)
  if (targetIDs.length === 0) return true
  const res = await window.browserAgent.closeSessions(targetIDs)
  return res.ok
}

function upsertBrowserSession(
  sessions: BrowserSessionCardState[],
  incoming: BrowserSessionCardState,
): BrowserSessionCardState[] {
  if (incoming.closed) {
    return sessions.filter((session) => session.session_id !== incoming.session_id)
  }
  const index = sessions.findIndex((session) => session.session_id === incoming.session_id)
  if (index === -1) return [...sessions, incoming]
  const next = sessions.slice()
  next[index] = incoming
  return next
}

function selectBrowserSession(sessions: BrowserSessionCardState[]): BrowserSessionCardState | undefined {
  const active = sessions.filter((session) => !session.closed)
  for (let index = active.length - 1; index >= 0; index -= 1) {
    if (active[index].visible) return active[index]
  }
  return active[active.length - 1]
}

function useBrowserSessionIndicator(sessionIDs: string[]): {
  session?: BrowserSessionCardState
  busy: boolean
  toggle: () => Promise<void>
  closeAll: () => Promise<void>
} {
  const [sessions, setSessions] = useState<BrowserSessionCardState[]>([])
  const [busy, setBusy] = useState(false)
  const session = useMemo(() => selectBrowserSession(sessions), [sessions])
  const sessionIDKey = useMemo(() => sessionIDs.join('\n'), [sessionIDs])

  useEffect(() => {
    const allowed = new Set(sessionIDs)
    if (allowed.size === 0) {
      setSessions([])
      return undefined
    }
    if (!window.browserAgent) {
      setSessions([])
      return undefined
    }
    const browserAgent = window.browserAgent
    let cancelled = false
    const refresh = async (): Promise<void> => {
      const res = await browserAgent.listSessions()
      if (cancelled || !res.ok) return
      const nextSessions = (res.sessions || [])
        .map(normalizeBrowserSession)
        .filter((item): item is BrowserSessionCardState => Boolean(item && !item.closed && allowed.has(item.session_id)))
      setSessions(nextSessions)
    }
    void refresh()
    const unsubscribe = browserAgent.onSessionChanged((next) => {
      if (cancelled) return
      const normalized = normalizeBrowserSession(next)
      if (!normalized) return
      if (!allowed.has(normalized.session_id)) return
      setSessions((current) => upsertBrowserSession(current, normalized))
    })
    const refreshOnFocus = (): void => {
      void refresh()
    }
    const refreshOnVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnVisibilityChange)
    const refreshTimer = window.setInterval(refreshOnFocus, 1500)
    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnVisibilityChange)
      window.clearInterval(refreshTimer)
    }
  }, [sessionIDKey])

  const toggle = useCallback(async () => {
    if (!session || !window.browserAgent || busy) return
    if (session?.closed) return
    setBusy(true)
    try {
      const nextVisible = !(session?.visible ?? false)
      const res = await window.browserAgent.setVisibility(session.session_id, nextVisible)
      if (res.ok && res.session) {
        const normalized = normalizeBrowserSession(res.session)
        if (normalized) setSessions((current) => upsertBrowserSession(current, normalized))
      }
    } finally {
      setBusy(false)
    }
  }, [busy, session])

  const closeAll = useCallback(async () => {
    const targetIDs = sessions
      .filter((candidate) => !candidate.closed)
      .map((candidate) => candidate.session_id)
    if (busy || targetIDs.length === 0) return
    setBusy(true)
    try {
      if (await closeBrowserSessionIDs(targetIDs)) {
        setSessions([])
      }
    } finally {
      setBusy(false)
    }
  }, [busy, sessions])

  return { session, busy, toggle, closeAll }
}

function BrowserSessionIndicatorButton({
  session,
  busy,
  onToggle,
  onCloseAll,
}: {
  session?: BrowserSessionCardState
  busy: boolean
  onToggle: () => void
  onCloseAll: () => void
}) {
  const { t } = useTranslation()
  if (!session) return null
  const visible = session.visible
  const title = visible ? t('chat.composer.browserHideAria') : t('chat.composer.browserShowAria')
  return (
    <span
      className={cn(
        'group inline-flex h-11 items-center overflow-hidden rounded-full border text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-ring/30',
        visible
          ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200 dark:hover:bg-blue-950/50'
          : 'border-border bg-muted/45 text-muted-foreground hover:border-primary/50 hover:text-foreground'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={busy || session.closed === true}
        className="inline-flex h-full min-w-11 items-center justify-center gap-2 px-3 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
        title={title}
        aria-label={title}
        aria-pressed={visible}
      >
        <span className="relative inline-flex h-5 w-5 items-center justify-center">
          <Globe size={16} aria-hidden="true" />
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
              visible ? 'bg-blue-500' : 'bg-slate-400'
            )}
            aria-hidden="true"
          />
        </span>
        <span className="hidden sm:inline">
          {visible ? t('chat.composer.browserVisible') : t('chat.composer.browserHidden')}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t('chat.composer.browserCloseAllConfirm'))) {
            onCloseAll()
          }
        }}
        disabled={busy || session.closed === true}
        className="inline-flex h-full w-0 items-center justify-center overflow-hidden border-l border-transparent text-muted-foreground opacity-0 transition-all duration-200 ease-out hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed group-hover:w-9 group-hover:border-current/10 group-hover:opacity-100 group-focus-within:w-9 group-focus-within:border-current/10 group-focus-within:opacity-100 dark:hover:bg-red-950/30 dark:hover:text-red-300"
        title={t('chat.composer.browserCloseAllAria')}
        aria-label={t('chat.composer.browserCloseAllAria')}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </span>
  )
}

/**
 * v2 §12 ErrorInfo presentation table. Maps `error.type` → icon, short
 * label, and a Tailwind color key consumed by `getToolErrorColorClasses`.
 * Keep this as the SINGLE source of truth for failure visuals so that
 * future engine-side additions to the enum can be slotted in by editing
 * this one table — never branch on `error.type` ad-hoc in render code.
 *
 * Unknown / missing values fall back to the `internal` entry (red ⚠️)
 * via `getToolErrorPresentation`. The renderer must never throw on an
 * unknown type and must never render the raw enum string to the user.
 */
function getToolErrorPresentation(t: (key: string) => string, errorType?: string): { icon: string; label: string; color: 'amber' | 'orange' | 'red' | 'gray' } {
  const presentations: Record<string, { icon: string; label: string; color: 'amber' | 'orange' | 'red' | 'gray' }> = {
    invalid_input:     { icon: '📋', label: t('chat.toolError.invalidInput'),  color: 'amber'  },
    permission_denied: { icon: '🔒', label: t('chat.toolError.permissionDenied'), color: 'amber'  },
    tool_timeout:      { icon: '⏱', label: t('chat.toolError.timeout'),      color: 'orange' },
    user_aborted:      { icon: '✋', label: t('chat.toolError.aborted'),    color: 'gray'   },
    rate_limit:        { icon: '🌐', label: t('chat.toolError.rateLimit'),  color: 'orange' },
    overloaded:        { icon: '🌐', label: t('chat.toolError.overloaded'),  color: 'orange' },
    model_error:       { icon: '🤖', label: t('chat.toolError.modelError'),  color: 'orange' },
    contract_fail:     { icon: '📋', label: t('chat.toolError.contractFail'),  color: 'amber'  },
    dependency_fail:   { icon: '🔗', label: t('chat.toolError.dependencyFail'), color: 'orange' },
    internal:          { icon: '⚠️', label: t('chat.toolError.internal'),  color: 'red'    },
    unsupported_modality: { icon: '🖼', label: t('chat.toolError.unsupportedModality'), color: 'amber' },
  }

  if (errorType && Object.prototype.hasOwnProperty.call(presentations, errorType)) {
    return presentations[errorType]
  }
  return presentations.internal
}

function getToolErrorColorClasses(color: 'amber' | 'orange' | 'red' | 'gray'): { badge: string; icon: string; text: string } {
  switch (color) {
    case 'amber':
      return {
        badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300',
        icon: 'text-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
      }
    case 'orange':
      return {
        badge: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-300',
        icon: 'text-orange-500',
        text: 'text-orange-600 dark:text-orange-400',
      }
    case 'gray':
      return {
        badge: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300',
        icon: 'text-slate-500',
        text: 'text-slate-600 dark:text-slate-300',
      }
    case 'red':
    default:
      return {
        badge: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300',
        icon: 'text-red-500',
        text: 'text-red-600 dark:text-red-400',
      }
  }
}

/**
 * v2 §12 — read structured ErrorInfo back out of `metadata.errorInfo`.
 * Used by `dbRowsToMessages` so that after a restart / session resume
 * (when the activity is reconstructed from the SQLite `metadata_json`
 * column) the renderer still has access to the categorized error type,
 * retryable hint, recovery action, dev-only message, etc.
 *
 * The main process writes the same structure into both the top-level
 * compat-event fields AND `metadata.errorInfo`, so live tool_result
 * events and DB-restored activities end up with identical shape.
 */
function extractErrorInfoFromMetadata(metadata?: Record<string, unknown>): {
  status?: string
  errorType?: string
  errorCode?: string
  retryable?: boolean
  retryAfterMs?: number
  recovery?: ToolErrorRecovery
  devMessage?: string
} {
  if (!metadata) return {}
  const raw = metadata.errorInfo
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const recoveryRaw = r.recovery
  const recovery = recoveryRaw && typeof recoveryRaw === 'object' && !Array.isArray(recoveryRaw)
    ? {
        action: typeof (recoveryRaw as Record<string, unknown>).action === 'string'
          ? ((recoveryRaw as Record<string, unknown>).action as string)
          : undefined,
        next_card_id: typeof (recoveryRaw as Record<string, unknown>).next_card_id === 'string'
          ? ((recoveryRaw as Record<string, unknown>).next_card_id as string)
          : undefined,
      }
    : undefined
  return {
    status: typeof r.status === 'string' ? r.status : undefined,
    errorType: typeof r.type === 'string' ? r.type : undefined,
    errorCode: typeof r.code === 'string' ? r.code : undefined,
    retryable: typeof r.retryable === 'boolean' ? r.retryable : undefined,
    retryAfterMs: typeof r.retry_after_ms === 'number' ? r.retry_after_ms : undefined,
    recovery,
    devMessage: typeof r.message === 'string' ? r.message : undefined,
  }
}

function getTaskStatusLabel(t: (key: string) => string, status: CollaborationTask['status']): string {
  if (status === 'in_progress') return t('chat.taskStatus.inProgress')
  if (status === 'completed') return t('chat.taskStatus.completed')
  if (status === 'deleted') return t('chat.taskStatus.deleted')
  return t('chat.taskStatus.pending')
}

function getTaskStatusClasses(status: CollaborationTask['status']): string {
  if (status === 'in_progress') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (status === 'deleted') return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
}

function getSyncAgentStatusLabel(t: (key: string) => string, status: SyncAgentState['status']): string {
  if (status === 'running') return t('chat.syncAgentStatus.running')
  if (status === 'completed') return t('chat.syncAgentStatus.completed')
  if (status === 'max_turns') return t('chat.syncAgentStatus.maxTurns')
  if (status === 'model_error') return t('chat.syncAgentStatus.modelError')
  if (status === 'aborted') return t('chat.syncAgentStatus.aborted')
  if (status === 'timeout') return t('chat.syncAgentStatus.timeout')
  return t('chat.syncAgentStatus.failed')
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

function getAsyncAgentStatusLabel(t: (key: string) => string, status: AsyncAgentState['status']): string {
  if (status === 'running') return t('chat.asyncAgentStatus.running')
  if (status === 'idle') return t('chat.asyncAgentStatus.idle')
  if (status === 'completed') return t('chat.asyncAgentStatus.completed')
  return t('chat.asyncAgentStatus.failed')
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

function getTeamEventLabel(t: (key: string) => string, team: TeamState): string {
  if (team.lastEvent === 'member_join') return t('chat.teamEvent.memberJoin')
  if (team.lastEvent === 'member_left') return t('chat.teamEvent.memberLeft')
  if (team.lastEvent === 'deleted') return t('chat.teamEvent.deleted')
  return t('chat.teamEvent.created')
}

function getTeamEventSummary(t: (key: string) => string, team: TeamState): string {
  if (team.memberName) {
    return team.lastEvent === 'member_left'
      ? t('chat.teamEvent.memberLeftDesc', { name: team.memberName })
      : team.lastEvent === 'member_join'
        ? t('chat.teamEvent.memberJoined', { name: team.memberName })
        : t('chat.teamEvent.memberChange', { name: team.memberName })
  }
  if (team.lastEvent === 'deleted') return t('chat.teamEvent.archivedDesc')
  return t('chat.teamEvent.defaultDesc')
}

// ─── v1.13 Artifact helpers ────────────────────────────────────────────────

/**
 * Pull `ArtifactRef[]` out of a tool result's metadata. Main process embeds
 * the engine-provided `artifacts` field inside metadata so the existing
 * metadata_json DB column round-trips it without a schema change.
 */
function extractArtifactsFromActivity(activity: ToolActivity): ArtifactRef[] {
  const raw = activity.metadata?.artifacts
  if (!Array.isArray(raw)) return []
  const refs: ArtifactRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.artifact_id === 'string' ? r.artifact_id : ''
    if (!id) continue
    refs.push({
      artifact_id: id,
      name: typeof r.name === 'string' ? r.name : undefined,
      type: typeof r.type === 'string' ? r.type : undefined,
      mime_type: typeof r.mime_type === 'string' ? r.mime_type : undefined,
      size_bytes: typeof r.size_bytes === 'number' ? r.size_bytes : undefined,
      description: typeof r.description === 'string' ? r.description : undefined,
      preview_text: typeof r.preview_text === 'string' ? r.preview_text : undefined,
      uri: typeof r.uri === 'string' ? r.uri : undefined,
      role: typeof r.role === 'string' ? r.role : undefined,
    })
  }
  return refs
}

function formatArtifactSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

/**
 * Top-bar button that lists every artifact produced in the current session.
 * Click → toggles a popover under the button. Each list item triggers the
 * same FilePreviewDrawer used for read/write tool previews, populated from
 * the artifact's preview_text.
 */
function SessionArtifactsButton({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: ArtifactRef[]
  // Receives the full ArtifactRef so the parent can wire fetch+read
  // through the shared openArtifactPreview helper. Previously this prop
  // was a raw onOpenFilePreview that took a FilePreviewData and the
  // button built it from artifact.uri / preview_text, which produced a
  // placeholder-only path (`art_xxx`) for blob artifacts since the
  // engine no longer ships preview_text for binaries.
  onOpenArtifact: (artifact: ArtifactRef) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (artifacts.length === 0) return null

  const handleSelect = (artifact: ArtifactRef) => {
    setOpen(false)
    onOpenArtifact(artifact)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('chat.header.artifactsCount', { n: artifacts.length })}
        title={t('chat.header.artifacts')}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <FolderOpen size={14} />
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {artifacts.length}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-80 max-w-[80vw] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">{t('chat.header.artifacts')}</span>
            <span className="text-[11px] text-muted-foreground">{artifacts.length}</span>
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {artifacts.map((artifact) => {
              const title = artifact.name || artifact.artifact_id
              const subtitle = artifact.description || artifact.mime_type || artifact.type || ''
              const size = formatArtifactSize(artifact.size_bytes)
              return (
                <button
                  key={artifact.artifact_id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(artifact)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted">
                    <FileText size={13} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-medium text-foreground" title={title}>{title}</span>
                      {size && (
                        <span className="inline-flex h-5 flex-shrink-0 items-center rounded-full border border-border bg-background px-2 text-[10px] leading-none text-muted-foreground">
                          {size}
                        </span>
                      )}
                    </div>
                    {subtitle && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={subtitle}>
                        {subtitle}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Shape mirrors WorkspaceFileNode from preload (`window.workspace.listSession`).
// Kept local so this component doesn't need to import a preload type.
interface WorkspaceFileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  modifiedAt?: number
  children?: WorkspaceFileNode[]
}

/**
 * Top-bar button that lists the session's on-disk working directory
 * (`~/.harnessclaw/workspace/session/<sid>`) as a collapsible file tree.
 * Click a file → opens it in the same FilePreviewDrawer used by the
 * artifacts dropdown / read_file tool previews.
 *
 * This is wider in scope than SessionArtifactsButton (which only lists
 * artifacts declared via artifact_created events): the agent often
 * produces files that never get formally registered as artifacts but
 * still live in the session workspace dir.
 */
function SessionWorkspaceFilesButton({
  sessionId,
}: {
  sessionId: string
}) {
  const { t } = useTranslation()
  // Closed by default — the user opens the workspace via the header
  // button when they want to inspect files. Clicking outside the
  // drawer (or pressing Esc / the close button) dismisses it.
  const [open, setOpen] = useState(false)
  const [tree, setTree] = useState<WorkspaceFileNode[]>([])
  const [fileCount, setFileCount] = useState(0)
  const [root, setRoot] = useState<string>('')
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Currently selected file → fed to the inline preview pane on the
  // right of the drawer. Reset when the active session changes so the
  // preview never bleeds across sessions.
  const [selected, setSelected] = useState<{ path: string; name: string } | null>(null)
  useEffect(() => {
    setSelected(null)
  }, [sessionId])
  const containerRef = useRef<HTMLDivElement>(null)

  // (Re)load the tree when the popover opens or the active session changes.
  // The agent may keep writing files into the session dir while the
  // popover is closed, so refreshing on every open is intentional.
  const reload = useCallback(async () => {
    if (!sessionId) return
    // Preload may not be ready yet during HMR / first mount of a freshly
    // bundled renderer — fail soft instead of crashing the page when
    // `window.workspace` isn't exposed yet.
    if (typeof window === 'undefined' || !window.workspace || typeof window.workspace.listSession !== 'function') {
      setError('workspace api unavailable')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await window.workspace.listSession(sessionId)
      if (!res.ok) {
        setError(res.error || 'failed')
        setTree([])
        setFileCount(0)
        setExists(false)
        return
      }
      setTree(res.tree)
      setFileCount(res.fileCount)
      setRoot(res.root)
      setExists(res.exists)
    } catch (err) {
      setError(String((err as Error)?.message || err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Light-weight count fetch on session change so the badge stays
  // accurate even when the popover is closed. Same call as `reload`
  // since the IPC is cheap (one local readdir + stats), and it keeps
  // the open-time fetch path identical.
  useEffect(() => {
    void reload()
  }, [reload])

  // Close drawer on Escape; click-outside is handled by the backdrop.
  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const handleToggle = () => {
    setOpen((v) => {
      const next = !v
      if (next) void reload()
      return next
    })
  }

  // Always render the button so users can peek into a freshly created
  // session even before the agent writes the first file.
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('chat.header.workspaceCount', { n: fileCount })}
        title={t('chat.header.workspace')}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <FolderOpen size={14} />
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {fileCount}
        </span>
      </button>

      {open && createPortal(
        // Modal-style drawer: a translucent backdrop dims the rest of
        // the app and captures click-outside → close. Clicks inside
        // the `<aside>` itself stop propagation via the wrapper layout
        // (the backdrop is a sibling, not an ancestor of the panel).
        <div
          className="fixed inset-0 z-[150] flex"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label={t('chat.header.workspace')}
            className="drawer-slide-in-from-right relative ml-auto flex h-full w-[56rem] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">{t('chat.header.workspace')}</h2>
                {root ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={root}>
                    {root}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {fileCount}
                </span>
                <button
                  type="button"
                  onClick={() => void reload()}
                  aria-label={t('chat.header.workspaceRefresh')}
                  title={t('chat.header.workspaceRefresh')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Fire and forget — main's shell.openPath logs its
                    // own errors, and a failed reveal shouldn't block the
                    // user from continuing to browse the drawer.
                    void window.workspace.openFolder(sessionId)
                  }}
                  aria-label={t('chat.header.workspaceOpenFolder')}
                  title={t('chat.header.workspaceOpenFolder')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('common.close', { defaultValue: '关闭' })}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            </header>

            {/* Two-pane body: file tree (left) + inline preview (right).
                Default state keeps BOTH panes visible — the user lands
                on a session and immediately sees both the file UI/
                structure and a place to inspect content, instead of
                having to chase a click-to-open flow. */}
            <div className="flex flex-1 overflow-hidden">
              <div className="flex w-72 shrink-0 flex-col border-r border-border">
                <div className="flex-1 overflow-y-auto py-1">
                  {loading ? (
                    <div className="flex h-full items-center justify-center px-4 py-10 text-xs text-muted-foreground">
                      {t('chat.header.workspaceLoading')}
                    </div>
                  ) : error ? (
                    <div className="flex h-full items-center justify-center px-4 py-10 text-xs text-destructive">
                      {error}
                    </div>
                  ) : !exists || tree.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-4 py-10 text-xs text-muted-foreground">
                      {t('chat.header.workspaceEmpty')}
                    </div>
                  ) : (
                    <ul>
                      {tree.map((node) => (
                        <WorkspaceTreeNode
                          key={node.path}
                          node={node}
                          depth={0}
                          selectedPath={selected?.path || null}
                          onSelectFile={(path, fileName) => setSelected({ path, name: fileName })}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden">
                <WorkspaceInlinePreview file={selected} />
              </div>
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </div>
  )
}

/**
 * Recursive row inside the workspace drawer's file tree. Directories
 * expand/collapse; files become selectable (single-select, drives the
 * inline preview pane on the right).
 */
function WorkspaceTreeNode({
  node,
  depth,
  selectedPath,
  onSelectFile,
}: {
  node: WorkspaceFileNode
  depth: number
  selectedPath: string | null
  onSelectFile: (path: string, fileName: string) => void
}) {
  // Top-level dirs start expanded; deeper dirs default collapsed to
  // keep the tree readable when the agent creates nested folders.
  const [expanded, setExpanded] = useState(depth === 0)
  const indent = { paddingLeft: `${8 + depth * 14}px` }

  if (node.type === 'dir') {
    const children = node.children || []
    return (
      <li>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
          style={indent}
        >
          {expanded ? (
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
          )}
          <Folder size={13} className="shrink-0 text-primary" />
          <span className="truncate font-medium">{node.name}</span>
          {children.length > 0 ? (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{children.length}</span>
          ) : null}
        </button>
        {expanded && children.length > 0 && (
          <ul>
            {children.map((child) => (
              <WorkspaceTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const isSelected = selectedPath === node.path
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile(node.path, node.name)}
        aria-pressed={isSelected}
        className={cn(
          'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors',
          isSelected
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
        style={indent}
        title={node.path}
      >
        <span className="w-3 shrink-0" aria-hidden="true" />
        <File size={13} className={cn('shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
    </li>
  )
}

/**
 * Inline file preview rendered inside the workspace drawer's right
 * pane. Replicates a stripped-down version of FilePreviewDrawer:
 *   - Images / audio / video → native element via `localFileUrl`.
 *   - docx / xlsx / pptx / pdf → rich preview (HTML/text) from main
 *     process via `files:read` (mammoth / SheetJS / pdf-parse).
 *   - Everything else → plain text in a monospace block.
 * Binary formats without a rich-preview path show a friendly placeholder.
 */
function WorkspaceInlinePreview({ file }: { file: { path: string; name: string } | null }) {
  const { t } = useTranslation()
  const [content, setContent] = useState<string>('')
  const [isBinary, setIsBinary] = useState(false)
  const [previewKind, setPreviewKind] = useState<'html' | 'text' | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setContent('')
      setIsBinary(false)
      setPreviewKind(undefined)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent('')
    setPreviewKind(undefined)
    setIsBinary(false)
    ;(async () => {
      try {
        const res = await window.files.read(file.path)
        if (cancelled) return
        if (!res?.ok) {
          setError(res?.error || 'read failed')
          return
        }
        setContent(typeof res.content === 'string' ? res.content : '')
        setIsBinary(Boolean(res.isBinary))
        setPreviewKind(res.previewKind === 'html' || res.previewKind === 'text' ? res.previewKind : undefined)
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message || err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file?.path])

  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-xs text-muted-foreground">
        {t('chat.header.workspacePreviewEmpty')}
      </div>
    )
  }

  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  const isImage = /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(ext)
  const isAudio = /^(mp3|wav|m4a|aac|flac|ogg)$/.test(ext)
  const isVideo = /^(mp4|mov|avi|mkv|webm)$/.test(ext)
  const mediaUrl = isImage || isAudio || isVideo ? localFileUrl(file.path) : null

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
        <File size={13} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground" title={file.name}>{file.name}</div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={file.path}>{file.path}</div>
        </div>
      </header>
      <div className="flex-1 overflow-auto bg-background/40">
        {loading ? (
          <div className="flex h-full items-center justify-center px-6 py-10 text-xs text-muted-foreground">
            {t('chat.header.workspaceLoading')}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 py-10 text-xs text-destructive">
            {error}
          </div>
        ) : isImage && mediaUrl ? (
          <div className="flex h-full items-center justify-center p-4">
            <img src={mediaUrl} alt={file.name} className="max-h-full max-w-full rounded-md border border-border object-contain" />
          </div>
        ) : isAudio && mediaUrl ? (
          <div className="flex h-full items-center justify-center p-6">
            <audio src={mediaUrl} controls className="w-full max-w-md" />
          </div>
        ) : isVideo && mediaUrl ? (
          <div className="flex h-full items-center justify-center p-4">
            <video src={mediaUrl} controls className="max-h-full max-w-full rounded-md border border-border" />
          </div>
        ) : previewKind === 'html' ? (
          <div
            className="prose prose-sm max-w-none px-4 py-3 text-foreground dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : previewKind === 'text' ? (
          <pre className="whitespace-pre-wrap break-words px-4 py-3 text-[12px] leading-5 text-foreground">{content}</pre>
        ) : isBinary ? (
          <div className="flex h-full items-center justify-center px-6 py-10 text-xs text-muted-foreground">
            {t('chat.header.workspaceBinaryHint')}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-5 text-foreground">
            {content}
          </pre>
        )}
      </div>
    </>
  )
}

/**
 * Top-bar session title with an inline dropdown menu mirroring the sidebar's
 * per-session "more" menu: 重命名 / 加入项目（或 退出项目）/ 删除. Rename
 * happens inline (the title swaps to an input). 加入项目 opens a project
 * picker dialog; 退出项目 detaches immediately. 删除 delegates to the
 * provided onDelete handler.
 */
function SessionTitleMenu({
  sessionId,
  title,
  currentProjectId,
  onDelete,
}: {
  sessionId: string
  title: string
  currentProjectId: string | null
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  // When the active session changes, drop any in-progress rename/assign UI so
  // we don't leak state between sessions.
  useEffect(() => {
    setIsRenaming(false)
    setAssignOpen(false)
    setConfirmDelete(false)
    setOpen(false)
  }, [sessionId])

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [isRenaming])

  const startRename = () => {
    setRenameValue(title.trim())
    setIsRenaming(true)
    setOpen(false)
  }

  const submitRename = async () => {
    const next = renameValue.trim()
    if (!next || next === title.trim()) {
      setIsRenaming(false)
      return
    }
    const result = await window.db.updateSessionTitle(sessionId, next)
    if (result?.ok) {
      setIsRenaming(false)
    } else {
      // Keep the input open so the user can retry.
      renameInputRef.current?.focus()
    }
  }

  const handleDetachProject = async () => {
    setOpen(false)
    await window.db.updateSessionProject(sessionId, null)
  }

  if (isRenaming) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={() => void submitRename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submitRename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setIsRenaming(false)
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-0.5 text-lg font-semibold tracking-tight text-foreground outline-none focus:border-primary"
          aria-label={t('sessions.actions.rename')}
        />
        <AssignProjectDialog
          open={assignOpen}
          sessionId={sessionId}
          currentProjectId={currentProjectId}
          onClose={() => setAssignOpen(false)}
        />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
        className="inline-flex min-w-0 max-w-full items-center gap-3 rounded-md px-1 py-0.5 text-left text-foreground transition-colors hover:bg-muted/60"
      >
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        <ChevronDown
          size={14}
          className={cn(
            'flex-shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-48 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={startRename}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Pencil size={14} />
            <span>{t('sessions.actions.rename')}</span>
          </button>
          {currentProjectId ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleDetachProject()}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <FolderMinus size={14} />
              <span>{t('sessions.actions.exitProject')}</span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                setAssignOpen(true)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <FolderPlus size={14} />
              <span>{t('sessions.actions.joinProject')}</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setConfirmDelete(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <Trash2 size={14} />
            <span>{t('sessions.actions.delete')}</span>
          </button>
        </div>
      )}

      <AssignProjectDialog
        open={assignOpen}
        sessionId={sessionId}
        currentProjectId={currentProjectId}
        onClose={() => setAssignOpen(false)}
      />
      <ConfirmDeleteSessionDialog
        open={confirmDelete}
        title={title}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
    </div>
  )
}

/**
 * Modal project picker shared with the sidebar's "加入项目" action. Lists all
 * projects the user has created; clicking one assigns the session to it (or
 * detaches if the session is already in that project).
 */
function AssignProjectDialog({
  open,
  sessionId,
  currentProjectId,
  onClose,
}: {
  open: boolean
  sessionId: string
  currentProjectId: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<DbProjectRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void window.db.listProjects().then((rows) => {
      if (cancelled) return
      setProjects(rows || [])
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const handleAssign = async (projectId: string, isCurrent: boolean) => {
    await window.db.updateSessionProject(sessionId, isCurrent ? null : projectId)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[6px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-card p-5 shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <h3 className="mb-1 text-base font-semibold text-foreground">{t('sessions.assignProject.title')}</h3>
        <p className="mb-3 text-xs text-muted-foreground">{t('sessions.assignProject.desc')}</p>

          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 size={14} className="mr-2 animate-spin" />
              {t('sessions.loading')}
            </div>
          ) : projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('sessions.assignProject.noProjects')}</p>
          ) : (
            <div className="max-h-60 overflow-y-auto rounded-xl border border-border">
              {projects.map((project) => {
                const isCurrentProject = currentProjectId === project.project_id
                const displayName = getProjectDisplayName(project, t)
                const displayDescription = getProjectDisplayDescription(project, t)
                return (
                  <button
                    key={project.project_id}
                    onClick={() => void handleAssign(project.project_id, isCurrentProject)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-border px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/60',
                      isCurrentProject && 'bg-accent'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                      {displayDescription && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{displayDescription}</p>
                      )}
                    </div>
                    {isCurrentProject && (
                      <span className="mt-0.5 shrink-0 text-xs text-primary">{t('sessions.assignProject.current')}</span>
                    )}
                  </button>
                )
              })}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Chat Page ──────────────────────────────────────────────────────────────

export function ChatPage() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const initialMessage = location.state?.initialMessage || ''
  const initialAttachments = (location.state?.initialAttachments || []) as AttachmentItem[]
  // v1.14: optional coordinator_mode passed from the home/composer entry —
  // 'plan' explicitly pins this turn to the L2 Plan coordinator; absent
  // means the engine's heuristic ModeSelector picks ReAct/Plan automatically.
  const initialCoordinatorMode: 'react' | 'plan' | undefined =
    location.state?.coordinatorMode === 'plan' || location.state?.coordinatorMode === 'react'
      ? location.state.coordinatorMode
      : undefined
  // v1.15: opt-in `plan_confirmation: "required"` so the engine pauses on
  // `plan.proposed` and lets the user edit the draft DAG before running.
  const initialPlanConfirmation: 'required' | undefined =
    location.state?.planConfirmation === 'required' ? 'required' : undefined
  const selectedSessionIdFromRoute = typeof location.state?.sessionId === 'string' ? location.state.sessionId : ''
  const createSessionOnOpen = location.state?.createSession === true
  const routeProjectContext = useMemo(() => normalizeProjectContext(location.state?.projectContext), [location.state])
  const [sessionMap, setSessionMap] = useState<Record<string, SessionState>>({})
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sessionProjectContexts, setSessionProjectContexts] = useState<Record<string, ProjectContext>>({})
  const [filePreview, setFilePreview] = useState<FilePreviewData | null>(null)
  // 用户消息里的图片附件单独走居中 FilePreviewModal，行为对齐首页输入框
  // 下方的附件预览（HomePage.tsx 同样把 onPreview 接到 FilePreviewModal），
  // 避免与右侧 FilePreviewDrawer 抢占视觉焦点。
  const [userImagePreview, setUserImagePreview] = useState<FilePreviewData | null>(null)
  const openUserImagePreview = useCallback(async (attachment: LocalAttachmentItem) => {
    try {
      const result = await window.files.read(attachment.path)
      setUserImagePreview({
        path: result?.path || attachment.path,
        fileName: attachment.name || attachment.path.split(/[\\/]/).pop() || attachment.path,
        operation: 'read_file',
        content: result?.ok && typeof result.content === 'string' ? result.content : '',
        isBinary: result?.ok ? Boolean(result.isBinary) : false,
        previewKind:
          result?.ok && (result.previewKind === 'html' || result.previewKind === 'text')
            ? result.previewKind
            : undefined,
      })
    } catch (err) {
      console.error('Failed to preview user image:', err)
      setUserImagePreview({
        path: attachment.path,
        fileName: attachment.name || attachment.path,
        operation: 'read_file',
        content: '',
      })
    }
  }, [])
  const [webPreview, setWebPreview] = useState<WebPreviewData | null>(null)
  const openWebPreview = useCallback((data: WebPreviewData) => {
    if (!data?.url || !/^https?:\/\//i.test(data.url)) return
    setWebPreview(data)
  }, [])

  // openArtifactPreview is the single funnel through which every UI
  // entry-point (top-bar dropdown, in-drawer file list, inline markdown
  // links, ...) opens an artifact. Behaviour:
  //
  //   1. Immediately set a placeholder FilePreviewData so the drawer
  //      pops up while the network round-trip is in flight.
  //   2. window.artifacts.fetch — main process pulls bytes via
  //      `/api/v1/artifacts/{id}/content` and writes them to
  //      ~/.harnessclaw/artifact-cache/<session>/<id>/<fileName>.
  //   3. window.files.read on the resulting path — same pipeline as
  //      opening a local file: docx → mammoth → HTML, pdf → pdf-parse →
  //      text, etc.
  //   4. Replace the placeholder with the rich preview.
  //
  // Keeping this in one place fixes the historical bug where the top-bar
  // dropdown showed `path: art_xxx` (placeholder only) while the in-drawer
  // list showed the real file — two entry-points had drifted into two
  // different setFilePreview shapes.
  const openArtifactPreview = useCallback(
    async (artifact: ArtifactRef, sessionId?: string) => {
      if (!artifact) return
      // artifactId is preserved on every setFilePreview below so the
      // drawer's side-list can match this preview against the session's
      // artifact list. Path alone isn't enough because we swap it from
      // `artifact://art_xxx` (placeholder) to the local temp-file path
      // (after fetch+read).
      setFilePreview({
        path: artifact.uri || artifact.artifact_id,
        fileName: artifact.name || artifact.artifact_id,
        operation: 'read_file',
        content: artifact.preview_text || '',
        artifactId: artifact.artifact_id,
      })
      try {
        const fetchRes = await window.artifacts.fetch(artifact.artifact_id, sessionId)
        if (!fetchRes.ok) {
          console.error('artifact fetch failed:', fetchRes.error)
          return
        }
        const readRes = await window.files.read(fetchRes.path)
        setFilePreview({
          path: fetchRes.path,
          fileName: fetchRes.fileName || artifact.name || artifact.artifact_id,
          operation: 'read_file',
          content:
            readRes?.ok && typeof readRes.content === 'string' ? readRes.content : '',
          isBinary: readRes?.ok ? Boolean(readRes.isBinary) : false,
          previewKind:
            readRes?.ok && (readRes.previewKind === 'html' || readRes.previewKind === 'text')
              ? readRes.previewKind
              : undefined,
          artifactId: artifact.artifact_id,
        })
      } catch (err) {
        console.error('artifact preview pipeline failed:', err)
      }
    },
    [],
  )

  // User-configurable behavior for plain http(s) link clicks inside assistant
  // markdown messages. Persisted in app config under `ui.linkOpenBehavior`.
  // Default is `'drawer'` — clicking a link opens the in-app WebPreviewDrawer
  // (the same drawer used for search-result URL chips). Users who prefer the
  // system browser can switch to `'external'` in Settings → UI 设置.
  const { config: appConfig } = useAppConfig()
  const linkOpenBehavior: LinkOpenBehavior =
    (appConfig?.ui as { linkOpenBehavior?: string } | undefined)?.linkOpenBehavior === 'external'
      ? 'external'
      : 'drawer'
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
  const pendingInitialTurn = useRef<{ content: string; attachments: AttachmentItem[]; coordinatorMode?: 'react' | 'plan'; planConfirmation?: 'required' } | null>(
    initialMessage || initialAttachments.length > 0
      ? { content: initialMessage, attachments: initialAttachments, coordinatorMode: initialCoordinatorMode, planConfirmation: initialPlanConfirmation }
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
  // v0.3 dedup helper: synchronous read access to the latest sessionMap so
  // event handlers can detect whether a replayed prompt's card already
  // exists before deciding to create a new assistant message.
  const sessionMapRef = useRef(sessionMap)
  sessionMapRef.current = sessionMap
  const maxLength = 4000

  const [dbSessions, setDbSessions] = useState<DbSessionRow[]>([])
  const emptyGreeting = useMemo(() => getChatGreeting(t), [t])
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
    const isNew = !sid
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
    if (isNew) {
      trackSessionCreate()
    }
    return resolvedSessionId
  }, [navigate, routeProjectContext])

  const sendInitialMessage = useCallback(async (sid: string, text: string, initialFiles: AttachmentItem[] = [], coordinatorMode?: 'react' | 'plan', planConfirmation?: 'required') => {
    pendingInitialTurn.current = null
    const trimmedText = text.trim()

    // Same multimodal split as handleSend: images go through the wire
    // content[] array as proper image blocks, non-image attachments
    // stay on the legacy JSON-text path inside buildMessagePayload.
    // Skipping this here is what made the launcher-screen "first send"
    // path silently strip images on 5/19.
    const imageFiles = initialFiles.filter((a) => a.kind === 'image')
    const otherFiles = initialFiles.filter((a) => a.kind !== 'image')

    // No vision pre-gate: images always pass through. The server no
    // longer rejects image input for non-vision models either — many
    // tools consume images (image_generate, video_create i2v, browser
    // agent), so the downstream model/provider decides what to do.

    // Read each image to base64 + sniffed MIME. Limit (10MB) and MIME
    // whitelist enforced in main.
    const wireImages: Array<{ mime: string; base64: string }> = []
    for (const att of imageFiles) {
      if (!att.path) continue
      const res = await window.files.readBase64(att.path)
      if (!res.ok) {
        const failAt = Date.now()
        ensureLocalSession(sid)
        updateSession(sid, (prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: `img-${failAt}`,
              role: 'assistant',
              content: '',
              timestamp: failAt,
              systemNotice: {
                kind: 'error',
                title: `读取图片失败：${att.name}`,
                message: res.message || res.error,
                hint: '支持 PNG / JPEG / GIF / WebP / PDF，最大 10MB。',
              },
            },
          ],
        }))
        setInput('')
        setAttachments([])
        return
      }
      wireImages.push({ mime: res.mime, base64: res.data })
    }

    // Non-image attachments go through the legacy JSON-text path.
    const payload = buildMessagePayload(trimmedText, otherFiles)
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
      // v1.16: arm the gate so `plan_created` doesn't preemptively
      // synthesize a confirmed draft before `plan_proposed` arrives.
      awaitingPlanProposed: planConfirmation === 'required' ? true : prev.awaitingPlanProposed,
      messages: [...prev.messages, {
        id: `usr-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        attachments: initialFiles,
        timestamp: Date.now(),
      }],
    }))
    const sendOptions: { coordinatorMode?: 'react' | 'plan'; planConfirmation?: 'required'; images?: typeof wireImages } | undefined =
      (coordinatorMode || planConfirmation || wireImages.length > 0)
        ? {
            ...(coordinatorMode ? { coordinatorMode } : {}),
            ...(planConfirmation ? { planConfirmation } : {}),
            ...(wireImages.length > 0 ? { images: wireImages } : {}),
          }
        : undefined
    void window.harnessclaw.send(payload, sid, sendOptions)
    trackMessageSent({
      message_length: trimmedText.length,
      has_attachments: initialFiles.length > 0,
      coordinator_mode: coordinatorMode,
    })
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

  const respondAskQuestion = useCallback<RespondAskQuestionHandler>(async (toolUseId, status, output, errorMessage) => {
    if (!toolUseId) return { ok: false, error: 'Missing tool use id' }
    try {
      const result = await window.harnessclaw.respondAskQuestion(
        toolUseId,
        status,
        status === 'success' ? (output || '') : undefined,
        status === 'cancelled' ? (errorMessage || 'User dismissed the question dialog') : undefined,
      )
      return result || { ok: false, error: 'No response from engine' }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }, [])

  // v1.15: forward plan.response to the engine. Approve sends the (possibly
  // edited) steps; reject sends `plan_approved=false`. The local card is
  // moved into a confirmed/read-only state immediately so the user gets
  // feedback even before the engine ack (`plan_approved`) arrives.
  const respondPlan = useCallback(async (
    sid: string,
    planId: string,
    approved: boolean,
    options?: { steps?: PlanDraftStep[]; reason?: string },
  ) => {
    if (!sid || !planId) return
    if (approved) {
      updateSession(sid, (prev) => (
        prev.planDraft && prev.planDraft.planId === planId
          ? { ...prev, planDraft: { ...prev.planDraft, confirmed: true, steps: options?.steps ?? prev.planDraft.steps } }
          : prev
      ))
    } else {
      // Rejection drops the card right away; the engine falls back and
      // emits a regular tool.end summary instead of a plan_approved ack.
      updateSession(sid, (prev) => (
        prev.planDraft && prev.planDraft.planId === planId
          ? { ...prev, planDraft: undefined }
          : prev
      ))
    }
    await window.harnessclaw.respondPlan(planId, approved, sid, {
      steps: approved && options?.steps ? options.steps as unknown as Array<Record<string, unknown>> : undefined,
      reason: options?.reason,
    })
  }, [updateSession])

  // v0.5.0 §7.3 — forward the user's step_decision pick (continue / retry /
  // cancel) to the engine. The optional `note` ends up in the server's
  // fallback summary so the next agent turn can reference it.
  const respondStepDecision = useCallback<RespondStepDecisionHandler>(async (requestId, decision, note) => {
    if (!requestId) return { ok: false, error: 'Missing request id' }
    try {
      const result = await window.harnessclaw.respondStepDecision(
        requestId,
        decision,
        activeSessionIdRef.current || undefined,
        note,
      )
      return result || { ok: false, error: 'No response from engine' }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }, [])

  const updateCollaboration = useCallback((sid: string, updater: (prev: CollaborationState) => CollaborationState) => {
    updateSession(sid, (prev) => ({
      ...prev,
      collaboration: updater(prev.collaboration || createEmptyCollaborationState()),
    }))
  }, [updateSession])

  const activeSession = getSession(activeSessionId)
  const activeBrowserSessionIDs = useMemo(
    () => extractBrowserSessionIDs(activeSession.messages),
    [activeSession.messages],
  )
  const browserSessionIndicator = useBrowserSessionIndicator(activeBrowserSessionIDs)
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
  // v1.13: aggregate every artifact produced anywhere in the active session
  // (main agent + sub-agents). Walk all tool result activities, dedupe by
  // artifact_id, preserve discovery order. Powers the top-bar "文件" button.
  // Also enrich each ref with the full body recovered from the matching
  // `ArtifactWrite` tool call's input — preview_text on the wire is capped at
  // ≤512B (per protocol §10.6) which isn't enough for "fully display"; the
  // call input still has the producer's full content, so we use that when
  // available.
  const sessionArtifacts = useMemo<ArtifactRef[]>(() => {
    const seen = new Set<string>()
    const refs: ArtifactRef[] = []
    // Build call-id → call-input map across the whole session so an artifact
    // produced inside a sub-agent's tool can still be paired with its
    // ArtifactWrite call regardless of which message holds the call event.
    const callInputByCallId = new Map<string, { name: string; input: Record<string, unknown> }>()
    for (const message of activeSession.messages) {
      for (const tool of message.tools || []) {
        if (tool.type !== 'call') continue
        if (!tool.callId) continue
        try {
          const parsed = tool.content ? JSON.parse(tool.content) : {}
          if (parsed && typeof parsed === 'object') {
            callInputByCallId.set(tool.callId, {
              name: tool.name || '',
              input: parsed as Record<string, unknown>,
            })
          }
        } catch {
          // input not JSON — skip enrichment for this call.
        }
      }
    }
    for (const message of activeSession.messages) {
      for (const tool of message.tools || []) {
        if (tool.type !== 'result') continue
        const matched = tool.callId ? callInputByCallId.get(tool.callId) : undefined
        const writeContent = matched && matched.name === 'ArtifactWrite' && typeof matched.input.content === 'string'
          ? (matched.input.content as string)
          : ''
        for (const artifact of extractArtifactsFromActivity(tool)) {
          if (seen.has(artifact.artifact_id)) continue
          seen.add(artifact.artifact_id)
          refs.push({
            ...artifact,
            // Prefer the full ArtifactWrite body when this result corresponds
            // to that exact write; otherwise keep preview_text so users still
            // see something for aggregated tool.end refs (Specialists / Task)
            // where there's no single matching write call in this scope.
            preview_text: writeContent || artifact.preview_text,
          })
        }
      }
    }
    return refs
  }, [activeSession.messages])

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
        label: getConversationLabel(t, title, firstMsg),
      }
    })
  }, [sessionMap, sessions, dbSessions])
  const activeSessionMeta = displayedSessions.find((session) => session.key === activeSessionId)
  const activeSessionPromptRaw = activeSessionMeta?.title || activeSessionMeta?.firstMsg || t('chat.newChat')
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
        title: t('chat.composer.stopping'),
        description: t('chat.composer.stoppingDesc'),
        actionLabel: null,
      }
    }

    if (activeSession.isPaused) {
      return {
        tone: 'warning' as const,
        title: t('chat.composer.confirm'),
        description: t('chat.composer.confirmDesc'),
        actionLabel: null,
      }
    }

    if (harnessclawStatus === 'connecting') {
      return {
        tone: 'warning' as const,
        title: t('chat.composer.connecting'),
        description: t('chat.composer.connectingDesc'),
        actionLabel: t('chat.composer.reconnect'),
      }
    }

    if (harnessclawStatus !== 'connected') {
      return {
        tone: 'warning' as const,
        title: t('chat.composer.noConnection'),
        description: t('chat.composer.noConnectionDesc'),
        actionLabel: t('chat.composer.reconnect'),
      }
    }

    return null
  }, [activeSession.isPaused, activeSession.isStopping, harnessclawStatus, t])

  // v0.5.0 §11 — engine_note banner (retry-status from Scheduler etc.). Lives
  // on the session and is cleared on response_end.
  const engineNoteBanner = activeSession.engineNote

  // v0.5.0 §7.1 — find any unanswered step_decision prompt on the active
  // streaming message so we can surface it as a banner above the composer.
  // The decision card is also rendered inline inside the message stream;
  // duplicating it as a banner keeps it from being missed when the user has
  // scrolled away.
  const pendingStepDecision = useMemo(() => {
    const active = pendingAssistantMessage
    const tools = active?.tools
    if (!tools || tools.length === 0) return null
    for (const t of tools) {
      if (t.type !== 'step_decision') continue
      const answered = tools.some((r) => r.type === 'step_decision_result' && r.callId === t.callId)
      if (answered) continue
      // Parse the JSON body stuffed into `content` when the event was
      // ingested (see case 'step_decision_request').
      let body: {
        scope?: string
        step_id?: string
        step_description?: string
        reason?: string
        attempts?: number
        allow_retry?: boolean
      } = {}
      try {
        body = JSON.parse(typeof t.content === 'string' ? t.content : '') || {}
      } catch {
        body = {}
      }
      return {
        requestId: t.callId || '',
        scope: body.scope === 'plan' ? 'plan' : 'step',
        stepId: typeof body.step_id === 'string' ? body.step_id : '',
        stepDescription: typeof body.step_description === 'string' ? body.step_description : '',
        reason: typeof body.reason === 'string' ? body.reason : '',
        attempts: typeof body.attempts === 'number' ? body.attempts : 0,
        allowRetry: body.allow_retry === true,
      }
    }
    return null
  }, [pendingAssistantMessage])

  // While a `prompt.user` (AskUserQuestion / permission / plan_review) is open
  // and unanswered, the engine's turn is technically still streaming
  // (`isProcessing=true`), but nothing is actually executing — it is parked
  // waiting for the user. Showing the bottom-right red "stop" pill in that
  // state reads as "Agent 正在跑"，which is ambiguous: the user thinks code
  // is running and might mash 停止 instead of answering the prompt above.
  // Detect any unresolved prompt.user and suppress the running indicator
  // for its duration so the composer reflects "等你回复" instead of "运行中".
  //
  // SCOPE: only inspect the *currently streaming* assistant message and the
  // unconfirmed planDraft for the active turn. Walking the full message
  // history would let stale orphans from earlier turns (an interrupted run,
  // a closed session that never received `*_result`, etc.) permanently
  // suppress the indicator even after a brand-new turn starts streaming.
  const isAwaitingPromptResponse = useMemo(() => {
    if (activeSession.planDraft && !activeSession.planDraft.confirmed) return true
    const active = pendingAssistantMessage
    if (!active || !active.isStreaming) return false
    const tools = active.tools
    if (!tools || tools.length === 0) return false
    for (const t of tools) {
      if (t.type !== 'question' && t.type !== 'permission' && t.type !== 'step_decision') continue
      const resultType = t.type === 'question'
        ? 'question_result'
        : t.type === 'permission'
          ? 'permission_result'
          : 'step_decision_result'
      const answered = tools.some((r) => r.type === resultType && r.callId === t.callId)
      if (!answered) return true
    }
    return false
  }, [activeSession.planDraft, pendingAssistantMessage])

  const updateScrollState = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return

    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const threshold = Math.max(120, viewport.clientHeight * 0.382)
    const isNearBottom = distanceToBottom <= threshold

    isNearBottomRef.current = isNearBottom
    setShowJumpToBottom(!isNearBottom)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
    isNearBottomRef.current = true
    setShowJumpToBottom(false)
  }, [])

  // Scroll to bottom only when the user is already close to the bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom()
    }
  }, [activeSession.messages, activeSession.currentThinking, scrollToBottom])

  useEffect(() => {
    scrollToBottom()
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
        tools: r.tools.map((t) => {
          const metadata = t.metadata_json ? parseJsonObject(t.metadata_json) || undefined : undefined
          // v2 §12 — recover structured ErrorInfo (status / errorType /
          // retryable / recovery / devMessage) from metadata.errorInfo so
          // the failure presentation survives a restart or session resume.
          const errInfo = extractErrorInfoFromMetadata(metadata)
          return {
            type: t.type as ToolActivity['type'],
            name: t.name || undefined,
            content: t.content,
            callId: t.call_id || undefined,
            isError: t.is_error === 1,
            durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : undefined,
            renderHint: t.render_hint || undefined,
            language: t.language || undefined,
            filePath: t.file_path || undefined,
            metadata,
            ts: t.created_at,
            subagent: t.subagent_json ? normalizeSubagent(JSON.parse(t.subagent_json)) : undefined,
            status: errInfo.status,
            errorType: errInfo.errorType,
            errorCode: errInfo.errorCode,
            retryable: errInfo.retryable,
            retryAfterMs: errInfo.retryAfterMs,
            recovery: errInfo.recovery,
            devMessage: errInfo.devMessage,
          }
        }),
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
      coordinatorMode: initialCoordinatorMode,
      planConfirmation: initialPlanConfirmation,
    }
    setInput(initialMessage)
    setAttachments(initialAttachments)
  }, [initialAttachments, initialMessage, initialCoordinatorMode, initialPlanConfirmation, location.key])

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
    sendInitialMessage(sid, next.content, next.attachments, next.coordinatorMode, next.planConfirmation)
  }, [ensureLocalSession, sendInitialMessage])

  // Handle Harnessclaw events — route by session_id
  const handleHarnessclawEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string
    const normalizedType = normalizeEventType(type)
    const eventSessionId = getHarnessclawEventSessionId(event) || undefined
    const subagent = normalizeSubagent(event.subagent)

    // DEBUG (remove when SubAgent rendering is verified working): log every
    // sub-agent / artifact-related event so we can see in DevTools console
    // whether the renderer is receiving them and which fields are populated.
    // If "subagent_start" never appears here but the WS Network tab shows
    // "subagent.start" frames, the bug is between IPC and this callback.
    if (
      normalizedType === 'subagent_start' ||
      normalizedType === 'subagent_event' ||
      normalizedType === 'subagent_end' ||
      normalizedType === 'agent_intent'
    ) {
      // eslint-disable-next-line no-console
      console.log('[harnessclaw subagent debug]', normalizedType, {
        agent_id: event.agent_id,
        agent_name: event.agent_name,
        session_id: event.session_id,
        payload_event_type: isRecord(event.payload) ? event.payload.event_type : undefined,
      })
    }

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

    /**
     * v0.3 (websocket protocol §2.4.2): when the server replays an unanswered
     * prompt after reconnect with the same `request_id`, we want the card to
     * merge back onto its original assistant message. Calling
     * `ensureAssistantMessage` blindly would create a new (empty) Emma block
     * because `pendingAssistantIds[sid]` was cleared on response_end of the
     * pre-restart turn. So: if any existing message already carries a tool
     * with this callId+type, return that message's id and skip creation.
     */
    const ensureAssistantMessageForPrompt = (
      sid: string,
      now: number,
      callId: string,
      activityType: ToolActivity['type'],
    ): string => {
      if (callId) {
        const session = sessionMapRef.current[sid]
        if (session) {
          for (const message of session.messages) {
            const tools = message.tools
            if (!tools) continue
            if (tools.some((t) => t.callId === callId && t.type === activityType)) {
              return message.id
            }
          }
        }
      }
      return ensureAssistantMessage(sid, now)
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
              ...(prev.syncAgents[agentId] || createSyncAgentState(t, agentId, updatedAt)),
              agentName: typeof event.agent_name === 'string' ? event.agent_name : prev.syncAgents[agentId]?.agentName || 'subagent',
              description: typeof event.description === 'string' ? event.description : prev.syncAgents[agentId]?.description || t('chat.status.executingSubAgent'),
              // v1.12: full task prompt from parent agent. Optional; older
              // servers (≤v1.11) won't send it — keep prior value if absent.
              task: typeof event.task === 'string' && event.task
                ? event.task
                : prev.syncAgents[agentId]?.task,
              agentType: typeof event.agent_type === 'string' ? event.agent_type : prev.syncAgents[agentId]?.agentType || 'sync',
              // Hybrid blob store + skill-aware spawn (engine 2026-05):
              // subagent_type carries the LLM-facing worker label
              // (writer / freelancer / ...) so the stats / panel can
              // actually tell agents apart. loaded_skills surfaces the
              // skills preloaded on this agent's first turn — chips
              // render in the agent card under the task line.
              subagentType: typeof event.subagent_type === 'string'
                ? event.subagent_type
                : prev.syncAgents[agentId]?.subagentType,
              loadedSkills: Array.isArray(event.loaded_skills)
                ? (event.loaded_skills as unknown[])
                    .filter((s): s is { name: string } => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).name === 'string')
                    .map((s) => {
                      const r = s as Record<string, unknown>
                      return {
                        name: String(r.name),
                        version: typeof r.version === 'string' ? r.version : undefined,
                        source: typeof r.source === 'string' ? r.source : undefined,
                      }
                    })
                : prev.syncAgents[agentId]?.loadedSkills,
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
        // v1.10+: server no longer streams sub-agent LLM text. Only `tool_start`
        // and `tool_end` inner events are forwarded; user-visible text now comes
        // exclusively from L1 (emma) `content.delta`. Ignore any unexpected
        // `text` events from older servers to avoid duplicating emma's reply.
        if (eventType !== 'tool_start' && eventType !== 'tool_end' && eventType !== 'tool_phase') break

        // tool_phase: mutate existing ToolActivity by callId — no new activity created.
        if (eventType === 'tool_phase') {
          const callId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : ''
          const phase = (typeof payload.phase === 'string' ? payload.phase : undefined) as ToolActivity['phase']
          const phaseHint = typeof payload.phase_hint === 'string' ? payload.phase_hint : undefined
          const phaseBytes = typeof payload.phase_bytes === 'number' ? payload.phase_bytes : undefined
          const rawInputContent = 'input' in payload ? getToolCallEventContent(payload) : undefined
          const inputContent = rawInputContent && rawInputContent !== '{}' ? rawInputContent : undefined
          updateSession(sid, (prev) => ({
            ...prev,
            messages: prev.messages.map((m) => ({
              ...m,
              tools: (m.tools || []).map((t) =>
                t.callId === callId && t.type === 'call'
                  ? { ...t, phase, phaseHint, phaseBytes, ...(inputContent ? { content: inputContent } : {}) }
                  : t
              ),
            })),
          }))
          break
        }

        const now = Date.now()
        const subagentInfo = createSubagentInfo(agentId, agentName, 'running')

        // v1.12: capture sub-agent's pending intent (if it matches this tool_use_id)
        // so we can stamp it onto the ToolActivity as a tool-card header line.
        // Read happens inside the updateCollaboration updater (which has access
        // to the latest `prev` state synchronously).
        let intentForActivity: string | undefined

        updateCollaboration(sid, (prev) => {
          const existing = prev.syncAgents[agentId] || createSyncAgentState(t, agentId, now)
          const nextState: SyncAgentState = {
            ...existing,
            agentName: agentName || existing.agentName,
            status: existing.status === 'completed' ? 'running' : existing.status,
            lastEventAt: now,
            updatedAt: now,
            eventCount: existing.eventCount + 1,
          }

          const callIdInPayload = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : ''

          if (eventType === 'tool_start') {
            nextState.activeToolName = getToolEventName(payload) || existing.activeToolName
            nextState.activeToolStatus = 'running'
            nextState.activeToolSummary = summarizeInlineText(getToolCallEventContent(payload), 90) || t('chat.status.preparingTool')
            // v1.12: if a matching intent was buffered for this tool_use_id,
            // capture it for the ToolActivity below.
            if (existing.currentIntent && callIdInPayload && existing.currentIntent.toolUseId === callIdInPayload) {
              intentForActivity = existing.currentIntent.text
            }
          } else if (eventType === 'tool_end') {
            nextState.activeToolName = getToolEventName(payload) || existing.activeToolName
            // v2 §6.5 — only `status === 'failed'` is a hard error. `cancelled`
            // and `skipped` are NOT errors (they get neutral gray treatment),
            // even though earlier code conflated cancelled with is_error.
            const subStatus = typeof payload.status === 'string' ? payload.status : ''
            nextState.activeToolStatus = (subStatus === 'failed' || payload.is_error === true) ? 'error' : 'completed'
            nextState.activeToolSummary = summarizeInlineText(getToolResultEventContent(payload), 90) || ((subStatus === 'failed' || payload.is_error === true) ? t('chat.status.toolFailed') : t('chat.status.toolDone'))
            // v1.12: clear sub-agent intent shimmer once its tool finishes.
            if (existing.currentIntent && callIdInPayload && existing.currentIntent.toolUseId === callIdInPayload) {
              nextState.currentIntent = undefined
            }
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

        const callId = typeof payload.tool_use_id === 'string' && payload.tool_use_id
          ? payload.tool_use_id
          : `${agentId}-${typeof event.event_id === 'string' ? event.event_id : now}`

        const activity: ToolActivity = eventType === 'tool_start'
          ? {
              type: 'call',
              name: getToolEventName(payload) || 'tool',
              content: getToolCallEventContent(payload),
              callId,
              intent: intentForActivity,
              ts: now,
              subagent: subagentInfo,
            }
          : (() => {
              // v2 §12 — mirror structured ErrorInfo from subagent payload
              // onto the ToolActivity, matching the main-flow tool_result
              // branch so failure presentation works inside the specialist
              // panel too.
              const rawRecovery = (payload.recovery && typeof payload.recovery === 'object' && !Array.isArray(payload.recovery))
                ? (payload.recovery as Record<string, unknown>)
                : undefined
              const recovery: ToolErrorRecovery | undefined = rawRecovery ? {
                action: typeof rawRecovery.action === 'string' ? rawRecovery.action : undefined,
                next_card_id: typeof rawRecovery.next_card_id === 'string' ? rawRecovery.next_card_id : undefined,
              } : undefined
              const subStatus = typeof payload.status === 'string' ? payload.status : undefined
              return {
                type: 'result',
                name: getToolEventName(payload) || 'tool',
                content: getToolResultEventContent(payload),
                callId,
                // Decouple cancelled / skipped from isError — only `failed`
                // (or a legacy `is_error: true` fallback) lights up the red
                // error UI.
                isError: subStatus === 'failed' || (subStatus === undefined && payload.is_error === true),
                durationMs: getToolDurationMs(payload),
                renderHint: getToolRenderHint(payload),
                language: getToolLanguage(payload),
                filePath: getToolFilePath(payload),
                metadata: getToolMetadata(payload),
                ts: now,
                subagent: subagentInfo,
                status: subStatus,
                errorType: typeof payload.error_type === 'string' ? payload.error_type : undefined,
                errorCode: typeof payload.error_code === 'string' ? payload.error_code : undefined,
                retryable: typeof payload.retryable === 'boolean' ? payload.retryable : undefined,
                retryAfterMs: typeof payload.retry_after_ms === 'number' ? payload.retry_after_ms : undefined,
                recovery,
                devMessage: typeof payload.dev_message === 'string' ? payload.dev_message : undefined,
              } as ToolActivity
            })()

        // Use the passive append helper so late sub-agent events arriving
        // after `response_end` (which clears `pendingAssistantIds`) do NOT
        // create a fresh empty assistant message and re-flip `isProcessing`
        // back to true — that was the cause of the renderer getting stuck
        // in the "thinking" state after the turn had actually finished.
        appendPassiveAssistantActivity(sid, activity)
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
              ...(prev.syncAgents[agentId] || createSyncAgentState(t, agentId, updatedAt)),
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
              // v1.12: clear any lingering intent on sub-agent termination.
              currentIntent: undefined,
              lastEventAt: prev.syncAgents[agentId]?.lastEventAt,
              eventCount: prev.syncAgents[agentId]?.eventCount || 0,
              updatedAt,
            },
          },
        }))

        const finalSubagentInfo = createSubagentInfo(
          agentId,
          typeof event.agent_name === 'string' ? event.agent_name : 'subagent',
          status,
        )
        const statusActivity: ToolActivity = {
          type: 'status',
          name: 'subagent_end',
          content: getSubagentVisualStatus(status) === 'failed' ? t('chat.status.subagentFailed') : t('chat.status.subagentDone'),
          ts: updatedAt,
          subagent: finalSubagentInfo,
        }
        // Use the passive append helper so a `subagent_end` arriving after
        // `response_end` does not spawn a brand-new empty assistant message
        // and flip `isProcessing` back on (which left the renderer stuck in
        // the "thinking" state even after the turn had finished).
        appendPassiveAssistantActivity(sid, statusActivity)
        break
      }

      case 'agent_routed': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        if (!sid) break
        const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
        if (!agentId) break
        const now = Date.now()
        const payload = createRoutedAgentStatusPayload(t, {
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
              subject: typeof task.subject === 'string' ? task.subject : t('chat.status.unnamedTask'),
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
        const subject = typeof task.subject === 'string' ? task.subject : t('chat.status.unnamedTask')
        const owner = typeof task.owner === 'string' ? task.owner : ''
        const activeForm = typeof task.active_form === 'string' ? task.active_form : ''
        const payload = createTaskStatusPayload(t, {
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
        const statusPayload = createAgentMessageStatusPayload(t, {
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
        const statusPayload = createAsyncAgentStatusPayload(t, {
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
        const statusPayload = createTeamStatusPayload(t, {
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
            content: subagent.status === 'running' ? t('chat.status.subagentStartedShort') : t('chat.status.subagentSummarizing'),
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

      case 'message_hint': {
        // v2.2 M4: inter-round message card hint — "正在解读结果" etc.
        // Set hintSummary on the pending assistant message so it can be
        // rendered while the content segments are still empty.
        const sid = eventSessionId!
        const hintSummary = typeof event.hint_summary === 'string' ? event.hint_summary : undefined
        if (!hintSummary) break
        const aid = pendingAssistantIds.current[sid]
        if (!aid) break
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, hintSummary } : m),
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
          content: t('chat.status.subagentCreatedShort'),
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

      case 'agent_intent': {
        // v1.12: agent.intent — pre-tool progress sentence ("正在搜索 vLLM 论文").
        // Routing rule (per design decisions):
        //   - main agent (from_subagent !== true) → session.currentIntent (top-level shimmer)
        //   - sub-agent (from_subagent === true)  → syncAgents[agentId].currentIntent
        //                                          (rendered inside that sub-agent card)
        // Cleared when the matching tool finishes (matched by tool_use_id) or
        // when the assistant turn / sub-agent ends.
        const sid = eventSessionId!
        const intentText = typeof event.intent === 'string' ? event.intent : ''
        if (!intentText) break
        const toolUseId = typeof event.tool_use_id === 'string' ? event.tool_use_id : ''
        const agentName = typeof event.agent_name === 'string' ? event.agent_name : ''
        const fromSubagent = event.from_subagent === true

        if (fromSubagent) {
          const agentId = typeof event.agent_id === 'string' ? event.agent_id : ''
          if (!agentId) break
          const updatedAt = Date.now()
          updateCollaboration(sid, (prev) => ({
            ...prev,
            capabilities: { ...prev.capabilities, subAgents: true },
            syncAgents: {
              ...prev.syncAgents,
              [agentId]: {
                ...(prev.syncAgents[agentId] || createSyncAgentState(t, agentId, updatedAt)),
                agentName: agentName || prev.syncAgents[agentId]?.agentName || 'subagent',
                currentIntent: { text: intentText, toolUseId },
                lastEventAt: updatedAt,
                updatedAt,
              },
            },
          }))
          break
        }

        ensureAssistantMessage(sid, Date.now())
        updateSession(sid, (prev) => ({
          ...prev,
          currentIntent: {
            text: intentText,
            toolUseId,
            agentName,
            fromSubagent: false,
          },
        }))
        break
      }

      case 'system_notice': {
        // v0.6.0 §10.9 — card_kind=system: framework-level system prompt
        // (e.g. "搜索能力不可用"). The server already dedups per session, but
        // we also dedup by `card_id` defensively in case the same card is
        // replayed on reconnect. The notice is queued and rendered as a
        // modal the user MUST manually acknowledge via "我已知晓".
        //
        // v0.6.1: `topic` is the stable machine-readable classification.
        // Route business logic (deeplink / telemetry) off `topic`, NOT off
        // `title` / `summary`. Unknown topics still render as a generic
        // system card (forward-compat clause).
        const sid = eventSessionId!
        if (!sid) break
        const id = typeof event.card_id === 'string' && event.card_id
          ? event.card_id
          : `system-${Date.now()}`
        const topic = typeof event.topic === 'string' ? event.topic : ''
        const title = typeof event.title === 'string' && event.title
          ? event.title
          : '系统提示'
        const summary = typeof event.summary === 'string' ? event.summary : ''
        const actionHint = typeof event.action_hint === 'string' ? event.action_hint : ''
        const icon = typeof event.icon === 'string' ? event.icon : 'info'
        const severity = typeof event.severity === 'string' ? event.severity : 'info'
        updateSession(sid, (prev) => {
          const existing = prev.systemNotices || []
          if (existing.some((n) => n.id === id)) return prev
          return {
            ...prev,
            systemNotices: [
              ...existing,
              { id, topic, title, summary, actionHint, icon, severity },
            ],
          }
        })
        break
      }

      case 'engine_note': {
        // v0.5.0 §11 — transient status note from the engine (retry banner,
        // backoff warning, etc.). Stash on the session so it can render in
        // the colored area above the composer. The latest note replaces the
        // previous one; we clear it on response_end.
        const sid = eventSessionId!
        if (!sid) break
        const text = typeof event.text === 'string' ? event.text : ''
        if (!text) break
        const severity = typeof event.severity === 'string' ? event.severity : 'info'
        const stepId = typeof event.step_id === 'string' ? event.step_id : ''
        const stepDescription = typeof event.step_description === 'string' ? event.step_description : ''
        const agentName = typeof event.agent_name === 'string' ? event.agent_name : ''
        updateSession(sid, (prev) => ({
          ...prev,
          engineNote: {
            text,
            severity,
            stepId: stepId || undefined,
            stepDescription: stepDescription || undefined,
            agentName: agentName || undefined,
            ts: Date.now(),
          },
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
          pauseReason: (event.content as string) || t('chat.status.waitingPermission'),
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'tool_call':
      case 'tool_start': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        // v1.12: main-process attaches the buffered `agent.intent` text on the
        // tool_call compat event (see harnessclaw.ts). Capture it so the tool
        // card can render its own intent line — important for the `Task` tool
        // whose intent ("派研究子代理…") differs from the spawned sub-agent's
        // intents that follow.
        const callIntent = typeof event.intent === 'string' && event.intent ? event.intent : undefined
        const activity: ToolActivity = {
          type: 'call',
          name: getToolEventName(event),
          content: getToolCallEventContent(event),
          callId: getToolEventCallId(event),
          intent: callIntent,
          ts: Date.now(),
          subagent,
          phase: (typeof event.phase === 'string' ? event.phase : undefined) as ToolActivity['phase'],
          phaseHint: typeof event.phase_hint === 'string' ? event.phase_hint : undefined,
          phaseBytes: typeof event.phase_bytes === 'number' ? event.phase_bytes : undefined,
        }
        const startedCallId = activity.callId
        updateSession(sid, (prev) => ({
          ...prev,
          // v1.12: Emma 的鎏光在"安排好具体的事情"之后结束 — 即工具开始派发时
          // 立即清除主 Agent 的 intent。剩下的执行进度由工具卡片自己呈现。
          currentIntent: prev.currentIntent && startedCallId && prev.currentIntent.toolUseId === startedCallId
            ? undefined
            : prev.currentIntent,
          isPaused: false,
          isStopping: false,
          pauseReason: undefined,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'tool_phase': {
        const sid = eventSessionId!
        const callId = getToolEventCallId(event)
        const phase = (typeof event.phase === 'string' ? event.phase : undefined) as ToolActivity['phase']
        const phaseHint = typeof event.phase_hint === 'string' ? event.phase_hint : undefined
        const phaseBytes = typeof event.phase_bytes === 'number' ? event.phase_bytes : undefined
        const rawInputContent = 'input' in event ? getToolCallEventContent(event) : undefined
        const inputContent = rawInputContent && rawInputContent !== '{}' ? rawInputContent : undefined

        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => ({
            ...m,
            tools: (m.tools || []).map((t) =>
              t.callId === callId && t.type === 'call'
                ? { ...t, phase, phaseHint, phaseBytes, ...(inputContent ? { content: inputContent } : {}) }
                : t
            ),
          })),
        }))
        break
      }

      case 'tool_result':
      case 'tool_end': {
        const sid = eventSessionId!
        const aid = ensureAssistantMessage(sid, Date.now())
        // v2 §12 — pull structured ErrorInfo fields off the compat event.
        // Main process forwards these top-level (additive; existing
        // is_error / content / metadata / error fields kept) AND also
        // tucks them into metadata.errorInfo so they survive DB restore.
        const rawRecovery = (event.recovery && typeof event.recovery === 'object' && !Array.isArray(event.recovery))
          ? (event.recovery as Record<string, unknown>)
          : undefined
        const recovery: ToolErrorRecovery | undefined = rawRecovery ? {
          action: typeof rawRecovery.action === 'string' ? rawRecovery.action : undefined,
          next_card_id: typeof rawRecovery.next_card_id === 'string' ? rawRecovery.next_card_id : undefined,
        } : undefined
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
          status: typeof event.status === 'string' ? event.status : undefined,
          errorType: typeof event.error_type === 'string' ? event.error_type : undefined,
          errorCode: typeof event.error_code === 'string' ? event.error_code : undefined,
          retryable: typeof event.retryable === 'boolean' ? event.retryable : undefined,
          retryAfterMs: typeof event.retry_after_ms === 'number' ? event.retry_after_ms : undefined,
          recovery,
          devMessage: typeof event.dev_message === 'string' ? event.dev_message : undefined,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      case 'permission_request': {
        const sid = eventSessionId!
        const requestId = typeof event.request_id === 'string' ? event.request_id : ''
        const aid = ensureAssistantMessageForPrompt(sid, Date.now(), requestId, 'permission')
        const activity: ToolActivity = {
          type: 'permission',
          name: event.name as string,
          content: JSON.stringify({
            tool_input: (event.tool_input as string) || '',
            message: (event.content as string) || '',
            is_read_only: event.is_read_only === true,
            options: Array.isArray(event.options) ? event.options : [],
          }),
          callId: requestId,
          ts: Date.now(),
          subagent,
        }
        // v0.3 dedup: replay after reconnect reuses request_id; upsert avoids
        // rendering two permission cards for the same request.
        updateSession(sid, (prev) => ({
          ...prev,
          messages: upsertSessionToolByCallId(prev.messages, aid, activity),
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

      case 'ask_user_question': {
        const sid = eventSessionId!
        if (!sid) break
        const callId = typeof event.call_id === 'string' ? event.call_id : ''
        if (!callId) break
        const aid = ensureAssistantMessageForPrompt(sid, Date.now(), callId, 'question')
        const rawOptions = Array.isArray(event.options) ? event.options : []
        const options = rawOptions.flatMap((option) => {
          if (!option || typeof option !== 'object' || Array.isArray(option)) return []
          const candidate = option as { label?: unknown; description?: unknown }
          const label = typeof candidate.label === 'string' ? candidate.label : ''
          if (!label) return []
          const description = typeof candidate.description === 'string' ? candidate.description : undefined
          return [description ? { label, description } : { label }]
        })
        const activity: ToolActivity = {
          type: 'question',
          name: typeof event.tool_name === 'string' ? event.tool_name : 'AskUserQuestion',
          content: JSON.stringify({
            question: typeof event.question === 'string' ? event.question : '',
            options,
            multi: event.multi === true,
            allow_custom: event.allow_custom !== false,
          }),
          callId,
          ts: Date.now(),
          subagent,
        }
        // v0.3 dedup: server replay after reconnect reuses request_id; merge
        // back onto the original card instead of stacking duplicates.
        updateSession(sid, (prev) => ({
          ...prev,
          messages: upsertSessionToolByCallId(prev.messages, aid, activity),
        }))
        break
      }

      case 'ask_user_question_result': {
        const sid = eventSessionId!
        if (!sid) break
        const callId = typeof event.call_id === 'string' ? event.call_id : ''
        if (!callId) break
        const aid = ensureAssistantMessage(sid, Date.now())
        const status = event.status === 'cancelled' ? 'cancelled' : 'success'
        const errorObj = isRecord(event.error) ? event.error : null
        const errorMessage = errorObj && typeof errorObj.message === 'string' ? errorObj.message : ''
        const activity: ToolActivity = {
          type: 'question_result',
          name: 'AskUserQuestion',
          content: JSON.stringify({
            status,
            output: typeof event.output === 'string' ? event.output : '',
            error_message: errorMessage,
          }),
          callId,
          isError: status === 'cancelled',
          ts: Date.now(),
          subagent,
        }
        updateSession(sid, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) => m.id === aid ? { ...m, tools: [...(m.tools || []), activity] } : m),
        }))
        break
      }

      // v0.5.0 §7.1 kind=step_decision — Scheduler / PlanCoordinator pushed
      // a continue / retry / cancel decision gate. Render a dedicated card
      // (StepDecisionCard) so the user can decide what to do next instead
      // of the engine silently falling back.
      case 'step_decision_request': {
        const sid = eventSessionId!
        if (!sid) break
        const requestId = typeof event.request_id === 'string' ? event.request_id : ''
        if (!requestId) break
        const aid = ensureAssistantMessageForPrompt(sid, Date.now(), requestId, 'step_decision')
        const activity: ToolActivity = {
          type: 'step_decision',
          name: 'StepDecision',
          content: JSON.stringify({
            scope: event.scope === 'plan' ? 'plan' : 'step',
            step_id: typeof event.step_id === 'string' ? event.step_id : '',
            step_description: typeof event.step_description === 'string' ? event.step_description : '',
            reason: typeof event.reason === 'string' ? event.reason : '',
            attempts: typeof event.attempts === 'number' ? event.attempts : 0,
            allow_retry: event.allow_retry === true,
          }),
          callId: requestId,
          ts: Date.now(),
          subagent,
        }
        // v0.3 dedup: server replay after reconnect reuses request_id; merge
        // back onto the existing card instead of stacking duplicates.
        updateSession(sid, (prev) => ({
          ...prev,
          messages: upsertSessionToolByCallId(prev.messages, aid, activity),
        }))
        break
      }

      case 'step_decision_result': {
        const sid = eventSessionId!
        if (!sid) break
        const requestId = typeof event.request_id === 'string' ? event.request_id : ''
        if (!requestId) break
        const aid = ensureAssistantMessage(sid, Date.now())
        const decision = event.decision === 'continue' || event.decision === 'retry' || event.decision === 'cancel'
          ? event.decision
          : 'cancel'
        const activity: ToolActivity = {
          type: 'step_decision_result',
          name: 'StepDecision',
          content: JSON.stringify({
            decision,
            note: typeof event.note === 'string' ? event.note : undefined,
          }),
          callId: requestId,
          isError: decision === 'cancel',
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
        // TEMP DIAGNOSTIC — surface routing + tracking state for streaming
        // text. Remove once the "stuck on Thinking…" issue is identified.
        // eslint-disable-next-line no-console
        console.log('[text_delta debug]', {
          eventSessionId: sid,
          activeSessionId: activeSessionIdRef.current,
          sidMatchesActive: sid === activeSessionIdRef.current,
          pendingAssistantId: aid,
          chunkPreview: chunk?.slice(0, 20),
          chunkLen: chunk?.length,
        })
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
            content: subagent.status === 'error' ? t('chat.status.subagentFailedShort') : t('chat.status.subagentDoneShort'),
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
        updateSession(sid, (prev) => {
          // v1.15: turn finished — drop any lingering plan draft so the
          // review card never outlives the conversation it belongs to.
          //
          // BUT: a confirmed plan can outlive the LLM response that
          // proposed it — sub-agents keep streaming `step_*` / `card.*`
          // events until `plan_completed` / `plan_failed`, and we want the
          // inline plan card to remain visible afterwards in its terminal
          // (completed / failed) state so the user can review what ran.
          // So only clear the draft when the user never confirmed it
          // (an abandoned proposal). Confirmed drafts — whether still
          // running or already terminal — are kept on session state.
          const draft = prev.planDraft
          const keepDraft = !!draft && draft.confirmed
          return {
            ...prev,
            isProcessing: false,
            currentThinking: '',
            currentIntent: undefined,
            engineNote: undefined,
            planDraft: keepDraft ? draft : undefined,
            // v1.16: also reset the plan-proposed gate so the next turn
            // starts in a clean state.
            awaitingPlanProposed: false,
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
          }
        })
        break
      }

      // v1.15: PlanCoordinator pushed a draft DAG and is blocking on user
      // review. Surface it via SessionState so the composer area can render
      // an editable PlanDraftCard. Clearing happens on `plan_approved`,
      // explicit user action, or `response_end` above.
      case 'plan_proposed': {
        const sid = eventSessionId!
        if (!sid) break
        const planId = typeof event.plan_id === 'string' ? event.plan_id : ''
        if (!planId) break
        const rawSteps = Array.isArray(event.steps) ? event.steps : []
        // v1.16: each step carries `subagent_type` (optional). Older engines
        // emitted `skill` — accept both so the renderer keeps working across
        // versions. The id is still required.
        const steps = rawSteps.flatMap((s) => {
          if (!s || typeof s !== 'object' || Array.isArray(s)) return []
          const step = s as Record<string, unknown>
          const id = typeof step.id === 'string' ? step.id : ''
          if (!id) return []
          const subagentTypeRaw = typeof step.subagent_type === 'string'
            ? step.subagent_type
            : typeof step.skill === 'string' ? step.skill : ''
          return [{
            id,
            subagent_type: subagentTypeRaw || undefined,
            description: typeof step.description === 'string' ? step.description : undefined,
            prompt: typeof step.prompt === 'string' ? step.prompt : undefined,
            depends_on: Array.isArray(step.depends_on)
              ? step.depends_on.filter((d): d is string => typeof d === 'string')
              : undefined,
          }]
        })
        // v1.16: `available_subagents` (was `available_skills`).
        const availableSubagentsRaw = Array.isArray(event.available_subagents)
          ? event.available_subagents
          : Array.isArray(event.available_skills) ? event.available_skills : []
        const availableSubagents = availableSubagentsRaw.filter((s): s is string => typeof s === 'string')
        updateSession(sid, (prev) => {
          // v0.3 dedup: server replay after reconnect reuses the same plan_id.
          // If we already have a draft for this plan (e.g. user is mid-edit),
          // keep the local copy intact rather than overwriting it.
          if (prev.planDraft && prev.planDraft.planId === planId) {
            return { ...prev, awaitingPlanProposed: false }
          }
          return {
            ...prev,
            // v1.16: plan.proposed has arrived → release the gate.
            awaitingPlanProposed: false,
            planDraft: {
              planId,
              agentId: typeof event.agent_id === 'string' ? event.agent_id : undefined,
              goal: typeof event.goal === 'string' ? event.goal : '',
              rationale: typeof event.rationale === 'string' ? event.rationale : undefined,
              steps,
              availableSubagents,
              confirmed: false,
            },
          }
        })
        break
      }

      // v1.15+ server ack of `plan.response`. The editable review card is
      // already collapsed (respondPlan flips `confirmed=true` optimistically);
      // we keep the plan in `planDraft` through execution so the chat area
      // can render the collapsed top-right "执行计划" button + popover. It's
      // cleared on `response_end` when the turn finishes.
      case 'plan_approved': {
        const sid = eventSessionId!
        if (!sid) break
        updateSession(sid, (prev) => (
          prev.planDraft
            ? {
                ...prev,
                awaitingPlanProposed: false,
                planDraft: { ...prev.planDraft, confirmed: true, planStatus: prev.planDraft.planStatus ?? 'running' },
              }
            : { ...prev, awaitingPlanProposed: false }
        ))
        break
      }

      // v1.16+ §6.13/§6.16: PlanCoordinator emits the full plan/step
      // lifecycle. We use these to drive PlanStatusButton's live status
      // popover. `plan_created` also implicitly seeds a planDraft for the
      // auto-confirmation path (`plan_confirmation=auto`) where no
      // `plan_proposed` was ever sent.
      case 'plan_created':
      case 'plan_updated': {
        const sid = eventSessionId!
        if (!sid) break
        const planId = typeof event.plan_id === 'string' ? event.plan_id : ''
        if (!planId) break
        const rawTasks = Array.isArray(event.tasks) ? event.tasks : []
        const incomingSteps = rawTasks.flatMap((t) => {
          if (!t || typeof t !== 'object' || Array.isArray(t)) return []
          const task = t as Record<string, unknown>
          const id = typeof task.task_id === 'string' ? task.task_id : ''
          if (!id) return []
          return [{
            id,
            subagent_type: typeof task.subagent_type === 'string' ? task.subagent_type : undefined,
            description: typeof task.user_facing_title === 'string'
              ? task.user_facing_title
              : (typeof task.description === 'string' ? task.description : undefined),
            depends_on: Array.isArray(task.depends_on)
              ? task.depends_on.filter((d): d is string => typeof d === 'string')
              : undefined,
          }]
        })
        const goal = typeof event.goal === 'string' ? event.goal : ''
        updateSession(sid, (prev) => {
          // If an existing draft matches this plan_id, merge — preserve any
          // user-edited descriptions / prompts but pick up the resolved
          // subagent_type from the dispatched step list.
          if (prev.planDraft && prev.planDraft.planId === planId) {
            const byId = new Map(incomingSteps.map((s) => [s.id, s]))
            const merged = prev.planDraft.steps.map((s) => {
              const incoming = byId.get(s.id)
              if (!incoming) return s
              return {
                ...s,
                subagent_type: s.subagent_type || incoming.subagent_type,
                description: s.description || incoming.description,
                depends_on: s.depends_on ?? incoming.depends_on,
              }
            })
            // Append any new steps the planner introduced (rare on update).
            for (const step of incomingSteps) {
              if (!merged.some((m) => m.id === step.id)) merged.push(step)
            }
            return {
              ...prev,
              planDraft: {
                ...prev.planDraft,
                steps: merged,
                planStatus: prev.planDraft.planStatus ?? 'created',
              },
            }
          }
          // v1.16 §6.16: when `plan_confirmation="required"` was sent,
          // `plan.created` arrives BEFORE `plan.proposed`. Skip synthesis
          // here so the inline review card from `plan.proposed` isn't
          // preempted by a `confirmed: true` button. The proposed handler
          // will set up the draft shortly.
          if (prev.awaitingPlanProposed) return prev
          // Auto-confirmation path (no plan.proposed): synthesize a
          // confirmed planDraft so the top-right status button still shows.
          return {
            ...prev,
            planDraft: {
              planId,
              agentId: undefined,
              goal,
              rationale: undefined,
              steps: incomingSteps,
              availableSubagents: [],
              confirmed: true,
              planStatus: 'created',
            },
          }
        })
        break
      }

      case 'plan_completed':
      case 'plan_failed': {
        const sid = eventSessionId!
        if (!sid) break
        const completed = event.type === 'plan_completed'
        updateSession(sid, (prev) => (
          prev.planDraft
            ? { ...prev, planDraft: { ...prev.planDraft, planStatus: completed ? 'completed' : 'failed' } }
            : prev
        ))
        break
      }

      case 'step_dispatched':
      case 'step_started':
      case 'step_completed':
      case 'step_failed':
      case 'step_skipped':
      case 'step_progress': {
        const sid = eventSessionId!
        if (!sid) break
        const stepId = typeof event.step_id === 'string' ? event.step_id : ''
        if (!stepId) break
        const subagentType = typeof event.subagent_type === 'string' ? event.subagent_type : undefined
        let nextStatus: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'skipped' | undefined
        let nextSummary: string | undefined
        switch (event.type) {
          case 'step_dispatched':
            nextStatus = 'dispatched'
            nextSummary = typeof event.input_summary === 'string' ? event.input_summary : undefined
            break
          case 'step_started':
            nextStatus = 'running'
            break
          case 'step_completed':
            nextStatus = 'completed'
            nextSummary = typeof event.output_summary === 'string' ? event.output_summary : undefined
            break
          case 'step_failed': {
            nextStatus = 'failed'
            const err = event.error as Record<string, unknown> | undefined
            nextSummary = typeof err?.user_message === 'string'
              ? err.user_message
              : typeof err?.message === 'string' ? err.message : undefined
            break
          }
          case 'step_skipped':
            nextStatus = 'skipped'
            nextSummary = typeof event.reason === 'string' ? event.reason : undefined
            break
          case 'step_progress':
            // Treat progress as "still running" without overwriting a
            // terminal status. Stage hint becomes the summary line.
            nextStatus = 'running'
            nextSummary = typeof event.stage === 'string' ? event.stage : undefined
            break
        }
        updateSession(sid, (prev) => {
          // Recovery: if the renderer lost its `planDraft` (app restart
          // mid-execution, premature `response_end`, or an interrupted
          // session that never received `plan_proposed/created`),
          // step.* events would otherwise be silently dropped and the
          // top-right `PlanStatusButton` would never re-appear despite
          // the engine still emitting steps. Synthesize a minimal
          // confirmed planDraft from this event so the button can
          // resurrect itself and accumulate the remaining steps.
          let draft = prev.planDraft
          if (!draft) {
            const planIdFromEvent = typeof event.plan_id === 'string' ? event.plan_id : ''
            if (!planIdFromEvent) return prev
            draft = {
              planId: planIdFromEvent,
              agentId: undefined,
              goal: '',
              rationale: undefined,
              steps: [],
              availableSubagents: [],
              confirmed: true,
              planStatus: 'running',
            }
          }
          let touched = !prev.planDraft
          const steps = draft.steps.map((s) => {
            if (s.id !== stepId) return s
            // Don't downgrade a terminal status (completed/failed/skipped)
            // back to running on a late progress event.
            const isTerminal = s.status === 'completed' || s.status === 'failed' || s.status === 'skipped'
            const status = isTerminal && event.type === 'step_progress' ? s.status : (nextStatus ?? s.status)
            const summary = nextSummary ?? s.summary
            const subagent_type = s.subagent_type || subagentType
            if (status === s.status && summary === s.summary && subagent_type === s.subagent_type) return s
            touched = true
            return { ...s, status, summary, subagent_type }
          })
          if (!touched) return prev
          // If the step wasn't in the existing list, append a synthetic one
          // so the popover doesn't lose track. Rare, but possible if a
          // late `step.*` event arrives for an unseen plan.
          const exists = draft.steps.some((s) => s.id === stepId)
          const finalSteps = exists ? steps : [
            ...steps,
            {
              id: stepId,
              subagent_type: subagentType,
              status: nextStatus,
              summary: nextSummary,
            },
          ]
          return { ...prev, planDraft: { ...draft, steps: finalSteps } }
        })
        break
      }

      case 'task_end': {
        const sid = eventSessionId!
        const aid = pendingAssistantIds.current[sid]
        if (!subagent || !aid) break
        const activity: ToolActivity = {
          type: 'status',
          name: 'task_end',
          content: subagent.status === 'error' ? t('chat.status.subagentEndFailed') : t('chat.status.subagentEnd'),
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
          currentIntent: undefined,
          isPaused: false,
          isStopping: false,
          pauseReason: undefined,
          messages: prev.messages.map((m) =>
            m.id === aid ? { ...m, isStreaming: false, content: m.content || t('chat.status.terminated') } : m
          ),
        }))
        break
      }

      case 'error': {
        const sid = eventSessionId || activeSessionIdRef.current || ''
        if (sid) {
          const pendingAssistantId = pendingAssistantIds.current[sid]
          const systemNotice = buildSystemErrorNotice(t, event.error || event.payload || event.content || event)
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

  const handleSend = async () => {
    const message = composerPayload
    if ((!message && attachments.length === 0 && pasted.blocks.length === 0) || activeSession.isProcessing) return

    const sid = activeSessionId || ensureLocalSession(undefined, activeProjectContext || null)

    // Split attachments into image-typed (which flow through the
    // multimodal wire content[] path) vs non-image (legacy
    // JSON-text-block path inside buildMessagePayload). Image
    // attachments are NEVER appended to the prompt text — they go on
    // the wire as proper image content blocks via the new images
    // option to window.harnessclaw.send.
    const imageAttachments = attachments.filter((a) => a.kind === 'image')

    // No vision pre-gate: images always pass through. The server no
    // longer rejects image input for non-vision models either — many
    // tools consume images (image_generate, video_create i2v, browser
    // agent), so the downstream model/provider decides what to do.

    // Read each image to base64 + sniffed MIME via the main-process
    // IPC. Hard limit (10 MB / file) and MIME whitelist are enforced
    // in main; we surface failures inline so the user knows which
    // file blew up rather than silently dropping them.
    const wireImages: Array<{ mime: string; base64: string }> = []
    for (const att of imageAttachments) {
      if (!att.path) continue
      const res = await window.files.readBase64(att.path)
      if (!res.ok) {
        const failAt = Date.now()
        updateSession(sid, (prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: `img-${failAt}`,
              role: 'assistant',
              content: '',
              timestamp: failAt,
              systemNotice: {
                kind: 'error',
                title: `读取图片失败：${att.name}`,
                message: res.message || res.error,
                hint: '支持 PNG / JPEG / GIF / WebP / PDF，最大 10MB。',
              },
            },
          ],
        }))
        return
      }
      wireImages.push({ mime: res.mime, base64: res.data })
    }

    const pastedSuffix = pasted.buildPastedSuffix()
    const fullMessage = [message, pastedSuffix].filter(Boolean).join('\n\n')
    // v1.x: 把所有附件（包括图片）的元数据都写进 prompt 末尾的 JSON 块，
    // 让重新打开会话时 extractAttachments 能恢复出完整的附件列表（图片
    // 不再丢失）。图片实际内容仍然只在 wire 上以 multimodal content 块
    // 发送，不会出现在 prompt 文本里；元数据里携带 `kind:"image"` 让模型
    // 知道这些条目已经内联提供，不必再用文件工具去读。
    const payload = buildMessagePayload(fullMessage, attachments)
    const attachedFiles = [...attachments]

    // Fail-fast when the backend is not connected. Without this guard the
    // message would enter an indefinite "thinking" state because
    // `window.harnessclaw.send` would block on `waitForTransport` in the main
    // process while the reconnect loop runs.
    if (harnessclawStatus !== 'connected') {
      const sendAt = Date.now()
      updateSession(sid, (prev) => ({
        ...prev,
        isProcessing: false,
        currentThinking: '',
        isPaused: false,
        isStopping: false,
        pauseReason: undefined,
        messages: [
          ...prev.messages,
          {
            id: `usr-${sendAt}`,
            role: 'user',
            content: fullMessage,
            attachments: attachedFiles,
            timestamp: sendAt,
          },
          {
            id: `err-${sendAt}`,
            role: 'assistant',
            content: '',
            timestamp: sendAt,
            systemNotice: {
              kind: 'error',
              title: t('chat.errors.serviceNotConnected'),
              message: harnessclawStatus === 'connecting'
                ? t('chat.errors.tryingToConnect')
                : t('chat.errors.cannotConnect'),
              hint: t('chat.errors.serviceIssue'),
            },
          },
        ],
      }))
      setInput('')
      setSelectedSkills([])
      setAttachments([])
      pasted.clearBlocks()
      return
    }

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
    // Await the IPC so that an explicit `false` (e.g. transport-not-open
    // thrown inside the main process) immediately clears the thinking state.
    const sendOptions = wireImages.length > 0 ? { images: wireImages } : undefined
    trackMessageSent({
      message_length: fullMessage.length,
      has_attachments: attachedFiles.length > 0,
    })
    void window.harnessclaw.send(payload, sid, sendOptions).then((ok) => {
      if (ok) return
      const errorAt = Date.now()
      const pendingAssistantId = pendingAssistantIds.current[sid]
      pendingAssistantIds.current[sid] = null
      updateSession(sid, (prev) => {
        const messages = [...prev.messages]
        const attachIndex = findAttachableAssistantMessageIndex(messages, errorAt, pendingAssistantId)
        const notice: SystemNoticeData = {
          kind: 'error',
          title: t('chat.status.requestFailed'),
          message: t('chat.status.serviceNotConnected'),
          hint: t('chat.status.serviceNotConnectedHint'),
        }
        if (attachIndex >= 0) {
          messages[attachIndex] = {
            ...messages[attachIndex],
            isStreaming: false,
            systemNotice: notice,
            timestamp: errorAt,
          }
        } else {
          messages.push({
            id: `err-${errorAt}`,
            role: 'assistant',
            content: '',
            systemNotice: notice,
            timestamp: errorAt,
          })
        }
        return {
          ...prev,
          isProcessing: false,
          currentThinking: '',
          isPaused: false,
          isStopping: false,
          pauseReason: undefined,
          messages,
        }
      })
    }).catch(() => {
      // IPC layer failure (e.g. preload error) — clear the thinking state too.
      updateSession(sid, (prev) => ({
        ...prev,
        isProcessing: false,
        currentThinking: '',
      }))
    })
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
      pauseReason: t('chat.status.stoppingSession'),
    }))
    void closeBrowserSessionIDs(activeBrowserSessionIDs)
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
    <WebPreviewContext.Provider value={openWebPreview}>
    <LinkOpenBehaviorContext.Provider value={linkOpenBehavior}>
    <div className="relative flex h-full overflow-hidden bg-background">
      {/* Main chat area */}
      <div className="relative flex-1 flex min-w-0 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="titlebar-drag border-b border-border/70 px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-foreground">
                <MessagesSquare size={16} className="flex-shrink-0 text-muted-foreground" />
                {activeSessionId ? (
                  <SessionTitleMenu
                    sessionId={activeSessionId}
                    title={activeSessionPrompt || t('chat.newChat')}
                    currentProjectId={activeProjectContext?.projectId || null}
                    onDelete={handleClearHistory}
                  />
                ) : (
                  <h1 className="truncate text-lg font-semibold tracking-tight">{t('chat.newChat')}</h1>
                )}
              </div>
              {activeProjectContext ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t('chat.header.activeProject', { name: activeProjectContext.name })}
                </p>
              ) : null}
            </div>

            {activeSessionId && (
              <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                {/* Files button — lists the session's working directory
                    (`~/.harnessclaw/workspace/session/<sid>`) as a file
                    tree, with an inline preview pane next to it. Both
                    panes are visible by default so users land directly
                    on the workspace view without an extra click. */}
                <SessionWorkspaceFilesButton sessionId={activeSessionId} />
                {/* Session-level stats popover (context window utilization,
                    cost, tokens, latency, per sub-agent breakdown).
                    Polls `/api/v1/sessions/{id}/metrics` on the Console
                    port every 5s while the popover is open; cost is
                    computed client-side from a static pricing table
                    (see Session Metrics API doc §"客户端使用指南"). */}
                <SessionStatsButton sessionId={activeSessionId} />
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
                    {t('chat.composer.sendHint')}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-[11px] text-foreground/80">
                    {t('chat.composer.dropFiles')}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-[11px] text-foreground/80">
                    {t('chat.composer.permissionHint')}
                  </span>
                </div>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleNewSession}
                    className="chat-empty-cta inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 dark:bg-primary dark:text-primary-foreground"
                  >
                    <Plus size={14} />
                    {t('chat.welcome.startNew')}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {t('chat.welcome.welcomeDesc')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="relative flex flex-1 min-h-0 flex-col">
              {/* v1.15+ Once the user approves the plan the inline review
                  card collapses and we surface a small icon button in the
                  top-right of the conversation area. Click → popover with
                  read-only plan steps so the user can keep tabs on the
                  execution roadmap while sub-agents run.
                  (Session stats button lives in the title bar, not here.) */}
              {activeSession.planDraft?.confirmed && (
                <div className="pointer-events-none absolute right-4 top-3 z-20 flex justify-end sm:right-6">
                  <PlanStatusButton
                    plan={{
                      planId: activeSession.planDraft.planId,
                      goal: activeSession.planDraft.goal,
                      rationale: activeSession.planDraft.rationale,
                      steps: activeSession.planDraft.steps,
                      planStatus: activeSession.planDraft.planStatus,
                    }}
                  />
                </div>
              )}
              <ConversationTimeline
                collaboration={displayCollaboration}
                displayMessages={displayMessages}
                isProcessing={activeSession.isProcessing}
                isPaused={activeSession.isPaused}
                isStopping={activeSession.isStopping}
                currentThinking={activeSession.currentThinking}
                currentIntent={activeSession.currentIntent}
                pendingAssistantMessage={pendingAssistantMessage}
                planDraft={activeSession.planDraft}
                messagesViewportRef={messagesViewportRef}
                messagesEndRef={messagesEndRef}
                onScroll={updateScrollState}
                onOpenFilePreview={setFilePreview}
                onPreviewUserImage={openUserImagePreview}
                onOpenArtifact={(artifactId) => {
                  const artifact = sessionArtifacts.find((a) => a.artifact_id === artifactId)
                  if (!artifact) return
                  void openArtifactPreview(artifact, activeSessionId)
                }}
                onRespondPermission={respondPermission}
                onRespondAskQuestion={respondAskQuestion}
                onRespondStepDecision={respondStepDecision}
                onRespondPlan={(planId, approved, options) => {
                  void respondPlan(activeSessionId, planId, approved, options)
                }}
              />
              <ConversationQuickNav
                displayMessages={displayMessages}
                messagesViewportRef={messagesViewportRef}
              />
            </div>

            {showJumpToBottom && (
              <button
                onClick={() => scrollToBottom()}
                className="chat-jump-to-bottom absolute bottom-[calc(100px+1.5rem)] left-1/2 z-20 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-border/80 bg-white text-foreground shadow-[0_14px_30px_rgba(15,23,42,0.14)] transition-[transform,background-color,border-color,box-shadow] hover:scale-[1.03] hover:border-border hover:bg-muted hover:shadow-[0_18px_36px_rgba(15,23,42,0.18)] dark:bg-card dark:hover:bg-muted/60"
                aria-label={t('chat.scroll.toBottom')}
                title={t('chat.scroll.toBottom')}
              >
                <ArrowDown size={18} className="text-foreground" />
              </button>
            )}

            {/* Input area */}
            <div className="bg-card/45 px-4 py-2.5 backdrop-blur-sm">
              <div className="mx-auto w-full max-w-4xl">
                {pendingStepDecision && (
                  <div className="mb-3 rounded-2xl border border-orange-300 bg-orange-50 px-3.5 py-3 dark:border-orange-700/50 dark:bg-orange-950/30">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-orange-600 dark:text-orange-300" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-orange-900 dark:text-orange-100">
                          {t('chat.decision.needsAction', {
                            target: pendingStepDecision.scope === 'plan'
                              ? t('chat.decision.targetPlan')
                              : t('chat.decision.targetStep', { id: pendingStepDecision.stepId || '' })
                          })} · {t('chat.decision.retryCount', { n: pendingStepDecision.attempts })}
                        </p>
                        {pendingStepDecision.stepDescription && (
                          <p className="mt-0.5 truncate text-[11px] text-orange-800/80 dark:text-orange-200/80">
                            {pendingStepDecision.stepDescription}
                          </p>
                        )}
                        {pendingStepDecision.reason && (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-orange-800 dark:text-orange-200">
                            {t('chat.decision.failedReason', { reason: pendingStepDecision.reason })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
                      {pendingStepDecision.allowRetry && (
                        <button
                          onClick={() => respondStepDecision(pendingStepDecision.requestId, 'retry')}
                          className="inline-flex items-center gap-1.5 rounded-full border border-orange-400 bg-white px-3 py-1 text-xs font-medium text-orange-700 transition hover:bg-orange-100 dark:border-orange-600 dark:bg-orange-900/30 dark:text-orange-200 dark:hover:bg-orange-900/50"
                        >
                          <RefreshCw size={12} />
                          {t('chat.decision.retryOnce')}
                        </button>
                      )}
                      <button
                        onClick={() => respondStepDecision(pendingStepDecision.requestId, 'continue')}
                        className="inline-flex items-center gap-1.5 rounded-full border border-orange-400 bg-white px-3 py-1 text-xs font-medium text-orange-700 transition hover:bg-orange-100 dark:border-orange-600 dark:bg-orange-900/30 dark:text-orange-200 dark:hover:bg-orange-900/50"
                      >
                        {t('chat.decision.skipStep')}
                      </button>
                      <button
                        onClick={() => respondStepDecision(pendingStepDecision.requestId, 'cancel')}
                        className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/60"
                      >
                        {t('chat.decision.abortTask')}
                      </button>
                    </div>
                  </div>
                )}

                {engineNoteBanner && !pendingStepDecision && (
                  <div
                    className={cn(
                      'mb-3 flex items-start gap-2 rounded-2xl border px-3.5 py-2.5',
                      engineNoteBanner.severity === 'error'
                        ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20'
                        : engineNoteBanner.severity === 'warn'
                          ? 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'
                          : 'border-sky-200 bg-sky-50 dark:border-sky-900/40 dark:bg-sky-950/20'
                    )}
                  >
                    {engineNoteBanner.severity === 'warn' || engineNoteBanner.severity === 'error' ? (
                      <RefreshCw size={14} className={cn('mt-0.5 flex-shrink-0 animate-spin', engineNoteBanner.severity === 'error' ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300')} />
                    ) : (
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-sky-600 dark:text-sky-300" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-xs leading-5',
                          engineNoteBanner.severity === 'error'
                            ? 'text-red-800 dark:text-red-200'
                            : engineNoteBanner.severity === 'warn'
                              ? 'text-amber-800 dark:text-amber-200'
                              : 'text-sky-800 dark:text-sky-200'
                        )}
                      >
                        {engineNoteBanner.text}
                        {engineNoteBanner.stepId && (
                          <span className="ml-1.5 opacity-60">· {t('chat.decision.stepLabel', { id: engineNoteBanner.stepId })}</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}

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
                        <p className="text-sm font-medium">{t('chat.composer.dropToUpload')}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{t('chat.composer.dropDesc')}</p>
                      </div>
                    </div>
                  )}
                  <div className="p-3 sm:p-3.5">
                    {pasted.blocks.length > 0 && (
                      <div className="mb-2">
                        <PastedBlocksBar
                          blocks={pasted.blocks}
                          onRemove={pasted.removeBlock}
                          onUpdate={activeSession.isProcessing ? undefined : pasted.updateBlock}
                          removable={!activeSession.isProcessing}
                        />
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
                          ? t('chat.composer.placeholderConnected')
                          : t('chat.composer.placeholderDisconnected')
                      }
                      maxLength={maxLength}
                      className=""
                      rows={1}
                    />
                    <AttachmentPreviewPanel
                      attachments={attachments}
                      onRemove={handleRemoveAttachment}
                      removable={!activeSession.isProcessing}
                      // 点击附件即打开预览抽屉。先用 window.files.read 在主进程
                      // 把内容转好（docx → HTML、pdf → 文本、纯文本直读、二进制
                      // 占位 + isBinary），失败时也填一个空 preview 让用户至少
                      // 看到文件名/路径。
                      onPreview={async (attachment) => {
                        try {
                          const result = await window.files.read(attachment.path)
                          setFilePreview({
                            path: result?.path || attachment.path,
                            fileName: attachment.name || attachment.path.split(/[\\/]/).pop() || attachment.path,
                            operation: 'read_file',
                            content: result?.ok && typeof result.content === 'string' ? result.content : '',
                            isBinary: result?.ok ? Boolean(result.isBinary) : false,
                            previewKind:
                              result?.ok && (result.previewKind === 'html' || result.previewKind === 'text')
                                ? result.previewKind
                                : undefined,
                          })
                        } catch (err) {
                          console.error('Failed to preview attachment:', err)
                          setFilePreview({
                            path: attachment.path,
                            fileName: attachment.name || attachment.path,
                            operation: 'read_file',
                            content: '',
                          })
                        }
                      }}
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          onClick={handlePickFiles}
                          disabled={activeSession.isProcessing || harnessclawStatus !== 'connected'}
                          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                          title={t('chat.composer.addFilesAria')}
                          aria-label={t('chat.composer.addFilesAria')}
                        >
                          <Plus size={16} />
                        </button>
                        <BrowserSessionIndicatorButton
                          session={browserSessionIndicator.session}
                          busy={browserSessionIndicator.busy}
                          onToggle={() => void browserSessionIndicator.toggle()}
                          onCloseAll={() => void browserSessionIndicator.closeAll()}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        {activeSession.isProcessing && !isAwaitingPromptResponse ? (
                          <button
                            onClick={handleStop}
                            disabled={activeSession.isStopping}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
                            title={t('chat.composer.stopAria')}
                            aria-label={t('chat.composer.stopAria')}
                          >
                            <span className="h-2 w-2 rounded-sm bg-current" />
                          </button>
                        ) : (
                          <button
                            onClick={handleSend}
                            disabled={!canSend}
                            className="chat-send-button inline-flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-primary dark:text-primary-foreground"
                            aria-label={t('chat.composer.sendAria')}
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

      {/* Right-side panel: logs (plan steps) + artifacts. Default collapsed. */}
      <ConversationSidePanel
        steps={activeSession.planDraft?.steps || []}
        artifacts={sessionArtifacts}
        onSelectArtifact={(artifact) => {
          void openArtifactPreview(artifact, activeSessionId)
        }}
      />

      <FilePreviewDrawer
        preview={filePreview}
        onClose={() => setFilePreview(null)}
        artifacts={sessionArtifacts}
        onSelectArtifact={(artifact) => {
          void openArtifactPreview(artifact, activeSessionId)
        }}
      />
      {/* 用户消息里的图片附件改用居中 FilePreviewModal（首页输入框预览同款），
          内部 createPortal 到 body，不受当前容器 overflow/transform 影响。 */}
      <FilePreviewModal preview={userImagePreview} onClose={() => setUserImagePreview(null)} />
      <WebPreviewDrawer preview={webPreview} onClose={() => setWebPreview(null)} />
      {/* v0.6.0 §10.9 — framework system notice (card_kind=system). Renders
          the head of the active session's notice queue as a modal the user
          MUST manually acknowledge. Dismissing pops the head; the next
          queued notice (if any) takes its place. */}
      <SystemNoticeModal
        notice={(activeSession.systemNotices || [])[0] || null}
        queueDepth={Math.max(0, (activeSession.systemNotices?.length || 0) - 1)}
        onAcknowledge={(id) => {
          if (!activeSessionId) return
          updateSession(activeSessionId, (prev) => ({
            ...prev,
            systemNotices: (prev.systemNotices || []).filter((n) => n.id !== id),
          }))
        }}
        onNavigateDeeplink={(deeplink) => {
          // v0.6.1 §10.9 — route business-logic affordances off the stable
          // `topic`-derived deeplink, NOT off the notice text. Current map:
          //   `settings:<section>` → /settings with initialSection=<section>.
          if (deeplink.startsWith('settings:')) {
            const section = deeplink.slice('settings:'.length)
            navigate('/settings', { state: { initialSection: section } })
          }
        }}
      />
    </div>
    </LinkOpenBehaviorContext.Provider>
    </WebPreviewContext.Provider>
  )
}

// ─── Agent Avatar ────────────────────────────────────────────────────────────

/** Extensible avatar: pass agentId to resolve a per-agent icon in the future. */
function AgentAvatar({ agentId, agentName, size = 'md' }: { agentId?: string; agentName?: string; size?: 'md' | 'sm' }) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const textHeight = size === 'sm' ? 'h-2.5' : 'h-3'
  // Main agent (emma) — or fallback when no agentId is given
  if (!agentId) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1">
        <AvatarLightbox
          src={emmaAvatar}
          alt="Emma"
          triggerClassName="rounded-full"
          imgClassName={cn(dim, 'rounded-full object-cover')}
        />
        <img
          src={emmaText}
          alt="EMMA"
          className={cn(textHeight, 'object-contain')}
        />
      </div>
    )
  }
  // Sub-agent — resolve to one of the 5 team member avatars
  const src = resolveTeamAvatar(agentName || agentId)
  return (
    <AvatarLightbox
      src={src}
      alt={agentName || agentId}
      triggerClassName="flex-shrink-0 rounded-full"
      imgClassName={cn(dim, 'rounded-full bg-muted object-cover')}
    />
  )
}

// ─── Sub Components ─────────────────────────────────────────────────────────

function CollaborationOverview({ collaboration }: { collaboration: CollaborationState }) {
  const { t } = useTranslation()
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
              {t('chat.status.routedToPrefix')} <span className="font-medium text-foreground">@{collaboration.routedAgent.agentName}</span>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('chat.task.detailsLabel')}</p>
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
                          {task.activeForm || t('chat.status.taskUpdated')}{task.owner ? ` · ${task.owner}` : ''}
                        </p>
                      )}
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getTaskStatusClasses(task.status), task.status === 'in_progress' && 'multi-agent-badge-running')}>
                      {task.status === 'in_progress' ? (
                        <span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" />{t('chat.taskStatus.inProgress')}</span>
                      ) : (
                        getTaskStatusLabel(t, task.status)
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('chat.status.asyncAgents')}</p>
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
                        {agent.description || t('chat.status.asyncCollab')}
                      </p>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getAsyncAgentStatusClasses(agent.status), agent.status === 'running' && 'multi-agent-badge-running')}>
                      {agent.status === 'running' ? (
                        <span className="inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" />{t('chat.asyncAgentStatus.running')}</span>
                      ) : (
                        getAsyncAgentStatusLabel(t, agent.status)
                      )}
                    </span>
                  </div>
                  {(agent.durationMs || agent.errorMessage) && (
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                      {agent.errorMessage ? agent.errorMessage : t('chat.status.totalDuration', { time: formatDurationMs(agent.durationMs) })}
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('chat.team.membersLabel')}</p>
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
                    <span>{item.to === '*' ? t('chat.status.allMembers') : item.to}</span>
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

/**
 * v1.12: collapsible expander showing the full task prompt that the parent
 * agent handed to a sub-agent. Mirrors the rest of the project's expander
 * style (small chevron + "查看任务详情" trigger, code-style task body).
 */
function TaskPromptExpander({ prompt }: { prompt: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const trimmed = prompt.trim()
  if (!trimmed) return null
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{expanded ? t('chat.task.hideDetails') : t('chat.task.viewDetails')}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px] leading-5 text-foreground/85">
          <p className="whitespace-pre-wrap break-words">{trimmed}</p>
        </div>
      )}
    </div>
  )
}

/**
 * 用户消息正文渲染器：超过 8 行的输入会被折叠成约 8 行高，并在底部用
 * mask-image 渐隐（与侧边栏「最近对话」靠近底部的 fade 同款），紧贴下方
 * 的「展开 / 收起」按钮自然衔接被遮掩的尾部。≤8 行的消息原样渲染。
 *
 * 这里只按显式换行符计数（split('\n')），不试图测量软换行；对绝大多数
 * 「贴入多行段落」的场景已经够用，复杂度也最低。
 */
const USER_MESSAGE_FOLD_LINES = 8
function UserMessageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const lineCount = useMemo(() => text.split('\n').length, [text])
  const tooLong = lineCount > USER_MESSAGE_FOLD_LINES

  if (!tooLong) {
    return <p className="whitespace-pre-wrap">{text}</p>
  }

  return (
    <div className="flex flex-col">
      <p
        className={cn(
          'whitespace-pre-wrap',
          // 8 行 × text-sm (line-height 1.25rem) = 10rem。再补一点让 mask
          // 的渐隐区有足够「呼吸」，避免最后一行被切得太死。
          !expanded && 'max-h-[10.5rem] overflow-hidden user-message-fade-bottom',
        )}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        // 在用户气泡（深色背景）里，按钮用半透明文字保持低调，hover
        // 时再点亮。折叠态下用负 margin 让按钮往上贴近被遮罩的尾部，
        // 视觉上就像 fade 直接过渡到按钮所在的那一行。`self-center` 让
        // 按钮在气泡里水平居中。
        className={cn(
          'self-center inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium opacity-75 transition-opacity hover:opacity-100 focus:outline-none focus-visible:opacity-100',
          expanded ? 'mt-1.5' : '-mt-3',
        )}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>{expanded ? '收起' : `展开（共 ${lineCount} 行）`}</span>
      </button>
    </div>
  )
}

function MessageBubble({
  message,
  syncAgents,
  onOpenFilePreview,
  onPreviewUserImage,
  onOpenArtifact,
  onRespondPermission,
  onRespondAskQuestion,
  onRespondStepDecision,
}: {
  message: Message
  /** v1.12: per-agent state used to render the sub-agent task expander and
   * intent shimmer inside the agent-team segment header. */
  syncAgents?: Record<string, SyncAgentState>
  onOpenFilePreview: (preview: FilePreviewData) => void
  /** v1.x: 用户消息中的图片点击改走居中 FilePreviewModal（与首页一致）。
   * 非图片附件仍走 onOpenFilePreview / openFilePathPreview。 */
  onPreviewUserImage: (attachment: LocalAttachmentItem) => void
  onOpenArtifact?: (artifactId: string) => void
  onRespondPermission: (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
  onRespondAskQuestion: RespondAskQuestionHandler
  /** v0.5.0: continue / retry / cancel decision reply for step_decision. */
  onRespondStepDecision: RespondStepDecisionHandler
}) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
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
        isBinary: result?.ok ? Boolean(result.isBinary) : false,
        previewKind: result?.ok && (result.previewKind === 'html' || result.previewKind === 'text')
          ? result.previewKind
          : undefined,
      })
    } catch (error) {
      console.error('Failed to read file path:', error)
      const fileName = path.split(/[\\/]/).pop() || path
      onOpenFilePreview({ path, fileName, operation: 'read_file', content: '' })
    }
  }, [onOpenFilePreview])

  // Link-open preference + drawer opener consumed by the markdown `a`
  // renderer below. Lifted out of the JSX so we don't subscribe to context
  // for every paragraph/code-block React renders.
  const linkOpenBehavior = useContext(LinkOpenBehaviorContext)
  const openWebPreviewFromCtx = useOpenWebPreview()
  const systemNotice = message.systemNotice
  const errorNotice = systemNotice?.kind === 'error' ? systemNotice : undefined

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRate = (newRating: 'up' | 'down') => {
    const finalRating = rating === newRating ? null : newRating
    setRating(finalRating)
    if (finalRating) {
      // 上报点赞点踩埋点
      // session_id 从 message 里推断(message 属于哪个 session 在渲染时已知,但这里拿不到)
      // 服务端可以从 device_id + timestamp 推断会话,或者 session_id 就是可选字段
      window.appRuntime.telemetry.track({
        category: 'feedback',
        action: 'message_rated',
        properties: {
          rating: finalRating,
          message_id: message.id
        }
      }).catch(() => {})
    }
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
              {t('chat.toolResult.failed')}：{notice.hint}
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
              {formatMessageTime(i18n.language, message.timestamp)}
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
    | { kind: 'question'; request: ToolActivity; result?: ToolActivity; ts: number; subagent?: SubagentInfo }
    | { kind: 'step_decision'; request: ToolActivity; result?: ToolActivity; ts: number; subagent?: SubagentInfo }
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
  const questionResults = tools.filter((a) => a.type === 'question_result')
  const stepDecisionResults = tools.filter((a) => a.type === 'step_decision_result')

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
    } else if (t.type === 'question') {
      const result = questionResults.find((r) => r.callId === t.callId)
      segments.push({ kind: 'question', request: t, result, ts: t.ts, subagent: t.subagent || result?.subagent })
    } else if (t.type === 'step_decision') {
      const result = stepDecisionResults.find((r) => r.callId === t.callId)
      segments.push({ kind: 'step_decision', request: t, result, ts: t.ts, subagent: t.subagent || result?.subagent })
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

  // Chronological multi-chat grouping. Walk segments in time order; if the
  // current segment's speaker matches the most-recent module's speaker,
  // append to it (rule 1 — old/continuing task appends after itself).
  // If the speaker is different from the previous module's speaker, open
  // a brand-new module so the speaker change is visible (rule 2 — new
  // speaker → new module, with its own avatar). The same speaker can have
  // multiple non-consecutive modules over the course of a message; each
  // module renders the speaker's avatar so the layout reads like a
  // multi-person chat transcript.
  const displaySegments: DisplaySegment[] = []
  const mainSpeakerKey = '__main__'

  for (const seg of segments) {
    const speakerKey = seg.subagent ? `agent:${seg.subagent.taskId}` : mainSpeakerKey
    const lastSegment = displaySegments[displaySegments.length - 1]

    if (!seg.subagent) {
      if (lastSegment?.kind === 'main') {
        lastSegment.items.push(seg)
      } else {
        displaySegments.push({ kind: 'main', items: [seg], ts: seg.ts })
      }
      continue
    }

    // Sub-agent segment: only continue the previous agent-team module when
    // the most-recent module is also an agent-team AND its trailing speaker
    // is THIS sub-agent. Otherwise (different sub-agent or main was last),
    // start a fresh agent-team module so each unique speaker gets its own
    // visual block in chronological order.
    const lastIsSameSpeaker =
      lastSegment?.kind === 'agent-team' &&
      lastSegment.agents.length > 0 &&
      `agent:${lastSegment.agents[lastSegment.agents.length - 1].task.taskId}` === speakerKey

    if (lastIsSameSpeaker && lastSegment?.kind === 'agent-team') {
      const member = lastSegment.agents[lastSegment.agents.length - 1]
      member.task = seg.subagent
      member.items.push(seg)
      continue
    }

    displaySegments.push({
      kind: 'agent-team',
      agents: [{ task: seg.subagent, items: [seg], ts: seg.ts }],
      ts: seg.ts,
    })
  }

  const attachments = message.attachments || []
  // 对用户消息把图片与其它附件拆开渲染：图片放在文字之前（更接近粘贴所
  // 见即所得的预览），其它附件保留在文字之后的原位置。助手消息维持原行为，
  // 直接合并渲染。
  const userImageAttachments = isUser ? attachments.filter((a) => a.kind === 'image') : []
  const userNonImageAttachments = isUser ? attachments.filter((a) => a.kind !== 'image') : []
  const trailingAttachments = isUser ? userNonImageAttachments : attachments
  // 呼吸闪烁小点已上移到 ConversationTimeline 尾部，与"鎏金"shimmer 文案
  // 同行渲染（受 isProcessing 控制），所以这里不再做 per-message 计算。
  const shouldShowTimestamp = !message.isStreaming
  const hasRenderableAssistantBody = displaySegments.length > 0 || attachments.length > 0 || !!errorNotice

  if (!isUser && !isSystem && !message.isStreaming && !hasRenderableAssistantBody) {
    return null
  }

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
        // User-typed text is shown verbatim — do NOT auto-linkify paths into
        // FilePathChips here. Users frequently paste raw filesystem paths
        // (e.g. `/Users/skb/Downloads/work001`) that may be directories,
        // non-existent, or simply not intended as clickable references. The
        // chip rendering is reserved for assistant output where the agent
        // has explicitly produced a path it knows is openable.
        // 超过 8 行的用户输入由 UserMessageText 折叠展示（底部 mask 渐隐 +
        // 「展开 / 收起」按钮），≤8 行的消息走原本的纯 <p> 路径。
        <UserMessageText text={text} />
      ) : (
        <div className={cn(
          'prose max-w-none break-words [overflow-wrap:anywhere] text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-hr:my-4 prose-hr:border-border/70 prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-code:break-all prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:text-foreground dark:prose-invert',
          compact ? 'prose-xs' : 'prose-sm'
        )}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkFilePaths]}
            // react-markdown v9 sanitizes hrefs by protocol via a default
            // `urlTransform` (only http/https/mailto/tel/... are kept). That
            // strips our custom `artifact://` and `filepath://` schemes to ''
            // so the `<a>` handler below can never see them. Whitelist them
            // explicitly while still falling back to the safe default for
            // every other URL.
            urlTransform={(url) => {
              if (typeof url === 'string' && (url.startsWith('artifact:') || url.startsWith(FILEPATH_HREF_PREFIX))) {
                return url
              }
              return defaultUrlTransform(url)
            }}
            components={{
              a: ({ href, children, ...props }) => {
                if (typeof href === 'string' && href.startsWith(FILEPATH_HREF_PREFIX)) {
                  const path = href.slice(FILEPATH_HREF_PREFIX.length)
                  return <FilePathChip path={path} onOpen={openFilePathPreview} />
                }
                // `artifact://art_xxx` links produced by agents must not be
                // treated as navigations (which would land on the homepage
                // because the renderer can't resolve the protocol). Intercept
                // the click and open the artifact in the file preview drawer.
                if (typeof href === 'string' && href.startsWith('artifact:')) {
                  const artifactId = href.replace(/^artifact:(\/\/)?/, '')
                  return (
                    <a
                      href={href}
                      onClick={(event) => {
                        event.preventDefault()
                        if (artifactId && onOpenArtifact) onOpenArtifact(artifactId)
                      }}
                      {...props}
                    >
                      {children}
                    </a>
                  )
                }
                // External URLs (http/https) honor the user's link-open
                // preference (Settings → UI 设置 → 链接打开方式):
                //   • 'drawer'   — intercept the click and surface the URL
                //     inside the in-app WebPreviewDrawer (the same drawer used
                //     for search-result URL chips).
                //   • 'external' — force `target="_blank"` so the click is
                //     routed through the main process `setWindowOpenHandler`,
                //     which calls `shell.openExternal` to open the user's
                //     default system browser. `noopener noreferrer` blocks the
                //     opened page from reaching back into our window.
                // mailto: always falls through to the system handler — there
                // is no sensible in-app preview for an email composer.
                const isHttp = typeof href === 'string' && /^https?:/i.test(href)
                const isMailto = typeof href === 'string' && /^mailto:/i.test(href)
                if (isHttp) {
                  if (linkOpenBehavior === 'drawer' && openWebPreviewFromCtx) {
                    return (
                      <a
                        href={href}
                        onClick={(event) => {
                          event.preventDefault()
                          const linkText =
                            typeof children === 'string'
                              ? children
                              : Array.isArray(children)
                                ? children.filter((c) => typeof c === 'string').join('')
                                : undefined
                          openWebPreviewFromCtx({ url: href as string, title: linkText || undefined })
                        }}
                        {...props}
                      >
                        {children}
                      </a>
                    )
                  }
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    >
                      {children}
                    </a>
                  )
                }
                if (isMailto) {
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    >
                      {children}
                    </a>
                  )
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
        <div className={cn(
          'mb-1 flex justify-end gap-1 opacity-100 transition-opacity md:absolute md:top-1 md:z-10 md:mb-0 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
          isUser ? 'md:-left-14 md:right-auto' : 'md:-right-14'
        )}>
          <button onClick={handleCopy} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-background/90 hover:bg-muted" aria-label={t('chat.actions.copyMessage')}>
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-muted-foreground" />}
          </button>
        </div>

        {/* 用户消息：图片附件放到文字段落之前，点击走居中 FilePreviewModal
            （与首页输入框下方的附件预览一致），不再使用 FilePreviewDrawer。 */}
        {isUser && userImageAttachments.length > 0 && (
          <div className="mb-1.5 flex justify-end">
            <div className="max-w-[420px]">
              <AttachmentPreviewPanel
                attachments={userImageAttachments}
                removable={false}
                onPreview={onPreviewUserImage}
              />
            </div>
          </div>
        )}

        {/* v2.2 M4: inter-round hint shown while assistant content is still empty */}
        {!isUser && !isSystem && message.isStreaming && !message.content && displaySegments.length === 0 && message.hintSummary && (
          <div className="mb-1.5 text-xs text-muted-foreground chat-thinking-shimmer" aria-live="polite">
            {message.hintSummary}
          </div>
        )}

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
                  if (item.kind === 'question') {
                    return (
                      <AskUserQuestionCard
                        key={item.request.callId || `${i}-${itemIndex}`}
                        request={item.request}
                        result={item.result}
                        onRespondAskQuestion={onRespondAskQuestion}
                      />
                    )
                  }
                  if (item.kind === 'step_decision') {
                    return (
                      <StepDecisionCard
                        key={item.request.callId || `${i}-${itemIndex}`}
                        request={item.request}
                        result={item.result}
                        onRespondStepDecision={onRespondStepDecision}
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
                  // v1.12: pull task prompt + live intent from the collaboration state.
                  const liveAgentState = syncAgents?.[latestTask.taskId]
                  const taskPrompt = liveAgentState?.task
                  const liveIntent = liveAgentState?.currentIntent?.text
                  // Compute hierarchy depth by walking parentAgentId up the
                  // syncAgents chain. Depth 0 = L2 specialist (parent = main),
                  // depth >= 1 = L3+ nested sub-agent. Each level adds left
                  // indentation so the parent/child relationship is visible.
                  let depth = 0
                  let parentId = liveAgentState?.parentAgentId
                  const seen = new Set<string>([latestTask.taskId])
                  while (parentId && parentId !== 'main' && !seen.has(parentId)) {
                    seen.add(parentId)
                    depth += 1
                    parentId = syncAgents?.[parentId]?.parentAgentId
                    if (depth > 4) break
                  }
                  const indentClass = depth === 0
                    ? 'ml-2'
                    : depth === 1
                      ? 'ml-8'
                      : depth === 2
                        ? 'ml-14'
                        : 'ml-20'
                  const subagentTypeLabel = liveAgentState?.subagentType
                  const loadedSkills = liveAgentState?.loadedSkills || []
                  return (
                    <div key={latestTask.taskId || `sub-${agentIdx}`} className={cn(indentClass, 'border-l-2 border-primary/20 pl-3')} data-agent-depth={depth}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <AgentAvatar agentId={latestTask.taskId || latestTask.label} agentName={latestTask.label} size="sm" />
                        <span className="text-xs font-medium text-foreground/80">{latestTask.label}</span>
                        {/* subagent_type: writer / freelancer / ... — the
                            LLM-facing dispatch label. Useful when the
                            agent's "label" is the codename/personality
                            (小林) and the user wants to know what kind of
                            worker it actually is. Hidden when missing
                            (legacy events) or duplicate of label. */}
                        {subagentTypeLabel && subagentTypeLabel !== latestTask.label && (
                          <span className="inline-flex items-center rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                            {subagentTypeLabel}
                          </span>
                        )}
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px]',
                          visualStatus === 'failed'
                            ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                            : visualStatus === 'running'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        )}>
                          {visualStatus === 'failed' ? t('chat.asyncAgentStatus.failed') : visualStatus === 'running' ? t('chat.asyncAgentStatus.running') : t('chat.asyncAgentStatus.completed')}
                        </span>
                      </div>

                      {/* Loaded skills row (engine 2026-05): freelancer or
                          any skill-aware fixed L3 carries preloaded skills
                          from SpawnSync (candidate) and/or runtime
                          LoadSkill calls. Showing the chips makes the
                          implicit skill injection visible — previously the
                          user couldn't tell whether the agent received a
                          skill at all. */}
                      {loadedSkills.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            已加载 skill
                          </span>
                          {loadedSkills.map((skill) => (
                            <span
                              key={skill.name}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none',
                                skill.source === 'runtime'
                                  ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                              )}
                              title={
                                skill.source === 'runtime'
                                  ? `${skill.name} — 运行时 LoadSkill 加载`
                                  : `${skill.name} — L2 派活时预装`
                              }
                            >
                              <span>📦</span>
                              <span>{skill.name}</span>
                              {skill.version && (
                                <span className="text-[9px] opacity-70">v{skill.version}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* v1.12: live agent.intent shimmer rendered inside the
                          sub-agent card, right under the header. Cleared when
                          the matching tool ends or the sub-agent terminates. */}
                      {liveIntent && (
                        <p className="mb-1.5 truncate text-[11px] leading-5">
                          <span className="chat-thinking-shimmer" title={liveIntent}>{liveIntent}</span>
                        </p>
                      )}

                      {/* v1.12: collapsible task prompt — full text the parent
                          handed to this sub-agent (≤800 runes). Helps users
                          understand what L3 is actually doing. */}
                      {taskPrompt && (
                        <TaskPromptExpander prompt={taskPrompt} />
                      )}

                      {visibleItems.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">{t('chat.status.waitingResults')}</p>
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
                          if (item.kind === 'question') {
                            return (
                              <AskUserQuestionCard
                                key={item.request.callId || `sub-question-${i}-${agentIdx}-${itemIndex}`}
                                request={item.request}
                                result={item.result}
                                onRespondAskQuestion={onRespondAskQuestion}
                              />
                            )
                          }
                          if (item.kind === 'step_decision') {
                            return (
                              <StepDecisionCard
                                key={item.request.callId || `sub-decision-${i}-${agentIdx}-${itemIndex}`}
                                request={item.request}
                                result={item.result}
                                onRespondStepDecision={onRespondStepDecision}
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

        {trailingAttachments.length > 0 && (
          <div className={cn('mb-1.5', isUser ? 'flex justify-end' : 'flex justify-start')}>
            <div className="max-w-[420px]">
              <AttachmentPreviewPanel
                attachments={trailingAttachments}
                removable={false}
                // 点击附件 → 走与 read_file 工具结果一样的 openFilePathPreview，
                // 复用 FilePreviewDrawer 内置的图片 / docx / pdf / md / 文本
                // 分支，无需额外分发逻辑。用户消息里的图片已经在文字之前用
                // FilePreviewModal 单独渲染，所以这里只剩非图片附件。
                onPreview={(attachment) => void openFilePathPreview(attachment.path)}
              />
            </div>
          </div>
        )}

        {errorNotice && (
          <div className="mb-1.5">
            {renderErrorNoticeCard(errorNotice)}
          </div>
        )}

        {/* 呼吸闪烁小点已移至会话尾部，与"鎏金"shimmer 文案同行渲染
            (ConversationTimeline 中的 streaming-breathing-dot + chat-thinking-shimmer)。 */}

        {/* 点赞点踩 — AI 回复正文下方常显按钮(流式结束后才出现) */}
        {!isUser && !isSystem && !message.isStreaming && hasRenderableAssistantBody && (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={() => handleRate('up')}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 transition-colors hover:bg-muted",
                rating === 'up' && "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30"
              )}
              aria-label={t('chat.actions.thumbsUp')}
              title={t('chat.actions.thumbsUp')}
            >
              <ThumbsUp size={13} className={rating === 'up' ? "text-green-600 dark:text-green-400" : "text-muted-foreground"} />
            </button>
            <button
              onClick={() => handleRate('down')}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 transition-colors hover:bg-muted",
                rating === 'down' && "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
              )}
              aria-label={t('chat.actions.thumbsDown')}
              title={t('chat.actions.thumbsDown')}
            >
              <ThumbsDown size={13} className={rating === 'down' ? "text-red-600 dark:text-red-400" : "text-muted-foreground"} />
            </button>
          </div>
        )}

        {shouldShowTimestamp && (
          <div className="mt-1 px-1">
            <p className="text-[10px] text-muted-foreground">
              {formatMessageTime(i18n.language, message.timestamp)}
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
  onRespondAskQuestion,
  onRespondStepDecision,
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
      | { kind: 'question'; request: ToolActivity; result?: ToolActivity; ts: number; subagent?: SubagentInfo }
      | { kind: 'step_decision'; request: ToolActivity; result?: ToolActivity; ts: number; subagent?: SubagentInfo }
      | { kind: 'text'; text: string; ts: number; subagent?: SubagentInfo }
    >
    ts: number
  }>
  onOpenFilePreview: (preview: FilePreviewData) => void
  onRespondPermission: (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
  onRespondAskQuestion: RespondAskQuestionHandler
  onRespondStepDecision: RespondStepDecisionHandler
  renderHint: (text: string, key: string, compact?: boolean) => JSX.Element
  renderTextBlock: (text: string, key: string, compact?: boolean) => JSX.Element
}) {
  const { t } = useTranslation()
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
        ? `${t('chat.status.executingPrefix')} ${getToolDisplayName(t, latestTool.call.name)}`
        : latestTool.result?.isError
          ? `${getToolDisplayName(t, latestTool.call.name)} ${t('chat.status.failedSuffix')}`
          : `${getToolDisplayName(t, latestTool.call.name)} ${t('chat.status.doneSuffix')}`
    }

    const latestHint = [...visibleItems].reverse().find((item) => item.kind === 'hint')
    if (latestHint && latestHint.kind === 'hint') {
      return summarizeInlineText(latestHint.data.content, 104)
    }

    return t('chat.status.supplementingProcess')
  }

  const getStatusLabel = (status: string) => {
    const visualStatus = getSubagentVisualStatus(status)
    return visualStatus === 'failed' ? t('chat.asyncAgentStatus.failed') : visualStatus === 'running' ? t('chat.asyncAgentStatus.running') : t('chat.asyncAgentStatus.completed')
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
          <span className="team-stack-card-meta">{t('chat.status.processRecords', { n: getVisibleItems(agent).length })}</span>
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
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('chat.team.title')}</p>
          <span className="rounded-full border border-border bg-background/75 px-2 py-0.5 text-[10px] text-muted-foreground">
            {t('chat.status.subagentUnit', { count: agents.length })}
          </span>
        </div>

        <div className="team-stack-shell">
          {hasMultipleAgents && (
            <button
              type="button"
              onClick={() => moveToIndex(wrapIndex(activeIndex - 1), 'prev')}
              className="team-stack-nav team-stack-nav-left"
              aria-label={t('chat.status.prevSubagentAria')}
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
                    <AvatarLightbox
                      nested
                      src={resolveTeamAvatar(latestActiveTask.label)}
                      alt={latestActiveTask.label}
                      triggerClassName="block h-full w-full rounded-[0.85rem]"
                      imgClassName="h-full w-full rounded-[0.85rem] object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="team-stack-card-name">{latestActiveTask.label}</span>
                    <p className="team-stack-agent-copy">{t('chat.status.processRecords', { n: activeVisibleItems.length || activeAgent.items.length })}</p>
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
                <span>{t('chat.status.subagentCollab')}</span>
                <span className="inline-flex items-center gap-2">
                  <span>{t('chat.team.details')}</span>
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
              aria-label={t('chat.status.nextSubagentAria')}
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {hasMultipleAgents && (
          <div className="team-stack-dots" aria-label={t('chat.status.subagentSwitchProgress')}>
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
                aria-label={t('chat.team.switchToAria', { name: getLatestTask(agent).label })}
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
                aria-label={t('chat.status.closeSubagentDetails')}
              >
                <X size={15} />
              </button>
            </div>

            <div className="team-stack-dialog-grid">
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">{t('chat.team.status')}</p>
                <div className={getStatusClasses(latestActiveTask.status)}>{getStatusLabel(latestActiveTask.status)}</div>
                <p className="team-stack-dialog-copy">{getAgentSummary(activeAgent)}</p>
              </div>
              <div className="team-stack-dialog-panel">
                <p className="team-stack-dialog-label">{t('chat.status.processRecords', { n: '' }).replace('{{n}}', '').trim()}</p>
                <p className="team-stack-dialog-stat">{activeVisibleItems.length || activeAgent.items.length}</p>
                <p className="team-stack-dialog-copy">{t('chat.status.subagentDetails')}</p>
              </div>
            </div>

            <div className="team-stack-dialog-panel team-stack-dialog-panel-scroll">
              <p className="team-stack-dialog-label">{t('chat.status.detailContent')}</p>
              <div className="agent-team-dialog-flow mt-3">
                {activeVisibleItems.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{t('chat.status.waitingResults')}</p>
                ) : (
                  activeVisibleItems.map((item, index) => {
                    const itemKey = item.kind === 'text'
                      ? `team-text-${latestActiveTask.taskId}-${index}`
                      : item.kind === 'hint'
                        ? `team-hint-${latestActiveTask.taskId}-${index}`
                        : item.kind === 'tool'
                          ? `team-tool-${item.call.callId || index}`
                          : item.kind === 'permission'
                            ? `team-perm-${item.request.callId || index}`
                            : item.kind === 'step_decision'
                              ? `team-decision-${item.request.callId || index}`
                              : `team-question-${item.request.callId || index}`
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

                    if (item.kind === 'question') {
                      return (
                        <div key={itemKey} className="subagent-stream-item" data-live={itemIsLive ? 'true' : undefined}>
                          <AskUserQuestionCard
                            request={item.request}
                            result={item.result}
                            onRespondAskQuestion={onRespondAskQuestion}
                          />
                        </div>
                      )
                    }

                    if (item.kind === 'step_decision') {
                      return (
                        <div key={itemKey} className="subagent-stream-item" data-live={itemIsLive ? 'true' : undefined}>
                          <StepDecisionCard
                            request={item.request}
                            result={item.result}
                            onRespondStepDecision={onRespondStepDecision}
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

function getPhasePresentation(
  phase: ToolActivity['phase'],
  isRunning: boolean,
): { icon: 'pen' | 'clock' | 'shield' | 'loader', colorClass: string, animateClass: string } | null {
  if (!isRunning) return null
  switch (phase) {
    case 'planning':
    case 'planning_args':
      return { icon: 'pen', colorClass: 'text-blue-500', animateClass: 'animate-pulse' }
    case 'queued':
      return { icon: 'clock', colorClass: 'text-amber-500', animateClass: 'animate-pulse' }
    case 'permission_wait':
      return { icon: 'shield', colorClass: 'text-orange-500', animateClass: 'animate-pulse' }
    case 'executing':
    default:
      return { icon: 'loader', colorClass: 'text-yellow-500', animateClass: 'animate-spin' }
  }
}

function getPhasePillLabel(phase: ToolActivity['phase']): string {
  switch (phase) {
    case 'planning':
    case 'planning_args': return '构思中'
    case 'queued': return '等待执行'
    case 'permission_wait': return '等待授权'
    case 'executing': return '执行中'
    default: return '运行中'
  }
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
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const filePreview = extractFilePreviewData(call, result)
  const generatedImages = extractGeneratedImagesFromMetadata(result?.metadata)
  // Tool name always comes from card.add (i.e. `call.name`) — never from
  // close.inner.name which is empty by v2 protocol.
  const toolName = getToolDisplayName(t, call.name)
  const durationLabel = formatDurationMs(result?.durationMs)
  const renderHintLabel = result?.renderHint ? getToolRenderHintLabel(t, result.renderHint) : ''
  const isSearchResult = result?.renderHint === 'search'
  const searchUrls = isSearchResult ? extractSearchResultUrls(result?.metadata) : []
  const searchQuery = isSearchResult ? extractSearchQuery(result?.metadata) : undefined
  const searchResultCount = isSearchResult ? extractSearchResultCount(result?.metadata) : undefined
  const openWebPreview = useOpenWebPreview()

  // v2 §6.5 / §12 — terminal status routing. `failed` is the only hard
  // error; `cancelled` and `skipped` get a neutral gray treatment, NOT
  // the red error UI. Default to ok when the engine omitted status.
  const status: 'ok' | 'failed' | 'cancelled' | 'skipped' = result
    ? (result.status === 'failed' || result.status === 'cancelled' || result.status === 'skipped'
        ? result.status
        : (result.isError ? 'failed' : 'ok'))
    : 'ok'
  const errorPresentation = status === 'failed' ? getToolErrorPresentation(t, result?.errorType) : null
  const errorColorClasses = errorPresentation ? getToolErrorColorClasses(errorPresentation.color) : null

  // Build a "查看详情" payload — developer-only diagnostics (raw
  // `error.message`, `error.code`, retry hint, recovery hint, full
  // metadata) that lives behind the expand button. user_message stays
  // on the main card body via `getToolResultSummary`.
  const showRetryHint = status === 'failed' && (result?.retryable || (result?.retryAfterMs && result.retryAfterMs > 0))
  const retryHintText = result?.retryAfterMs && result.retryAfterMs > 0
    ? t('chat.status.retryIn', { n: Math.max(1, Math.round(result.retryAfterMs / 1000)) })
    : t('chat.status.autoRetrying')
  // recovery.action is reserved — render defensively. Today the engine
  // doesn't populate it, but if/when it does the UI will surface a small
  // hint without requiring further code changes.
  const recoveryHintText = (() => {
    if (!result?.recovery || !result.recovery.action) return ''
    switch (result.recovery.action) {
      case 'retry':
        return t('chat.status.retrying')
      case 'fallback':
        return result.recovery.next_card_id ? t('chat.status.fallbackToNext') : t('chat.status.fallbackUsed')
      case 'abort':
        return t('chat.status.abortedAction')
      default:
        return ''
    }
  })()

  // Search render hints render through the dedicated URL list; for every
  // other render hint we surface the raw metadata blob as a JSON pre.
  // Empty metadata is "正确为空" — don't render a placeholder block for it.
  // The `errorInfo` shim we tuck inside metadata for DB round-trip is
  // surfaced separately under "诊断信息", so strip it from the generic
  // metadata blob to avoid double-rendering.
  const metadataForDisplay = (() => {
    if (!result?.metadata) return undefined
    if (isSearchResult) return undefined
    const { errorInfo: _drop, images: _dropImages, ...rest } = result.metadata as Record<string, unknown>
    return Object.keys(rest).length > 0 ? rest : undefined
  })()
  const metadataText = metadataForDisplay ? JSON.stringify(metadataForDisplay, null, 2) : ''

  // Status pill — drives icon + label + colors. For `failed` we use the
  // categorized errorPresentation; for `cancelled` / `skipped` we use a
  // muted neutral; for `ok` and running we keep the legacy treatment.
  const statusPillLabel = isRunning
    ? getPhasePillLabel(call.phase)
    : status === 'failed'
      ? errorPresentation!.label
      : status === 'cancelled'
        ? t('chat.asyncAgentStatus.aborted')
        : status === 'skipped'
          ? t('chat.asyncAgentStatus.aborted') // 暂时用 aborted
          : result ? t('chat.asyncAgentStatus.completed') : ''
  const statusPillTextClass = isRunning
    ? 'text-yellow-500'
    : status === 'failed'
      ? errorColorClasses!.text
      : status === 'cancelled' || status === 'skipped'
        ? 'text-muted-foreground'
        : result ? 'text-green-600' : 'text-muted-foreground'

  return (
    <div className="mb-1.5">
      <div className={cn(
        'overflow-hidden rounded-xl border bg-card shadow-sm',
        status === 'failed' ? errorColorClasses!.badge : 'border-border'
      )}>
        <div className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/40">
          <div className="flex h-5 flex-shrink-0 items-center justify-center" aria-hidden="true">
            {isRunning ? (() => {
              const pres = getPhasePresentation(call.phase, true)
              if (!pres) return <Loader2 size={12} className="animate-spin text-yellow-500" />
              const iconCls = cn(pres.colorClass, pres.animateClass)
              switch (pres.icon) {
                case 'pen': return <PenLine size={12} className={iconCls} />
                case 'clock': return <Clock size={12} className={iconCls} />
                case 'shield': return <ShieldQuestion size={12} className={iconCls} />
                case 'loader':
                default: return <Loader2 size={12} className={iconCls} />
              }
            })() : status === 'failed' ? (
              <span className="text-[12px] leading-none" title={errorPresentation!.label}>{errorPresentation!.icon}</span>
            ) : status === 'cancelled' || status === 'skipped' ? (
              <span className="text-[12px] leading-none">{status === 'cancelled' ? '✋' : '⏭'}</span>
            ) : result ? (
              <Check size={12} className="text-green-500" />
            ) : (
              <Wrench size={12} className="text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-5 items-center gap-2">
              <span className="flex-1 truncate text-xs font-medium leading-5 text-foreground">{toolName}</span>
              {/* v2 §12 — categorized failure badge next to the tool name.
                  Only shown when status === 'failed'; never display the
                  raw enum string. Unknown types fall back to internal. */}
              {status === 'failed' && (
                <span className={cn(
                  'inline-flex h-5 flex-shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] leading-none',
                  errorColorClasses!.badge
                )}>
                  <span aria-hidden="true">{errorPresentation!.icon}</span>
                  <span>{errorPresentation!.label}</span>
                </span>
              )}
              {renderHintLabel && result && status !== 'failed' && (
                <span className="inline-flex h-5 flex-shrink-0 items-center rounded-full border border-border bg-background px-2 text-[10px] leading-none text-muted-foreground">
                  {renderHintLabel}
                </span>
              )}
              {durationLabel && result && (
                <span className="inline-flex h-5 flex-shrink-0 items-center rounded-full border border-border bg-background px-2 text-[10px] leading-none text-muted-foreground">
                  {durationLabel}
                </span>
              )}
              <span className={cn(
                'inline-flex h-5 flex-shrink-0 items-center text-[10px] leading-none',
                statusPillTextClass
              )}>
                {statusPillLabel}
              </span>
            </div>
            {/* v1.12: agent.intent — pre-tool progress sentence rendered as a
                shimmer header line. Shimmer animation only while running; once
                the tool finishes we keep the text in plain muted color so the
                user retains context but the activity stops drawing attention.
                For the `Task` tool this is the parent agent's own intent
                (e.g. "派研究子代理调研…"), distinct from the sub-agent intents
                rendered inside the specialist panel. */}
            {call.intent && (
              <p className="mt-1 truncate text-[11px] leading-5">
                <span
                  className={cn(isRunning ? 'chat-thinking-shimmer' : 'text-muted-foreground')}
                  title={call.intent}
                >
                  {call.intent}
                </span>
              </p>
            )}
            <p className={cn(
              'mt-1 text-[11px] leading-5',
              status === 'failed' ? errorColorClasses!.text : 'text-muted-foreground'
            )}>
              {isRunning
                  ? (call.phaseHint || t('chat.toolResult.executing'))
                  : generatedImages.length > 0
                    ? t('chat.toolResult.imageGenerated', { n: generatedImages.length })
                    : getToolResultSummary(t, call, result, filePreview)}
            </p>

            {/* v2 §12 — retry / recovery hints. Display-only; no control
                buttons. Engine is responsible for the actual retry; this
                is purely a status mirror so the user knows the system
                isn't stuck. */}
            {showRetryHint && (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] leading-5 text-muted-foreground">
                <Loader2 size={10} className="animate-spin" />
                <span>{retryHintText}</span>
              </p>
            )}
            {recoveryHintText && (
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {recoveryHintText}
              </p>
            )}

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
                  {filePreview.operation === 'read_file' ? t('chat.toolResult.fileAssociated', { name: '' }).replace('Associated file', '').trim() : t('chat.toolResult.fileInvolved', { name: '' }).replace('Involves file', '').trim()}
                </span>
              </button>
            )}

            {generatedImages.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {generatedImages.map((image, idx) => {
                  const subtitle = [image.model, image.size].filter(Boolean).join(' · ')
                  return (
                    <button
                      key={`${image.path}-${idx}`}
                      type="button"
                      onClick={() => onOpenFilePreview({
                        path: image.path,
                        fileName: image.fileName,
                        operation: 'read_file',
                        content: '',
                        isBinary: true,
                      })}
                      className="group overflow-hidden rounded-xl border border-border bg-accent/45 text-left transition-colors hover:border-primary/60 hover:bg-accent"
                      title={image.prompt || image.fileName}
                    >
                      <div className="aspect-square w-full overflow-hidden bg-muted">
                        <img
                          src={localFileUrl(image.path)}
                          alt={image.prompt || image.fileName}
                          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                      </div>
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <ImageIcon size={12} className="flex-shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium text-foreground">{image.fileName}</div>
                          {subtitle && <div className="truncate text-[10px] text-muted-foreground">{subtitle}</div>}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
            aria-label={expanded ? t('chat.composer.stopAria') : t('chat.task.viewDetails')}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        <div id={contentId} hidden={!expanded} className="space-y-2 border-t border-border px-3 py-2">
          {call.name && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">{t('chat.tool.nameLabel')}</p>
              <pre className="rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{call.name}</pre>
            </div>
          )}
          {call.content && call.content !== '{}' && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">{t('chat.tool.inputLabel')}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{call.content}</pre>
            </div>
          )}
          {result?.filePath && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">{t('chat.tool.associatedFiles')}</p>
              <pre className="rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{result.filePath}</pre>
            </div>
          )}
          {isSearchResult && searchUrls.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[10px] text-muted-foreground">{t('chat.tool.searchResult')}</p>
                {searchQuery && (
                  <span className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full border border-border bg-background px-1.5 text-[10px] leading-4 text-muted-foreground" title={searchQuery}>
                    <Search size={10} className="flex-shrink-0" />
                    <span className="truncate">{searchQuery}</span>
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {t('chat.tool.totalRecords', { n: searchResultCount ?? searchUrls.length })}
                </span>
              </div>
              {/* Cap the visible list to roughly 5 rows; everything past
                  that is reachable via vertical scroll. Each row is
                  ~40px (py-1.5 + two text lines), so max-h-[208px] +
                  space-y-1 gives a clean 5-row window with one row of
                  scroll affordance. `pr-1` reserves space for the
                  scrollbar so the right edge of items doesn't shift
                  when scrolling becomes active. */}
              <ul className="max-h-[208px] space-y-1 overflow-y-auto pr-1">
                {searchUrls.map((entry, idx) => {
                  const host = safeUrlHostname(entry.url)
                  const label = entry.title || host
                  return (
                    <li key={`${entry.url}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => openWebPreview?.({ url: entry.url, title: entry.title, query: searchQuery })}
                        className="group flex w-full items-start gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
                        title={entry.url}
                      >
                        <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                          <FaviconImage url={entry.url} size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-foreground group-hover:text-primary">
                            {label}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {host}
                          </span>
                        </span>
                        <ExternalLink size={11} className="mt-1 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {/* v2 §12 — developer-facing diagnostics. Only rendered when
              there's a real failure with structured ErrorInfo. Keeps
              error.message ("unknown tool: WebFetch" / etc.) AND
              error.code out of the main UI; only here on demand. */}
          {status === 'failed' && (result?.devMessage || result?.errorCode || result?.errorType) && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">{t('chat.tool.diagnostics')}</p>
              <div className="space-y-1 rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">
                {result?.errorType && (
                  <div>
                    <span className="text-muted-foreground">type:</span> {result.errorType}
                  </div>
                )}
                {result?.errorCode && (
                  <div>
                    <span className="text-muted-foreground">code:</span> {result.errorCode}
                  </div>
                )}
                {result?.devMessage && (
                  <div className="whitespace-pre-wrap break-words">
                    <span className="text-muted-foreground">message:</span> {result.devMessage}
                  </div>
                )}
                {typeof result?.retryable === 'boolean' && (
                  <div>
                    <span className="text-muted-foreground">retryable:</span> {String(result.retryable)}
                  </div>
                )}
                {typeof result?.retryAfterMs === 'number' && (
                  <div>
                    <span className="text-muted-foreground">retry_after_ms:</span> {result.retryAfterMs}
                  </div>
                )}
                {result?.recovery?.action && (
                  <div>
                    <span className="text-muted-foreground">recovery:</span> {result.recovery.action}
                    {result.recovery.next_card_id ? ` → ${result.recovery.next_card_id}` : ''}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Generic tool output renderer — surfaces result.content when no
              other specialized view (filePreview, search URL list,
              artifact card) already consumed it. This is the catch-all
              for tools like SearchSkill / LoadSkill / ListLoadedSkills
              whose value lives entirely in the JSON output string. We
              intentionally skip:
                - failed status (the user_message + diagnostics block
                  already show the error)
                - read/write_file (FilePreviewDrawer is the proper view)
                - search render hint (URL list above is richer)
                - artifact render hint (ArtifactWrite emits its own card)
              The pretty-print attempt JSON-parses & re-stringifies so
              SearchSkill's `{"skills":[...]}` blob reads naturally; on
              parse failure we fall back to the raw string. */}
          {(() => {
            if (!result?.content || status !== 'ok') return null
            if (filePreview) return null
            if (isSearchResult) return null
            if (result.renderHint === 'artifact' || result.renderHint === 'artifact_view') return null
            const raw = result.content
            let pretty = raw
            try {
              const parsed = JSON.parse(raw)
              if (parsed && typeof parsed === 'object') {
                pretty = JSON.stringify(parsed, null, 2)
              }
            } catch {
              /* not JSON — render verbatim */
            }
            return (
              <div>
                <p className="mb-1 text-[10px] text-muted-foreground">输出</p>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{pretty}</pre>
              </div>
            )
          })()}
          {metadataText && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">Metadata</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2 text-[11px] font-mono text-foreground/80">{metadataText}</pre>
            </div>
          )}
          {isRunning && !result && (
            <div className="flex items-center gap-1.5 py-0.5">
              <Loader2 size={10} className="animate-spin text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">{t('chat.tool.waitingReturn')}</span>
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
  const { t } = useTranslation()
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
        { label: t('chat.permissions.allowOnce'), scope: 'once' as const, allow: true },
        { label: t('chat.permissions.alwaysAllow'), scope: 'session' as const, allow: true },
        { label: t('chat.permissions.deny'), scope: 'once' as const, allow: false },
      ]

  const resultLabel = resultData
    ? resultData.approved
      ? resultData.scope === 'session' ? t('chat.permissions.sessionAllowed') : t('chat.permissions.onceAllowed')
      : t('chat.permissions.denied')
    : t('chat.permissions.waiting')

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
                {t('chat.permissions.needsConfirmation')}
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
                  {requestData?.message || t('chat.permissions.defaultMessage')}
                </p>
              )}
              {!requestData?.command && requestData?.description && (
                <p className="mt-1 line-clamp-2 break-all text-[10px] text-muted-foreground">
                  {requestData.description}
                </p>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{requestData?.isReadOnly ? t('chat.permissions.readOnly') : t('chat.permissions.modifiesEnv')}</span>
              {request.name && <span>{getToolDisplayName(t, request.name)}</span>}
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
                    {submitting === option.label ? t('chat.permissions.submitting') : getPermissionOptionLabel(t, option.label)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
            aria-label={expanded ? t('chat.permissions.collapseDetails') : t('chat.permissions.expandDetails')}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            {expanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
          </button>
        </div>

        <div id={contentId} hidden={!expanded} className="space-y-2 border-t border-amber-200/70 px-3 py-2 dark:border-amber-900/30">
          {requestData?.toolInput && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">{t('chat.permissions.detailsLabel')}</p>
              <pre className="max-h-40 overflow-x-auto rounded-lg bg-background/80 p-2 text-[11px] font-mono text-foreground/80">
                {requestData.toolInput}
              </pre>
            </div>
          )}
          {resultData?.message && (
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">{t('chat.permissions.resultLabel')}</p>
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

function AskUserQuestionCard({
  request,
  result,
  onRespondAskQuestion,
}: {
  request: ToolActivity
  result?: ToolActivity
  onRespondAskQuestion: RespondAskQuestionHandler
}) {
  const { t } = useTranslation()
  const requestData = parseAskQuestionRequestData(request.content)
  const resultData = result ? parseAskQuestionResultData(result.content) : null
  const isResolved = !!resultData
  const allowCustom = requestData?.allowCustom !== false
  const multi = requestData?.multi === true
  const options = requestData?.options || []
  const hasOptions = options.length > 0

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customText, setCustomText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const hasCustomText = customText.trim().length > 0

  const toggleOption = (label: string) => {
    // Mutual exclusion: picking an option clears any in-progress custom reply.
    if (hasCustomText) setCustomText('')
    setSelected((prev) => {
      const next = new Set(prev)
      if (multi) {
        if (next.has(label)) next.delete(label)
        else next.add(label)
      } else {
        const wasSelected = next.has(label)
        next.clear()
        if (!wasSelected) next.add(label)
      }
      return next
    })
  }

  const handleCustomChange = (value: string) => {
    // Mutual exclusion: typing a custom reply clears any picked options.
    if (value.trim().length > 0 && selected.size > 0) {
      setSelected(new Set())
    }
    setCustomText(value)
  }

  const buildOutput = (): string => {
    const picked = options.filter((option) => selected.has(option.label)).map((option) => option.label)
    const trimmedCustom = customText.trim()
    if (trimmedCustom) picked.push(trimmedCustom)
    return picked.join('\n')
  }

  const canSubmit = !isResolved && !submitting && (selected.size > 0 || (allowCustom && customText.trim().length > 0))

  const handleSubmit = async () => {
    if (!canSubmit || !request.callId) return
    const output = buildOutput()
    if (!output) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await onRespondAskQuestion(request.callId, 'success', output)
      if (!result.ok) {
        setSubmitError(result.error
          ? t('chat.ask.submitFailedWithReason', { reason: result.error })
          : t('chat.ask.submitFailed'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (isResolved || submitting || !request.callId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await onRespondAskQuestion(request.callId, 'cancelled', undefined, 'User dismissed the question dialog')
      if (!result.ok) {
        setSubmitError(result.error
          ? t('chat.ask.cancelFailedWithReason', { reason: result.error })
          : t('chat.ask.cancelFailed'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  const statusLabel = isResolved
    ? resultData?.status === 'success'
      ? t('chat.ask.responded')
      : t('chat.ask.cancelledStatus')
    : t('chat.ask.waiting')

  return (
    <div className="mb-1.5">
      <div className="overflow-hidden rounded-xl border border-blue-200/80 bg-blue-50/70 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20">
        <div className="flex items-start gap-2 px-3 py-2">
          <HelpCircle
            size={14}
            className={cn(
              'mt-0.5 flex-shrink-0',
              isResolved
                ? resultData?.status === 'success'
                  ? 'text-green-600'
                  : 'text-muted-foreground'
                : 'text-blue-600'
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-xs font-medium text-foreground">{t('chat.ask.title')}</span>
              <span className={cn(
                'flex-shrink-0 text-[10px]',
                isResolved
                  ? resultData?.status === 'success' ? 'text-green-600' : 'text-muted-foreground'
                  : 'text-blue-700 dark:text-blue-300'
              )}>
                {statusLabel}
              </span>
            </div>

            <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/90">
              {requestData?.question || t('chat.ask.defaultQuestion')}
            </p>

            {!isResolved && (
              <>
                {hasOptions && (
                  <div className="mt-2 flex flex-col gap-2">
                    {options.map((option) => {
                      const isSelected = selected.has(option.label)
                      const optionDisabled = submitting || hasCustomText
                      return (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => toggleOption(option.label)}
                          disabled={optionDisabled}
                          title={option.description}
                          aria-pressed={isSelected}
                          className={cn(
                            'min-h-9 w-full rounded-lg border px-2.5 py-1 text-left text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                            isSelected
                              ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                              : 'border-border bg-background hover:bg-muted'
                          )}
                        >
                          <span className="block">{option.label}</span>
                          {option.description && (
                            <span className={cn(
                              'mt-0.5 block text-[10px]',
                              isSelected ? 'text-blue-100' : 'text-muted-foreground'
                            )}>
                              {option.description}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {allowCustom && (
                  <div className="mt-2">
                    <textarea
                      value={customText}
                      onChange={(event) => handleCustomChange(event.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={submitting || selected.size > 0}
                      rows={2}
                      placeholder={hasOptions ? t('chat.ask.customPlaceholder') : t('chat.ask.placeholder')}
                      className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                )}

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCancel()}
                    disabled={submitting}
                    className="min-h-9 w-full rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('chat.ask.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                    className="min-h-9 w-full rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? t('chat.ask.sending') : t('chat.ask.send')}
                  </button>
                </div>

                {submitError && (
                  <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                    {submitError}
                  </div>
                )}
              </>
            )}

            {isResolved && resultData?.status === 'success' && resultData.output && (
              <div className="mt-2 rounded-lg border border-blue-200/70 bg-white/70 px-2.5 py-1.5 dark:border-blue-900/30 dark:bg-background/80">
                <p className="text-[10px] text-muted-foreground">{t('chat.ask.yourReply')}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-foreground/90">
                  {resultData.output}
                </p>
              </div>
            )}

            {isResolved && resultData?.status === 'cancelled' && (
              <p className="mt-2 text-[11px] text-muted-foreground">{t('chat.ask.cancelled')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * v0.5.0 §7.1 kind=step_decision — failure decision gate.
 *
 * Shown when Scheduler exhausts its per-step retry budget or PlanCoordinator
 * exhausts its re-plan budget; the engine has stopped trying and asks the
 * user to pick:
 *   • 继续  — accept the failure and let the plan move on (`continue`)
 *   • 重试  — try the same step / re-plan again (`retry`, only when the
 *           server marks `allow_retry=true`)
 *   • 取消  — abort the plan (`cancel`)
 *
 * Optional note is forwarded as `payload.note` and ends up in the engine's
 * fallback summary so the next agent turn can reference it.
 */
function StepDecisionCard({
  request,
  result,
  onRespondStepDecision,
}: {
  request: ToolActivity
  result?: ToolActivity
  onRespondStepDecision: RespondStepDecisionHandler
}) {
  const requestData = parseStepDecisionRequestData(request.content)
  const resultData = result ? parseStepDecisionResultData(result.content) : null
  const isResolved = !!resultData

  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState<null | 'continue' | 'retry' | 'cancel'>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (decision: 'continue' | 'retry' | 'cancel') => {
    if (isResolved || submitting || !request.callId) return
    setSubmitting(decision)
    setSubmitError(null)
    try {
      const res = await onRespondStepDecision(request.callId, decision, note.trim() || undefined)
      if (!res.ok) {
        setSubmitError(res.error
          ? t('chat.decision.submitFailedWithReason', { reason: res.error })
          : t('chat.decision.submitFailed'))
      }
    } finally {
      setSubmitting(null)
    }
  }

  const scope = requestData?.scope || 'step'
  const reason = requestData?.reason || t('chat.decision.noReason')
  const attempts = requestData?.attempts || 0
  const stepDescription = requestData?.stepDescription || ''
  const allowRetry = requestData?.allowRetry === true

  const decisionLabel = (decision: StepDecisionResultData['decision']): string => {
    if (decision === 'continue') return t('chat.decision.continued')
    if (decision === 'retry') return t('chat.decision.retried')
    return t('chat.decision.cancelled')
  }

  const statusLabel = isResolved
    ? decisionLabel(resultData!.decision)
    : t('chat.decision.waiting')

  return (
    <div className="mb-1.5">
      <div className="overflow-hidden rounded-xl border border-amber-300/80 bg-amber-50/70 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-2 px-3 py-2">
          <AlertTriangle
            size={14}
            className={cn(
              'mt-0.5 flex-shrink-0',
              isResolved
                ? resultData?.decision === 'cancel'
                  ? 'text-muted-foreground'
                  : 'text-emerald-600'
                : 'text-amber-600',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-xs font-medium text-foreground">
                {scope === 'plan' ? t('chat.decision.planFailed') : t('chat.decision.stepFailed')}
              </span>
              <span className={cn(
                'flex-shrink-0 text-[10px]',
                isResolved
                  ? resultData?.decision === 'cancel' ? 'text-muted-foreground' : 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300',
              )}>
                {statusLabel}
              </span>
            </div>

            <div className="mt-1 space-y-1 text-[12px] leading-5">
              {scope === 'step' && stepDescription && (
                <p className="text-foreground/90">
                  <span className="font-medium">{t('chat.decision.stepLabelPrefix')}</span>
                  <span className="break-words">{stepDescription}</span>
                </p>
              )}
              <p className="text-foreground/90">
                <span className="font-medium">{t('chat.decision.reasonLabel')}</span>
                <span className="break-words">{reason}</span>
                {attempts > 0 && (
                  <span className="ml-1 text-muted-foreground">{t('chat.decision.attemptsLabel', { n: attempts })}</span>
                )}
              </p>
            </div>

            {!isResolved && (
              <>
                <div className="mt-2">
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    disabled={!!submitting}
                    rows={2}
                    placeholder={t('chat.decision.remarkPlaceholder')}
                    className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSubmit('cancel')}
                    disabled={!!submitting}
                    className="min-h-9 w-full rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting === 'cancel' ? t('chat.decision.sending') : t('chat.decision.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit('retry')}
                    disabled={!!submitting || !allowRetry}
                    title={allowRetry ? undefined : t('chat.decision.retryDisabledHint')}
                    className="min-h-9 w-full rounded-lg border border-amber-400 bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/50"
                  >
                    {submitting === 'retry' ? t('chat.decision.sending') : t('chat.decision.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit('continue')}
                    disabled={!!submitting}
                    className="min-h-9 w-full rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting === 'continue' ? t('chat.decision.sending') : t('chat.decision.continue')}
                  </button>
                </div>

                {submitError && (
                  <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                    {submitError}
                  </div>
                )}
              </>
            )}

            {isResolved && resultData?.note && (
              <div className="mt-2 rounded-lg border border-amber-200/70 bg-white/70 px-2.5 py-1.5 dark:border-amber-900/30 dark:bg-background/80">
                <p className="text-[10px] text-muted-foreground">{t('chat.decision.remarkLabel')}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-foreground/90">
                  {resultData.note}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FilePreviewDrawer({
  preview,
  onClose,
  artifacts,
  onSelectArtifact,
}: {
  preview: FilePreviewData | null
  onClose: () => void
  /**
   * Optional list of session-level artifacts. When supplied AND the user is
   * currently previewing one of them AND there is more than one artifact,
   * a left-side file list is rendered so they can quickly hop between
   * outputs without closing the drawer.
   */
  artifacts?: ArtifactRef[]
  onSelectArtifact?: (artifact: ArtifactRef) => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const [exportNotice, setExportNotice] = useState<{ ok: boolean; text: string } | null>(null)
  // Collapsed by default so the file list never compresses the preview area;
  // user explicitly opens it via the handle on the drawer's left edge.
  const [artifactListOpen, setArtifactListOpen] = useState(false)

  // Match the active preview to one of the artifacts so the sidebar only
  // becomes available while the user is actually browsing artifact outputs
  // (the same drawer is reused for read_file/write_file tool previews where
  // mixing in an unrelated artifact list would be confusing).
  //
  // Matching priority:
  //   1. preview.artifactId — set by openArtifactPreview when the source
  //      is an ArtifactRef. Stable across the placeholder → temp-file
  //      path swap that happens during fetch+read.
  //   2. preview.path — kept for backward compat with any code path that
  //      still calls setFilePreview directly with `path: artifact.uri`.
  const previewArtifactId = preview?.artifactId || ''
  const activeArtifactKey = preview?.path || ''
  const matchedArtifactIndex = useMemo(() => {
    if (!artifacts || artifacts.length === 0) return -1
    if (previewArtifactId) {
      const byId = artifacts.findIndex((a) => a.artifact_id === previewArtifactId)
      if (byId >= 0) return byId
    }
    if (!activeArtifactKey) return -1
    return artifacts.findIndex(
      (a) => a.uri === activeArtifactKey || a.artifact_id === activeArtifactKey,
    )
  }, [artifacts, previewArtifactId, activeArtifactKey])
  const canShowArtifactList = !!artifacts && artifacts.length > 1 && matchedArtifactIndex >= 0 && !!onSelectArtifact

  // Auto-collapse the panel when navigating to a non-artifact preview so it
  // can't linger open over an unrelated read_file/write_file file.
  useEffect(() => {
    if (!canShowArtifactList) setArtifactListOpen(false)
  }, [canShowArtifactList])

  useEffect(() => {
    if (!preview) return
    closeButtonRef.current?.focus()
    // Reset transient feedback when a different file opens.
    setCopied(false)
    setExportNotice(null)
  }, [preview])

  // Auto-clear feedback after a short delay so the button reverts to default.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!exportNotice) return
    const timer = setTimeout(() => setExportNotice(null), 2500)
    return () => clearTimeout(timer)
  }, [exportNotice])

  const handleCopy = async () => {
    if (!preview?.content) return
    try {
      await navigator.clipboard.writeText(preview.content)
      setCopied(true)
    } catch (error) {
      console.error('Failed to copy file content:', error)
      setExportNotice({ ok: false, text: t('chat.actions.copyFailed') })
    }
  }

  const handleExport = async () => {
    if (!preview) return
    // For binary files we MUST copy the original bytes from disk; sending
    // the (empty / placeholder) `content` would write a UTF-8 text file
    // that just looks like the docx/pdf/etc. extension but contains
    // garbage.
    const result = await window.files.save({
      defaultFileName: preview.fileName || 'untitled.txt',
      content: preview.content || '',
      sourcePath: preview.isBinary ? preview.path : undefined,
    })
    if (result.ok && result.path) {
      setExportNotice({ ok: true, text: t('chat.actions.exportedTo', { path: result.path }) })
    } else if (!result.cancelled) {
      setExportNotice({ ok: false, text: result.error ? t('chat.actions.exportFailedWithReason', { reason: result.error }) : t('chat.actions.exportFailed') })
    }
  }

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
  const isAudio = /^(mp3|wav|m4a|aac|flac|ogg)$/.test(ext)
  const isVideo = /^(mp4|mov|avi|mkv|webm)$/.test(ext)
  const isMarkdown = ext === 'md' || ext === 'mdx'

  return createPortal(
    <div className="fixed inset-0 z-[200] flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-in group: the handle, the artifact-list nav, and the main
          drawer aside are wrapped together so they enter as a SINGLE
          right-to-left unit. Previously only the aside animated, while the
          handle + nav rendered at their final positions instantly — that
          produced the "two-layer" visual disconnect (静态文件按钮已就位、
          后方抽屉再滑入). With one shared wrapper the entire group slides
          together and reads as one cohesive panel.
          • `relative` so absolutely-positioned children (handle / nav)
            anchor to this wrapper.
          • Full width (`w-full h-full`) so child `right-[…]` offsets stay
            relative to the viewport edge, identical to the old layout.
          • Wrapper-level animation translateX(100%) shifts ALL children by
            one viewport width — drawer, nav and handle slide in lockstep. */}
      <div className="drawer-slide-in-from-right pointer-events-none relative flex h-full w-full">

      {/* Collapsible artifact list. Pops out to the LEFT of the drawer
          (positioned absolutely, anchored against the drawer's right edge)
          so it never steals horizontal space from the preview itself. The
          handle on the drawer's left edge toggles it open/closed. */}
      {canShowArtifactList && artifacts && (
        <>
          <button
            type="button"
            onClick={() => setArtifactListOpen((v) => !v)}
            aria-expanded={artifactListOpen}
            aria-controls={`${titleId}-artifact-list`}
            title={artifactListOpen ? t('chat.actions.collapseArtifacts') : t('chat.actions.expandArtifacts')}
            className={cn(
              // `pointer-events-auto` re-enables interaction inside the
              // slide-in wrapper (which is pointer-events-none so the empty
              // area to the left of the drawer still closes on click).
              'pointer-events-auto absolute top-4 z-[210] inline-flex h-9 items-center gap-1 rounded-l-lg border border-r-0 border-border bg-card px-2 text-[11px] font-medium text-foreground shadow-md transition-[right] duration-200 ease-out hover:bg-muted',
              // Open → handle sits on the panel's left edge.
              // Closed → handle sits on the drawer's left edge.
              artifactListOpen
                ? 'right-[calc(min(48rem,100vw)+15rem)]'
                : 'right-[min(48rem,100vw)]',
            )}
          >
            <FolderOpen size={13} className="text-primary" />
            <span className="hidden sm:inline">{t('chat.file.label')}</span>
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
              {artifacts.length}
            </span>
            {artifactListOpen ? (
              <ChevronRight size={13} className="text-muted-foreground" />
            ) : (
              <ChevronLeft size={13} className="text-muted-foreground" />
            )}
          </button>

          <nav
            id={`${titleId}-artifact-list`}
            aria-label={t('chat.file.artifacts')}
            aria-hidden={!artifactListOpen}
            className={cn(
              // No explicit z-index → relies on document order: this <nav>
              // appears BEFORE <aside> in JSX, so the drawer naturally
              // paints over any portion of the panel that overlaps it.
              // Without that we'd either block the preview (panel on top)
              // or have to slide out the wrong direction.
              'absolute inset-y-0 flex w-60 flex-col border-l border-r border-border bg-card shadow-xl transition-transform duration-200 ease-out',
              // 48rem === max-w-3xl === drawer width. Anchor the panel's
              // RIGHT edge to the drawer's left edge.
              'right-[min(48rem,100vw)]',
              // Open → at natural position, fully visible to the LEFT of
              // the drawer. Closed → translate RIGHT by its own width so
              // it sits inside the drawer area, hidden behind the aside.
              // The transition then reads as "drawer 边 → 左侧弹出".
              // `pointer-events-auto` re-enables interaction inside the
              // slide-in wrapper (parent is `pointer-events-none`).
              artifactListOpen
                ? 'pointer-events-auto translate-x-0'
                : 'pointer-events-none translate-x-full',
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-[11px] font-semibold tracking-wide text-foreground">{t('chat.file.artifacts')}</span>
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                {artifacts.length}
              </span>
            </div>
            <ul className="flex-1 overflow-y-auto py-1.5">
              {artifacts.map((artifact, idx) => {
                const isActive = idx === matchedArtifactIndex
                const title = artifact.name || artifact.artifact_id
                const subtitle = artifact.description || artifact.mime_type || artifact.type || ''
                const sizeLabel = formatArtifactSize(artifact.size_bytes)
                return (
                  <li key={artifact.artifact_id}>
                    <button
                      type="button"
                      onClick={() => onSelectArtifact?.(artifact)}
                      className={cn(
                        'group flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                        isActive
                          ? 'bg-primary/10 text-foreground'
                          : 'text-foreground/80 hover:bg-muted/60',
                      )}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <FileText
                        size={13}
                        className={cn(
                          'mt-0.5 flex-shrink-0',
                          isActive ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-[12px] font-medium leading-5',
                            isActive ? 'text-primary' : 'text-foreground',
                          )}
                          title={title}
                        >
                          {title}
                        </div>
                        {(subtitle || sizeLabel) && (
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            {subtitle && <span className="truncate" title={subtitle}>{subtitle}</span>}
                            {sizeLabel && (
                              <span className="rounded bg-muted px-1 py-px font-mono text-[9.5px]">
                                {sizeLabel}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        </>
      )}

      <aside
        ref={dialogRef}
        className="pointer-events-auto relative ml-auto flex h-full w-full max-w-3xl flex-col border-l border-border bg-card shadow-2xl"
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
                  {preview.fileName || t('chat.file.preview')}
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
                <p className="mt-1 text-[10px] text-muted-foreground">{t('chat.file.readLimit', { n: preview.limit })}</p>
              )}
              {preview.operation === 'write_file' && (
                <p className="mt-1 text-[10px] text-muted-foreground">{t('chat.file.writeContent')}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!preview.content}
                  className={cn(
                    'relative z-10 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    copied
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-border bg-card text-foreground hover:bg-muted'
                  )}
                  aria-label={t('chat.actions.copy')}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} className="text-muted-foreground" />}
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-sm transition-opacity duration-150 delay-100 group-hover:opacity-100"
                >
                  {t('chat.actions.copy')}
                </span>
              </div>
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={!preview.content && !preview.isBinary}
                  className="relative z-10 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={t('chat.actions.export')}
                >
                  <Download size={15} className="text-muted-foreground" />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-sm transition-opacity duration-150 delay-100 group-hover:opacity-100"
                >
                  {t('chat.actions.export')}
                </span>
              </div>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="relative z-10 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted"
                aria-label={t('chat.actions.closePreview')}
              >
                <X size={15} className="text-muted-foreground" />
              </button>
            </div>
          </div>
          {exportNotice && (
            <div className={cn(
              'mt-3 rounded-lg border px-3 py-1.5 text-[11px]',
              exportNotice.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300'
            )}>
              {exportNotice.text}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-background/65 p-5">
          {/* 渲染优先级（按扩展名而非 content）：
                1. 图片 / 音频 / 视频：原生 <img> / <audio> / <video> 直接拉
                   file:// URL，不依赖主进程把内容读到 `content` 里。
                2. 主进程已抽取的富预览（docx/xlsx/pptx 的 HTML、pdf 的 text）。
                3. Markdown / 代码 / 纯文本 fallback。
                4. 兜底：无 content 时显示二进制占位或空态提示。 */}
          {isImage ? (
            <div className="flex h-full items-center justify-center">
              <img
                src={localFileUrl(preview.path)}
                alt={preview.fileName}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
          ) : isAudio ? (
            <div className="flex h-full items-center justify-center">
              <audio
                src={localFileUrl(preview.path)}
                controls
                className="w-full max-w-xl"
              />
            </div>
          ) : isVideo ? (
            <div className="flex h-full items-center justify-center">
              <video
                src={localFileUrl(preview.path)}
                controls
                className="max-h-full max-w-full rounded-lg"
              />
            </div>
          ) : !preview.content ? (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
              <div>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                  <FileText size={18} className="text-primary" />
                </div>
                {preview.isBinary ? (
                  <>
                    <p className="text-sm font-medium text-foreground">{t('chat.file.binaryTitle')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('chat.file.binaryDesc')}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">{t('chat.file.noContent')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('chat.file.noContentDesc')}</p>
                  </>
                )}
              </div>
            </div>
          ) : preview.previewKind === 'html' ? (
            // 主进程已把 docx / xlsx / pptx 等转成语义化 HTML（mammoth /
            // SheetJS / 自写 pptx 解析器），这里直接渲染。生成的 HTML 只
            // 包含段落、标题、列表、表格、加粗、斜体、链接、内联图等常规
            // 元素，不会注入脚本；用 prose 容器套一层让排版与 Markdown
            // 预览保持一致，并补上 table 边框样式。
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div
                className="prose max-w-none break-words text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-hr:my-4 prose-hr:border-border/70 prose-table:border prose-table:border-border prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-img:rounded-lg dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: preview.content }}
              />
            </div>
          ) : preview.previewKind === 'text' ? (
            // pdf-parse 抽出来的纯文本：分页符已含在文本中，用 pre-wrap
            // 保留原始换行，prose 容器统一字号字色。
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-foreground">
                {preview.content}
              </pre>
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
                    </div>{/* /drawer-slide-in-from-right wrapper */}
                    </div>,
                    document.body
                    )
                    }

                    // ─── Web Preview Drawer ─────────────────────────────────────────────────────
//
// In-app preview of a search-result URL using Electron's <webview> tag (each
// guest renderer is isolated, so untrusted external content cannot reach the
// app's IPC bridge). Mirrors FilePreviewDrawer's right-side aside layout so
// the chat UX feels consistent.

function WebPreviewDrawer({ preview, onClose }: { preview: WebPreviewData | null; onClose: () => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const webviewRef = useRef<HTMLWebViewElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [didFail, setDidFail] = useState<{ code: number; message: string } | null>(null)
  const [currentUrl, setCurrentUrl] = useState<string>('')

  useEffect(() => {
    if (!preview) return
    closeButtonRef.current?.focus()
    setIsLoading(true)
    setDidFail(null)
    setCurrentUrl(preview.url)
  }, [preview])

  // Wire up <webview> lifecycle events. Webview is a custom element so we
  // attach listeners imperatively after the node mounts.
  useEffect(() => {
    if (!preview) return
    const node = webviewRef.current as unknown as (HTMLElement & {
      reload?: () => void
      goBack?: () => void
      canGoBack?: () => boolean
      getURL?: () => string
    }) | null
    if (!node) return

    const onStartLoading = () => {
      setIsLoading(true)
      setDidFail(null)
    }
    const onStopLoading = () => setIsLoading(false)
    const onDidFinishLoad = () => {
      setIsLoading(false)
      try {
        const url = node.getURL?.()
        if (url) setCurrentUrl(url)
      } catch {
        // ignore — webview may not be ready yet
      }
    }
    const onDidFailLoad = (event: Event) => {
      const e = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      // Sub-frame failures are noisy and not actionable — only show the
      // fallback for main-frame failures.
      if (e.isMainFrame === false) return
      setIsLoading(false)
      setDidFail({ code: e.errorCode ?? -1, message: e.errorDescription || t('chat.web.loadFailed') })
    }
    const onNavigate = (event: Event) => {
      const e = event as Event & { url?: string }
      if (e.url) setCurrentUrl(e.url)
    }

    node.addEventListener('did-start-loading', onStartLoading)
    node.addEventListener('did-stop-loading', onStopLoading)
    node.addEventListener('did-finish-load', onDidFinishLoad)
    node.addEventListener('did-fail-load', onDidFailLoad)
    node.addEventListener('did-navigate', onNavigate)
    node.addEventListener('did-navigate-in-page', onNavigate)

    return () => {
      node.removeEventListener('did-start-loading', onStartLoading)
      node.removeEventListener('did-stop-loading', onStopLoading)
      node.removeEventListener('did-finish-load', onDidFinishLoad)
      node.removeEventListener('did-fail-load', onDidFailLoad)
      node.removeEventListener('did-navigate', onNavigate)
      node.removeEventListener('did-navigate-in-page', onNavigate)
    }
  }, [preview])

  useEffect(() => {
    if (!preview) return
    const dialog = dialogRef.current
    if (!dialog) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [preview, onClose])

  const handleReload = () => {
    const node = webviewRef.current as unknown as (HTMLElement & { reload?: () => void }) | null
    node?.reload?.()
  }

  const handleOpenExternal = () => {
    if (!preview) return
    const fn = window.appRuntime?.openExternal
    if (typeof fn === 'function') {
      void Promise.resolve(fn(preview.url)).catch(() => undefined)
    }
  }

  if (!preview) return null

  const host = safeUrlHostname(preview.url)
  const headerLabel = preview.title || host

  return createPortal(
    <div className="fixed inset-0 z-[200] flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        ref={dialogRef}
        className="drawer-slide-in-from-right relative ml-auto flex h-full w-full max-w-3xl flex-col border-l border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="border-b border-border bg-card/95 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-accent shadow-sm">
              <Globe size={18} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 id={titleId} className="truncate text-sm font-semibold text-foreground" title={preview.title}>
                  {headerLabel}
                </h3>
                {preview.query && (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground" title={preview.query}>
                    {t('chat.tool.searchResultPrefix', { query: preview.query })}
                  </span>
                )}
              </div>
              <p className="mt-1 break-all text-[11px] text-muted-foreground">{currentUrl || preview.url}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReload}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted"
                aria-label={t('chat.web.refresh')}
                title={t('chat.web.refresh')}
              >
                <RefreshCw size={14} className="text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={handleOpenExternal}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted"
                aria-label={t('chat.web.openExternal')}
                title={t('chat.web.openExternal')}
              >
                <ExternalLink size={14} className="text-muted-foreground" />
              </button>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted"
                aria-label={t('chat.web.close')}
              >
                <X size={14} className="text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-background">
          {isLoading && !didFail && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-card/85 px-4 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm">
              <Loader2 size={11} className="animate-spin" />
              <span>{t('chat.web.loading')}</span>
            </div>
          )}

          {didFail ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500 dark:bg-red-950/30 dark:text-red-300">
                  <AlertCircle size={20} />
                </div>
                <p className="text-sm font-medium text-foreground">{t('chat.web.loadFailed')}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">{didFail.message}（{didFail.code}）</p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleReload}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    <RefreshCw size={12} />
                    {t('chat.decision.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenExternal}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    <ExternalLink size={12} />
                    {t('chat.web.openExternal')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <webview
              ref={webviewRef}
              src={preview.url}
              allowpopups={true}
              partition="persist:web-preview"
              style={{ width: '100%', height: '100%', display: 'inline-flex', border: 0 }}
            />
          )}
        </div>
      </aside>
    </div>,
    document.body
  )
}

function ThinkingIndicator({ content }: { content: string }) {
  const { t } = useTranslation()
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
          <span className="text-xs text-muted-foreground">{t('chat.status.organizingAnswer')}</span>
        </div>
        <p id={contentId} hidden={!expanded} className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{content}</p>
      </button>
    </div>
  )
}
