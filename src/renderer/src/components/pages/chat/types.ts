// Shared type declarations extracted from ChatPage.tsx.
//
// These are pure, compile-time-only declarations (no runtime code) that were
// split out so ChatPage.tsx stays under the 500KB single-file threshold that
// trips Babel's code-generator deopt warning. Extraction is behavior-neutral:
// every declaration is identical to its former in-file definition, only with
// an added `export` and the `AgentTreeNode` reference lifted to a top import.
import type { LocalAttachmentItem } from '@/components/attachments/AttachmentPreviewPanel'
import type { SystemNotice } from '@/components/common/SystemNoticeModal'
import type { AgentTreeNode } from '@/components/common/ConversationSidePanel'

export type MessageRole = 'user' | 'assistant' | 'system'
export type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

export interface SubagentInfo {
  taskId: string
  label: string
  status: 'ok' | 'error' | string
}

export interface ProjectContext {
  projectId: string
  name: string
  description: string
  createdAt?: number
}

export interface ContentSegment {
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

export interface ToolErrorRecovery {
  action?: string
  next_card_id?: string
}

export interface ToolActivity {
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

export interface Message {
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

export interface SessionItem {
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

export interface PermissionRequestData {
  toolInput: string
  message: string
  isReadOnly: boolean
  command?: string
  description?: string
  options: Array<{ label: string; scope: 'once' | 'session'; allow: boolean }>
}

export interface PermissionResultData {
  approved: boolean
  scope: 'once' | 'session'
  message: string
}

export interface AskQuestionRequestData {
  question: string
  options: Array<{ label: string; description?: string }>
  multi: boolean
  allowCustom: boolean
}

export interface AskQuestionResultData {
  status: 'success' | 'cancelled'
  output: string
  errorMessage?: string
}

// v0.5.0 §7.1 kind=step_decision — payload shape used by StepDecisionCard.
export interface StepDecisionRequestData {
  scope: 'step' | 'plan'
  stepId: string
  stepDescription: string
  reason: string
  attempts: number
  allowRetry: boolean
}

export interface StepDecisionResultData {
  decision: 'continue' | 'retry' | 'cancel'
  note?: string
}

export type RespondStepDecisionHandler = (
  requestId: string,
  decision: 'continue' | 'retry' | 'cancel',
  note?: string,
) => Promise<{ ok: boolean; error?: string }>

export interface SystemNoticeData {
  kind: 'error'
  title: string
  message: string
  reason?: string
  sessionId?: string
  hint?: string
}

export interface SessionNotice {
  id: string
  title: string
  message: string
  tone: 'info' | 'warning'
  ts: number
}

/**
 * Search-result URL extracted from a tool result's metadata.urls (WebSearch /
 * TavilySearch). Rendered as a clickable chip in the tool card; clicking
 * opens the WebPreviewDrawer.
 */
export interface SearchResultUrl {
  url: string
  title?: string
}

export interface WebPreviewData {
  url: string
  title?: string
  query?: string
}

export interface GeneratedImagePreview {
  path: string
  fileName: string
  mime?: string
  bytes?: number
  model?: string
  prompt?: string
  size?: string
}

/**
 * User preference for how plain http(s) links inside markdown messages should
 * open: in the built-in WebPreviewDrawer (`'drawer'`) or via the system's
 * default browser through `shell.openExternal` (`'external'`). Configured in
 * Settings → UI 设置. Default is `'drawer'`.
 */
export type LinkOpenBehavior = 'drawer' | 'external'

export type AttachmentItem = LocalAttachmentItem
export type RespondPermissionHandler = (requestId: string, approved: boolean, scope: 'once' | 'session') => Promise<void>
export type RespondAskQuestionHandler = (toolUseId: string, status: 'success' | 'cancelled', output?: string, errorMessage?: string) => Promise<{ ok: boolean; error?: string }>

// Per-session state
export interface SessionState {
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
  /**
   * Lightweight user-facing runtime note. Unlike systemNotices, this is not
   * persisted into the transcript and is dismissed inline above the composer.
   */
  sessionNotice?: SessionNotice
  /**
   * v4 (2026-06-22) — Agent 树状日志数据,用于右侧日志面板渲染子秘书层级结构。
   * 根节点是 Emma(Leader),子节点是各个专业 agent(Browser/Research/File...)。
   * 由 WebSocket 事件处理器(subagent_start/end, tool_start/end)实时构建。
   */
  agentTreeLogs?: AgentTreeNode[]
}

export interface CollaborationCapabilities {
  subAgents: boolean
  tasks: boolean
  messaging: boolean
  asyncAgent: boolean
  teams: boolean
}

export interface RoutedAgentInfo {
  agentId: string
  agentName: string
  description: string
  agentType: string
  updatedAt: number
}

export interface LoadedSkillInfo {
  name: string
  version?: string
  source?: string
}

export interface SyncAgentState {
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

export interface CollaborationTask {
  taskId: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner?: string
  activeForm?: string
  scopeId?: string
  updatedAt: number
}

export interface AgentMessageInfo {
  id: string
  from: string
  to: string
  summary: string
  teamId?: string
  ts: number
}

export interface AsyncAgentState {
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

export interface TeamState {
  teamId: string
  teamName: string
  members: string[]
  lastEvent: 'created' | 'member_join' | 'member_left' | 'deleted'
  memberName?: string
  memberType?: string
  updatedAt: number
}

export interface CollaborationState {
  capabilities: CollaborationCapabilities
  routedAgent?: RoutedAgentInfo
  syncAgents: Record<string, SyncAgentState>
  tasks: Record<string, CollaborationTask>
  agentMessages: AgentMessageInfo[]
  asyncAgents: Record<string, AsyncAgentState>
  teams: Record<string, TeamState>
}

export interface PersistedTaskStatusPayload {
  kind: 'task_event'
  taskId: string
  subject: string
  status: CollaborationTask['status']
  owner?: string
  activeForm?: string
  scopeId?: string
  summary: string
}

export interface PersistedRoutedAgentPayload {
  kind: 'agent_routed'
  agentId: string
  agentName: string
  description?: string
  agentType?: string
  summary: string
}

export interface PersistedAgentMessagePayload {
  kind: 'agent_message'
  id: string
  from: string
  to: string
  summary: string
  teamId?: string
}

export interface PersistedAsyncAgentStatusPayload {
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

export interface PersistedTeamStatusPayload {
  kind: 'team_event'
  teamId: string
  teamName?: string
  members: string[]
  lastEvent: TeamState['lastEvent']
  memberName?: string
  memberType?: string
  summary: string
}

export type PersistedCollaborationStatusPayload =
  | PersistedTaskStatusPayload
  | PersistedRoutedAgentPayload
  | PersistedAgentMessagePayload
  | PersistedAsyncAgentStatusPayload
  | PersistedTeamStatusPayload

export interface BrowserSessionCardState {
  session_id: string
  visible: boolean
  closed?: boolean
}
