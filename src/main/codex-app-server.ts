import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeAppLog, writeRawStreamLog, sanitizeForLogging } from './logging'
import { HARNESSCLAW_DIR, ensureDir, resolveBundledBinaryPath } from './config'

type CodexStatus = 'disconnected' | 'connecting' | 'connected'
type ApprovalPolicyOption = 'on-request' | 'never'
type ApprovalsReviewerOption = 'user' | 'auto_review'
type SandboxOption = 'danger-full-access'

interface SendOptions {
  approvalPolicy?: ApprovalPolicyOption
  approvalsReviewer?: ApprovalsReviewerOption
  sandbox?: SandboxOption
  cwd?: string
  model?: string
  modelProvider?: string
  effort?: string
}

interface JsonRpcRequest {
  id: number
  method: string
  params?: Record<string, unknown>
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingApprovalRequest {
  serverRequestId: number
  sessionId: string
  method: string
  name: string
  toolInput: string
  isReadOnly: boolean
  options: Array<{ label: string; scope: 'once' | 'session'; allow: boolean }>
  proposedExecpolicyAmendment?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getCodexBinary(): string {
  return process.env.HARNESSCLAW_CODEX_BIN || process.env.CODEX_BIN || resolveBundledBinaryPath('codex') || 'codex'
}

function extractThreadId(result: unknown): string {
  if (!isPlainObject(result)) return ''
  const thread = isPlainObject(result.thread) ? result.thread : {}
  return typeof thread.id === 'string' ? thread.id : ''
}

function extractTurnId(result: unknown): string {
  if (!isPlainObject(result)) return ''
  const turn = isPlainObject(result.turn) ? result.turn : {}
  return typeof turn.id === 'string' ? turn.id : ''
}

function extractErrorText(result: unknown): string {
  if (!isPlainObject(result)) return ''
  const turn = isPlainObject(result.turn) ? result.turn : result
  const error = isPlainObject(turn.error) ? turn.error : {}
  const message = typeof error.message === 'string' ? error.message : ''
  const code = typeof error.code === 'string' ? error.code : ''
  return message || code
}

function buildPermissionParams(options?: SendOptions): Record<string, unknown> {
  const fullAccess = options?.sandbox === 'danger-full-access'
  return {
    approvalPolicy: fullAccess ? 'never' : options?.approvalPolicy || 'on-request',
    approvalsReviewer: options?.approvalsReviewer || 'user',
    ...(fullAccess ? { permissions: 'danger-full-access' } : {}),
  }
}

function normalizeOptionText(value?: string): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function normalizeCwd(cwd?: string): string | undefined {
  return normalizeOptionText(cwd)
}

function extractCommandExecution(params: Record<string, unknown>): {
  sessionId: string
  callId: string
  command: string
  cwd?: string
  processId?: string
  output?: string
  exitCode?: number
  durationMs?: number
  status?: string
} | null {
  const item = isPlainObject(params.item) ? params.item : {}
  if (item.type !== 'commandExecution') return null

  const sessionId = typeof params.threadId === 'string' ? params.threadId : ''
  const callId = typeof item.id === 'string' ? item.id : ''
  const command = typeof item.command === 'string' ? item.command : ''
  if (!sessionId || !callId || !command) return null

  return {
    sessionId,
    callId,
    command,
    cwd: typeof item.cwd === 'string' ? item.cwd : undefined,
    processId: typeof item.processId === 'string' ? item.processId : undefined,
    output: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : undefined,
    exitCode: typeof item.exitCode === 'number' ? item.exitCode : undefined,
    durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
    status: typeof item.status === 'string' ? item.status : undefined,
  }
}

function uniqStrings(values: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function extractCodexWebSearch(params: Record<string, unknown>): {
  callId: string
  queries: string[]
  actionType?: string
  status?: string
} | null {
  const item = isPlainObject(params.item) ? params.item : {}
  if (item.type !== 'webSearch') return null

  const callId = typeof item.id === 'string' ? item.id : ''
  if (!callId) return null

  const action = isPlainObject(item.action) ? item.action : {}
  const actionQueries = Array.isArray(action.queries) ? action.queries : []
  const queries = uniqStrings([
    item.query,
    action.query,
    ...actionQueries,
  ])

  return {
    callId,
    queries,
    actionType: typeof action.type === 'string' ? action.type : undefined,
    status: typeof item.status === 'string' ? item.status : undefined,
  }
}

function formatWebSearchQueries(queries: string[]): string {
  if (queries.length === 0) return 'Preparing web search'
  if (queries.length === 1) return queries[0]
  return queries.map((query) => `- ${query}`).join('\n')
}

function stringifyToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(input, (_key, value) => typeof value === 'undefined' ? undefined : value)
}

export class CodexAppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private status: CodexStatus = 'disconnected'
  private requestId = 1
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private pending = new Map<number, PendingRequest>()
  private initPromise: Promise<void> | null = null
  private defaultSessionId = ''
  private clientId = ''
  private subscriptions: string[] = []
  private knownSessions = new Map<string, number>()
  private uiToThread = new Map<string, string>()
  private threadToUi = new Map<string, string>()
  private activeTurns = new Map<string, string>()
  private startedTurns = new Set<string>()
  private pendingApprovals = new Map<string, PendingApprovalRequest>()

  connect(): void {
    void this.ensureConnected().catch((error) => {
      this.emitCompatEvent({ type: 'error', content: asErrorMessage(error) })
    })
  }

  private async ensureConnected(): Promise<void> {
    if (this.status === 'connected' && this.child) return
    if (this.initPromise) return this.initPromise

    this.setStatus('connecting')
    const binary = getCodexBinary()
    ensureDir(HARNESSCLAW_DIR)
    writeAppLog('info', 'codex-app-server', 'Starting Codex app-server', {
      binary,
      codexHome: HARNESSCLAW_DIR,
    })

    this.child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CODEX_HOME: HARNESSCLAW_DIR,
      },
    })

    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')

    this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk))
    this.child.stderr.on('data', (chunk: string) => this.handleStderr(chunk))
    this.child.stdin.on('error', (error) => this.handleStdinError(error))
    this.child.on('error', (error) => {
      writeAppLog('error', 'codex-app-server', 'Failed to start Codex app-server', {
        error: error.message,
      })
      this.failPending(error)
      this.setStatus('disconnected')
    })
    this.child.on('exit', (code, signal) => {
      writeAppLog(code === 0 ? 'info' : 'warn', 'codex-app-server', 'Codex app-server exited', {
        code,
        signal,
      })
      this.child = null
      this.initPromise = null
      this.clientId = ''
      this.defaultSessionId = ''
      this.subscriptions = []
      this.activeTurns.clear()
      this.startedTurns.clear()
      this.pendingApprovals.clear()
      this.flushStdoutBuffer()
      this.flushStderrBuffer()
      this.failPending(new Error(`Codex app-server exited: ${code ?? signal ?? 'unknown'}`))
      this.setStatus('disconnected')
    })

    this.initPromise = this.initialize()
    try {
      await this.initPromise
    } catch (error) {
      this.disconnect()
      throw error
    } finally {
      this.initPromise = null
    }
  }

  private async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: {
        name: 'harnessclaw',
        title: 'HarnessClaw',
        version: '0.1.0',
      },
    })
    this.notify('initialized')
    this.setStatus('connected')
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    while (true) {
      const index = this.stdoutBuffer.indexOf('\n')
      if (index < 0) break
      const line = this.stdoutBuffer.slice(0, index).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1)
      if (!line) continue
      writeRawStreamLog('codex-app-server.stdout', line)
      try {
        this.handleMessage(JSON.parse(line) as Record<string, unknown>)
      } catch (error) {
        writeAppLog('warn', 'codex-app-server', 'Ignoring non-JSON stdout line', {
          line: line.slice(0, 500),
          error: asErrorMessage(error),
        })
      }
    }
  }

  private handleStderr(chunk: string): void {
    this.stderrBuffer += chunk
    while (true) {
      const index = this.stderrBuffer.indexOf('\n')
      if (index < 0) break
      const line = this.stderrBuffer.slice(0, index).trim()
      this.stderrBuffer = this.stderrBuffer.slice(index + 1)
      if (!line) continue
      writeRawStreamLog('codex-app-server.stderr', line)
      writeAppLog('debug', 'codex-app-server.stderr', line)
    }
  }

  private flushStderrBuffer(): void {
    const line = this.stderrBuffer.trim()
    this.stderrBuffer = ''
    if (!line) return
    writeRawStreamLog('codex-app-server.stderr', line)
    writeAppLog('debug', 'codex-app-server.stderr', line)
  }

  private flushStdoutBuffer(): void {
    const line = this.stdoutBuffer.trim()
    this.stdoutBuffer = ''
    if (!line) return
    writeRawStreamLog('codex-app-server.stdout', line)
    writeAppLog('warn', 'codex-app-server.stdout', 'Flushed unterminated stdout line', {
      line: line.slice(0, 500),
    })
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (typeof msg.id === 'number' && (isPlainObject(msg.result) || isPlainObject(msg.error) || 'result' in msg)) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(msg.id)
      if (isPlainObject(msg.error)) {
        pending.reject(new Error(typeof msg.error.message === 'string' ? msg.error.message : 'Codex request failed'))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    const method = typeof msg.method === 'string' ? msg.method : ''
    const params = isPlainObject(msg.params) ? msg.params : {}
    if (!method) return

    writeAppLog('trace', 'codex-app-server.frame', 'recv notification', {
      method,
      params: sanitizeForLogging(params),
    })

    switch (method) {
      case 'turn/started':
        this.handleTurnStarted(params)
        return
      case 'item/started':
        this.handleItemStarted(params)
        return
      case 'item/agentMessage/delta':
        this.handleTextDelta(params)
        return
      case 'item/completed':
        this.handleItemCompleted(params)
        return
      case 'turn/completed':
        this.handleTurnCompleted(params)
        return
      case 'warning':
        this.handleWarning(params)
        return
      default:
        this.handleServerRequest(msg, method, params)
    }
  }

  private handleServerRequest(msg: Record<string, unknown>, method: string, params: Record<string, unknown>): void {
    if (typeof msg.id !== 'number') return
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      this.handleApprovalRequest(msg.id, method, params)
      return
    }
    if (method === 'item/permissions/requestApproval') {
      this.respondToServerRequest(msg.id, { permissions: {} })
    }
  }

  private handleApprovalRequest(serverRequestId: number, method: string, params: Record<string, unknown>): void {
    const sessionId = this.resolveUiSessionId(params.threadId)
    if (!sessionId) {
      this.respondToServerRequest(serverRequestId, { decision: 'cancel' })
      return
    }

    const requestId = `codex-approval:${serverRequestId}`
    const reason = typeof params.reason === 'string' ? params.reason : ''
    const command = typeof params.command === 'string' ? params.command : ''
    const cwd = typeof params.cwd === 'string' ? params.cwd : ''
    const itemId = typeof params.itemId === 'string' ? params.itemId : ''
    const proposedExecpolicyAmendment = params.proposedExecpolicyAmendment
    const canPersistForSession = typeof proposedExecpolicyAmendment !== 'undefined'
    const name = method === 'item/fileChange/requestApproval' ? 'Write' : 'Bash'
    const toolInput = stringifyToolInput({
      command: command || reason || method,
      description: cwd ? `${reason || 'Codex requests approval'}\ncwd: ${cwd}` : reason,
      cwd,
      itemId,
      method,
    })
    const options: PendingApprovalRequest['options'] = [
      { label: 'Allow once', scope: 'once', allow: true },
      ...(canPersistForSession
        ? [{ label: 'Always allow in this session', scope: 'session' as const, allow: true }]
        : []),
      { label: 'Deny', scope: 'once', allow: false },
    ]

    this.pendingApprovals.set(requestId, {
      serverRequestId,
      sessionId,
      method,
      name,
      toolInput,
      isReadOnly: false,
      options,
      proposedExecpolicyAmendment,
    })

    this.emitCompatEvent({
      type: 'permission_request',
      session_id: sessionId,
      request_id: requestId,
      name,
      tool_input: toolInput,
      content: reason || 'Codex needs permission to continue.',
      is_read_only: false,
      options,
      metadata: {
        source: 'codex_app_server',
        method,
      },
    })
  }

  private handleTurnStarted(params: Record<string, unknown>): void {
    const sessionId = this.resolveUiSessionId(params.threadId)
    const turn = isPlainObject(params.turn) ? params.turn : {}
    const turnId = typeof turn.id === 'string' ? turn.id : ''
    if (!sessionId || !turnId || this.startedTurns.has(turnId)) return
    this.startedTurns.add(turnId)
    this.activeTurns.set(sessionId, turnId)
    this.emitCompatEvent({ type: 'turn_start', session_id: sessionId, turn_id: turnId })
  }

  private handleTextDelta(params: Record<string, unknown>): void {
    const sessionId = this.resolveUiSessionId(params.threadId)
    const delta = typeof params.delta === 'string' ? params.delta : ''
    if (!sessionId || !delta) return
    this.emitCompatEvent({ type: 'text_delta', session_id: sessionId, content: delta })
  }

  private handleItemStarted(params: Record<string, unknown>): void {
    const command = extractCommandExecution(params)
    const sessionId = this.resolveUiSessionId(params.threadId)
    if (!sessionId) return
    if (!command) {
      const webSearch = extractCodexWebSearch(params)
      if (!webSearch) return
      const queryText = formatWebSearchQueries(webSearch.queries)
      this.emitCompatEvent({
        type: 'tool_start',
        session_id: sessionId,
        name: 'Web Search',
        call_id: webSearch.callId,
        input: queryText,
        phase: 'executing',
        phase_hint: webSearch.queries.length > 0 ? queryText : 'Searching the web',
        metadata: {
          source: 'codex_web_search',
          actionType: webSearch.actionType,
          query: webSearch.queries[0] || '',
          queries: webSearch.queries,
        },
      })
      return
    }
    this.emitCompatEvent({
      type: 'tool_start',
      session_id: sessionId,
      name: 'Bash',
      call_id: command.callId,
      input: command.command,
      phase: 'executing',
      phase_hint: command.cwd ? `${command.command} (${command.cwd})` : command.command,
      metadata: {
        source: 'codex_command_execution',
        cwd: command.cwd,
        processId: command.processId,
      },
    })
  }

  private handleItemCompleted(params: Record<string, unknown>): void {
    const command = extractCommandExecution(params)
    const sessionId = this.resolveUiSessionId(params.threadId)
    if (!sessionId) return
    if (!command) {
      const webSearch = extractCodexWebSearch(params)
      if (!webSearch) return
      const queryText = formatWebSearchQueries(webSearch.queries)
      this.emitCompatEvent({
        type: 'tool_end',
        session_id: sessionId,
        name: 'Web Search',
        call_id: webSearch.callId,
        content: webSearch.queries.length > 0 ? `Searched web for:\n${queryText}` : 'Web search completed',
        is_error: webSearch.status === 'failed',
        status: webSearch.status === 'failed' ? 'failed' : webSearch.status === 'cancelled' ? 'cancelled' : 'ok',
        render_hint: 'search',
        metadata: {
          source: 'codex_web_search',
          actionType: webSearch.actionType,
          query: webSearch.queries[0] || '',
          queries: webSearch.queries,
        },
      })
      return
    }
    const failed = command.status === 'failed' || (typeof command.exitCode === 'number' && command.exitCode !== 0)
    this.emitCompatEvent({
      type: 'tool_end',
      session_id: sessionId,
      name: 'Bash',
      call_id: command.callId,
      content: command.output || '',
      is_error: failed,
      status: failed ? 'failed' : command.status === 'cancelled' ? 'cancelled' : 'ok',
      duration_ms: command.durationMs,
      render_hint: 'terminal',
      metadata: {
        source: 'codex_command_execution',
        command: command.command,
        cwd: command.cwd,
        processId: command.processId,
        exitCode: command.exitCode,
      },
    })
  }

  private handleTurnCompleted(params: Record<string, unknown>): void {
    const sessionId = this.resolveUiSessionId(params.threadId)
    if (!sessionId) return
    const turn = isPlainObject(params.turn) ? params.turn : {}
    const turnId = typeof turn.id === 'string' ? turn.id : this.activeTurns.get(sessionId) || ''
    const status = typeof turn.status === 'string' ? turn.status : ''
    const errorText = extractErrorText({ turn })
    if (status === 'failed' || errorText) {
      this.emitCompatEvent({
        type: 'error',
        session_id: sessionId,
        content: errorText || 'Codex turn failed',
      })
    } else {
      this.emitCompatEvent({ type: 'response_end', session_id: sessionId, turn_id: turnId, tools_used: [] })
    }
    this.activeTurns.delete(sessionId)
    if (turnId) this.startedTurns.delete(turnId)
  }

  private handleWarning(params: Record<string, unknown>): void {
    const sessionId = this.resolveUiSessionId(params.threadId)
    const message = typeof params.message === 'string' ? params.message : ''
    if (!message) return
    this.emitCompatEvent({ type: 'warning', session_id: sessionId, content: message })
  }

  private async ensureThread(sessionId: string, options?: SendOptions): Promise<string> {
    const existing = this.uiToThread.get(sessionId)
    if (existing) return existing

    const resolvedCwd = normalizeCwd(options?.cwd) || process.cwd()
    const model = normalizeOptionText(options?.model)
    const modelProvider = normalizeOptionText(options?.modelProvider)
    const effort = normalizeOptionText(options?.effort)
    const result = await this.request('thread/start', {
      cwd: resolvedCwd,
      ...(model ? { model } : {}),
      ...(modelProvider ? { modelProvider } : {}),
      ...(effort ? { config: { model_reasoning_effort: effort } } : {}),
      ...buildPermissionParams(options),
    })
    const threadId = extractThreadId(result)
    if (!threadId) throw new Error('Codex thread/start did not return a thread id')

    this.uiToThread.set(sessionId, threadId)
    this.threadToUi.set(threadId, sessionId)
    this.defaultSessionId = sessionId
    this.clientId = `codex:${threadId}`
    this.subscriptions = [sessionId]
    this.knownSessions.set(sessionId, Date.now())
    writeAppLog('debug', 'codex-app-server', 'Started Codex thread', {
      sessionId,
      threadId,
      cwd: resolvedCwd,
      model,
      modelProvider,
      effort,
    })
    this.emitCompatEvent({
      type: 'session_created',
      session_id: sessionId,
      client_id: this.clientId,
      session: { session_id: sessionId, codex_thread_id: threadId },
    })
    this.emitCompatEvent({ type: 'connected', session_id: sessionId, client_id: this.clientId })
    this.emitSessions()
    return threadId
  }

  private resolveUiSessionId(threadId: unknown): string {
    if (typeof threadId !== 'string' || !threadId) return this.defaultSessionId
    return this.threadToUi.get(threadId) || threadId
  }

  private isStdinWritable(child: ChildProcessWithoutNullStreams): boolean {
    return child.stdin.writable && !child.stdin.destroyed && !child.stdin.writableEnded
  }

  private handleStdinError(error: Error): void {
    writeAppLog('warn', 'codex-app-server.stdin', 'Codex app-server stdin write failed', {
      error: error.message,
      code: (error as NodeJS.ErrnoException).code,
    })
    this.failPending(error)
  }

  private writeJsonFrame(payload: Record<string, unknown>, onError?: (error: Error) => void): boolean {
    const child = this.child
    if (!child || !this.isStdinWritable(child)) {
      const error = new Error('Codex app-server stdin is not writable')
      onError?.(error)
      this.handleStdinError(error)
      return false
    }

    let handled = false
    const fail = (error: Error): void => {
      if (handled) return
      handled = true
      onError?.(error)
      this.handleStdinError(error)
    }

    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return
        fail(error)
      })
      return true
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }

  private request(method: string, params?: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
    const child = this.child
    if (!child || !this.isStdinWritable(child)) {
      return Promise.reject(new Error('Codex app-server is not running'))
    }
    const id = this.requestId++
    const payload: JsonRpcRequest = { id, method }
    if (params) payload.params = params
    writeAppLog('trace', 'codex-app-server.frame', 'send request', {
      method,
      id,
      params: sanitizeForLogging(params || {}),
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const rejectWrite = (error: Error): void => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
      this.writeJsonFrame(payload, rejectWrite)
    })
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    const payload = params ? { method, params } : { method }
    this.writeJsonFrame(payload)
  }

  private respondToServerRequest(id: number, result: Record<string, unknown>): void {
    this.writeJsonFrame({ id, result })
  }

  private failPending(error: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const item of pending) {
      clearTimeout(item.timer)
      item.reject(error)
    }
  }

  private emitCompatEvent(event: Record<string, unknown>): void {
    this.emit('event', event)
  }

  private emitSessions(): void {
    const sessions = [...this.knownSessions.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([key, updatedAt]) => ({ key, updated_at: updatedAt }))
    this.emitCompatEvent({ type: 'sessions', sessions })
  }

  async send(content: string, sessionId?: string, options?: SendOptions): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId || `codex:${randomUUID()}`
    try {
      await this.ensureConnected()
      const threadId = await this.ensureThread(resolvedSessionId, options)
      const model = normalizeOptionText(options?.model)
      const effort = normalizeOptionText(options?.effort)
      const result = await this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: content }],
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...buildPermissionParams(options),
      })
      const turnId = extractTurnId(result)
      if (turnId && !this.startedTurns.has(turnId)) {
        this.startedTurns.add(turnId)
        this.activeTurns.set(resolvedSessionId, turnId)
        this.emitCompatEvent({ type: 'turn_start', session_id: resolvedSessionId, turn_id: turnId })
      }
      this.knownSessions.set(resolvedSessionId, Date.now())
      return true
    } catch (error) {
      this.emitCompatEvent({
        type: 'error',
        session_id: resolvedSessionId,
        content: asErrorMessage(error),
      })
      return false
    }
  }

  command(cmd: string, sessionId?: string): void {
    if (cmd.trim() !== '/new') {
      this.emitCompatEvent({ type: 'error', session_id: sessionId, content: `Unsupported command: ${cmd}` })
      return
    }
    const resolvedSessionId = sessionId || `codex:${randomUUID()}`
    this.defaultSessionId = resolvedSessionId
    this.subscriptions = [resolvedSessionId]
    this.knownSessions.set(resolvedSessionId, Date.now())
    this.emitCompatEvent({ type: 'subscribed', session_id: resolvedSessionId, subscriptions: [resolvedSessionId] })
    this.emitSessions()
  }

  async stop(sessionId?: string): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId
    const threadId = resolvedSessionId ? this.uiToThread.get(resolvedSessionId) : ''
    const turnId = resolvedSessionId ? this.activeTurns.get(resolvedSessionId) : ''
    if (!threadId || !turnId) return false
    try {
      await this.request('turn/abort', { threadId, turnId }, 10_000)
      return true
    } catch (error) {
      this.emitCompatEvent({
        type: 'error',
        session_id: resolvedSessionId,
        content: asErrorMessage(error),
      })
      return false
    }
  }

  subscribe(sessionId: string): void {
    this.defaultSessionId = sessionId || this.defaultSessionId
    this.subscriptions = sessionId ? [sessionId] : []
    this.emitCompatEvent({ type: 'subscribed', session_id: sessionId, subscriptions: [sessionId] })
  }

  unsubscribe(sessionId: string): void {
    if (!this.subscriptions.includes(sessionId)) return
    this.subscriptions = this.subscriptions.filter((value) => value !== sessionId)
    this.emitCompatEvent({ type: 'unsubscribed', session_id: sessionId, subscriptions: [...this.subscriptions] })
  }

  listSessions(): void {
    this.emitSessions()
  }

  async probe(): Promise<boolean> {
    try {
      await this.ensureConnected()
      return this.status === 'connected'
    } catch {
      return false
    }
  }

  disconnect(): void {
    this.failPending(new Error('Codex app-server disconnected by client'))
    this.flushStdoutBuffer()
    this.flushStderrBuffer()
    this.child?.kill()
    this.child = null
    this.initPromise = null
    this.clientId = ''
    this.defaultSessionId = ''
    this.subscriptions = []
    this.activeTurns.clear()
    this.startedTurns.clear()
    this.pendingApprovals.clear()
    this.setStatus('disconnected')
  }

  getStatus(): { status: CodexStatus; clientId: string; sessionId: string; subscriptions: string[] } {
    return {
      status: this.status,
      clientId: this.clientId,
      sessionId: this.defaultSessionId,
      subscriptions: [...this.subscriptions],
    }
  }

  respondPermission(
    requestId: string,
    approved: boolean,
    scope: 'once' | 'session' = 'once',
    message?: string,
  ): boolean {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending) return false

    const result = approved
      ? scope === 'session' && typeof pending.proposedExecpolicyAmendment !== 'undefined'
        ? {
            decision: {
              acceptWithExecpolicyAmendment: {
                execpolicy_amendment: pending.proposedExecpolicyAmendment,
              },
            },
          }
        : { decision: 'accept' }
      : { decision: 'cancel' }

    this.respondToServerRequest(pending.serverRequestId, result)
    this.pendingApprovals.delete(requestId)
    this.emitCompatEvent({
      type: 'permission_result',
      session_id: pending.sessionId,
      request_id: requestId,
      name: pending.name,
      tool_input: pending.toolInput,
      is_read_only: pending.isReadOnly,
      options: pending.options,
      approved,
      scope,
      content: approved ? 'User approved permission request' : (message || 'User denied permission request'),
      metadata: {
        source: 'codex_app_server',
        method: pending.method,
      },
    })
    return true
  }

  respondAskQuestion(): boolean {
    return false
  }

  async respondPlan(): Promise<boolean> {
    return false
  }

  respondStepDecision(): boolean {
    return false
  }

  setBrowserAgentSessionManager(): void {
    // Browser Agent integration remains owned by the Emma engine adapter.
  }

  private setStatus(status: CodexStatus): void {
    if (this.status === status) return
    this.status = status
    this.emit('statusChange', status)
  }
}
