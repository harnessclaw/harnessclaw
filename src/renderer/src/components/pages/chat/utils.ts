// Pure helper functions extracted from ChatPage.tsx.
//
// Behavior-neutral move: every function below is identical to its former
// in-file definition (no edits to any body). Splitting them out — together with
// the type declarations in ./types — keeps ChatPage.tsx under the 500KB
// single-file threshold that trips Babel's code-generator deopt warning.
// No JSX, no hooks, no React here — just data transforms. All functions are
// exported in a single block at the end so the original bodies stay untouched.
import type {
  ProjectContext, SubagentInfo, ToolActivity, Message, FilePreviewData,
  PermissionRequestData, PermissionResultData, AskQuestionRequestData, AskQuestionResultData,
  StepDecisionRequestData, StepDecisionResultData, SystemNoticeData,
  SearchResultUrl, GeneratedImagePreview, AttachmentItem, SessionState,
  SyncAgentState, CollaborationTask, AsyncAgentState, TeamState, CollaborationState,
  PersistedTaskStatusPayload, PersistedCollaborationStatusPayload, ArtifactRef,
  BrowserSessionCardState,
} from './types'

const ATTACHMENT_BLOCK_START = '[HARNESSCLAW_LOCAL_ATTACHMENTS]'
const ATTACHMENT_BLOCK_END = '[/HARNESSCLAW_LOCAL_ATTACHMENTS]'
const PROJECT_CONTEXT_BLOCK_START = '[HARNESSCLAW_PROJECT_CONTEXT]'
const PROJECT_CONTEXT_BLOCK_END = '[/HARNESSCLAW_PROJECT_CONTEXT]'

// ─── extracted function bodies appended below (verbatim) ─────────────────────

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
  // Prefer the engine-provided `user_message` over the raw `message` —
  // upstream already localizes / softens the user-facing wording (e.g.
  // engine emits `{type:"user_aborted", message:"Cancelled by user",
  // user_message:"已取消"}` on user cancel). Falling back to `message`
  // keeps older / non-localized errors working unchanged.
  const userMessage = typeof record.user_message === 'string' ? record.user_message : ''
  const rawMessage = typeof record.message === 'string' ? record.message : ''
  const message = userMessage
    || rawMessage
    || fallbackContent
    || (typeof root === 'string' ? root : t('chat.errors.requestFailed'))
  // Engine v2 emits `error.type` (eg `user_aborted`); legacy frames use
  // `reason`. Try both so the renderer can branch on either shape.
  const reason = typeof record.reason === 'string'
    ? record.reason
    : typeof record.type === 'string'
      ? record.type
      : isRecord(root) && typeof root.reason === 'string'
        ? root.reason
        : undefined
  const sessionId = typeof record.session_id === 'string'
    ? record.session_id
    : isRecord(root) && typeof root.session_id === 'string'
      ? root.session_id
      : undefined

  // User-initiated cancellations aren't really "request failed" — show a
  // dedicated "用户取消 / Cancelled" title + localized body instead of the
  // generic red "请求失败: Cancelled by user" treatment. Detection key is
  // `user_aborted` (engine v2) plus a defensive substring match for older
  // frames that only carry the English text.
  const isUserCancelled = reason === 'user_aborted'
    || /cancelled by user/i.test(rawMessage)
  if (isUserCancelled) {
    return {
      kind: 'error',
      title: t('chat.errors.userCancelledTitle'),
      message: userMessage || t('chat.errors.userCancelled'),
      reason,
      sessionId,
    }
  }

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

export {
  createEmptyCollaborationState, createSyncAgentState, createEmptySessionState, createPersistentSessionId,
  normalizeProjectContext, parseProjectContextJson, buildMessagePayload, stripProjectContextBlock,
  extractAttachments, normalizeSubagent, isSameSubagent, getModuleKey, parseJsonObject, isRecord,
  asStringArray, normalizeEventType, stringifyToolPayload, getToolEventName, getToolEventCallId,
  getToolCallEventContent, getToolResultEventContent, getToolDurationMs, getToolRenderHint,
  getToolLanguage, getToolFilePath, getToolMetadata, extractSearchResultUrls, extractSearchQuery,
  extractSearchResultCount, extractGeneratedImagesFromMetadata, safeUrlHostname, faviconUrl,
  upsertSessionToolByCallId, summarizeInlineText, createSubagentInfo, createTaskStatusPayload,
  createRoutedAgentStatusPayload, createAgentMessageStatusPayload, createAsyncAgentStatusPayload,
  createTeamStatusPayload, parseTaskStatusPayload, parsePersistedCollaborationStatusPayload,
  applyPersistedCollaborationStatus, inferLegacyCollaborationFromMessages, mergeLegacyCollaborationFallback,
  getPersistedStatusTone, inferCollaborationFromMessages, buildErrorHint, buildSystemErrorNotice,
  getHarnessclawEventSessionId, getFileName, getFileLanguage, formatMessageTime, formatTeamUpdateTime,
  findAttachableAssistantMessageIndex, isVisualErrorOnlyAssistantMessage, compactMessagesForDisplay,
  extractFilePreviewData, parsePermissionRequestData, parsePermissionResultData, parseAskQuestionRequestData,
  parseAskQuestionResultData, parseStepDecisionRequestData, parseStepDecisionResultData, getConversationLabel,
  getToolDisplayName, getPermissionOptionLabel, formatDurationMs, getToolRenderHintLabel, getToolResultSummary,
  normalizeBrowserSession, extractBrowserSessionID, extractBrowserSessionIDs, normalizeBrowserSessionIDs,
  closeBrowserSessionIDs, upsertBrowserSession, selectBrowserSession,
  getToolErrorPresentation, getToolErrorColorClasses, extractErrorInfoFromMetadata, getTaskStatusLabel,
  getTaskStatusClasses, getSyncAgentStatusLabel, getSyncAgentStatusClasses, getSyncAgentToolStatusClasses,
  getAsyncAgentStatusLabel, getAsyncAgentStatusClasses, getSubagentVisualStatus, getTeamEventLabel,
  getTeamEventSummary, extractArtifactsFromActivity, formatArtifactSize,
}
