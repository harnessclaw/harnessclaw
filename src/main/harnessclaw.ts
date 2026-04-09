import { WebSocket } from 'ws'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readNanobotConfig } from './config'

interface HarnessclawConfig {
  enabled: boolean
  host: string
  port: number
  path: string
  token: string
  userId: string
  toolTimeoutMs: number
  bashTimeoutMs: number
  webFetchTimeoutMs: number
  allowedTools: string[]
  deniedTools: string[]
}

interface PendingContentBlock {
  type: string
  id?: string
  name?: string
  text?: string
  thinking?: string
  inputJson?: string
}

interface PendingMessageState {
  requestId?: string
  stopReason?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }
  blocks: Map<number, PendingContentBlock>
}

interface ToolResultPayload {
  status: 'success' | 'error' | 'denied' | 'timeout' | 'cancelled'
  output?: string
  error?: {
    code: string
    message: string
  }
  metadata?: Record<string, unknown>
}

interface PendingPermissionRequest {
  sessionId: string
  toolName: string
  toolInput: string
  message: string
  isReadOnly: boolean
  options: Array<{ label: string; scope: 'once' | 'session'; allow: boolean }>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function parseDurationMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value !== 'string' || !value.trim()) return fallback

  const normalized = value.trim().toLowerCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/)
  if (!match) return fallback

  const amount = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000
  return Math.max(1, Math.round(amount * multiplier))
}

function makeEventId(prefix = 'evt_client'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function toUsage(totalUsage: unknown): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined {
  if (!isPlainObject(totalUsage)) return undefined
  const prompt = typeof totalUsage.input_tokens === 'number' ? totalUsage.input_tokens : 0
  const completion = typeof totalUsage.output_tokens === 'number' ? totalUsage.output_tokens : 0
  const cacheRead = typeof totalUsage.cache_read_tokens === 'number' ? totalUsage.cache_read_tokens : 0
  const cacheWrite = typeof totalUsage.cache_write_tokens === 'number' ? totalUsage.cache_write_tokens : 0
  return {
    prompt_tokens: prompt + cacheRead + cacheWrite,
    completion_tokens: completion,
    total_tokens: prompt + completion + cacheRead + cacheWrite,
  }
}

function trimOutput(output: string, maxLength = 200_000): { text: string; truncated: boolean } {
  if (output.length <= maxLength) {
    return { text: output, truncated: false }
  }
  return {
    text: `${output.slice(0, maxLength)}\n\n[truncated ${output.length - maxLength} chars]`,
    truncated: true,
  }
}

function combineOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) return `${stdout}${stdout.endsWith('\n') ? '' : '\n'}${stderr}`
  return stdout || stderr
}

type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

const HARNESSCLAW_WS_HOST = '0.0.0.0'
const HARNESSCLAW_WS_PORT = 8081
const HARNESSCLAW_WS_PATH = '/ws'

export class HarnessclawClient extends EventEmitter {
  private ws: WebSocket | null = null
  private status: HarnessclawStatus = 'disconnected'
  private clientId = ''
  private defaultSessionId = ''
  private subscriptions: string[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private maxRetries = 20
  private shouldReconnect = false
  private knownSessions = new Map<string, number>()
  private pendingMessages = new Map<string, PendingMessageState>()
  private pendingPermissionRequests = new Map<string, PendingPermissionRequest>()
  private pendingSessionInitId = ''
  private sessionCreateInFlight = false
  private transportWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  private sessionInitWaiters: Array<{ resolve: (sessionId: string) => void; reject: (error: Error) => void }> = []
  private pendingPongWaiters: Array<(ok: boolean) => void> = []

  connect(): void {
    const wasReconnecting = this.shouldReconnect
    this.shouldReconnect = true
    if (!wasReconnecting) {
      this.retryCount = 0
    }
    this.attemptConnect()
  }

  private attemptConnect(force = false): void {
    if (!force && this.retryTimer) {
      return
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    if (!force && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.terminate()
      this.ws = null
    }

    const cfg = this.readConfig()
    if (!cfg || !cfg.enabled) {
      this.setStatus('disconnected')
      this.rejectTransportWaiters(new Error('Harnessclaw websocket channel not found in config'))
      this.emitCompatEvent({ type: 'error', content: 'Harnessclaw websocket channel not found in config' })
      return
    }

    const url = new URL(`ws://${cfg.host}:${cfg.port}${cfg.path.startsWith('/') ? cfg.path : `/${cfg.path}`}`)

    console.log(`[Harnessclaw] Connecting to ${url.toString()} (attempt ${this.retryCount + 1})`)
    this.setStatus('connecting')

    const headers: Record<string, string> = {}
    if (cfg.token) {
      headers.Authorization = `Bearer ${cfg.token}`
    }

    this.ws = new WebSocket(url, Object.keys(headers).length > 0 ? { headers } : undefined)

    this.ws.on('open', () => {
      console.log('[Harnessclaw] WebSocket opened')
      this.retryCount = 0
      this.setStatus('connected')
      this.resolveTransportWaiters()
      if (this.pendingSessionInitId) {
        this.sendSessionCreate(this.pendingSessionInitId)
      }
    })

    this.ws.on('message', (data) => {
      try {
        const raw = data.toString()
        console.log('[Harnessclaw] ← recv:', raw)
        const msg = JSON.parse(raw) as Record<string, unknown>
        this.handleMessage(msg)
      } catch (e) {
        console.error('[Harnessclaw] Failed to parse message:', e)
      }
    })

    this.ws.on('error', (err) => {
      console.error('[Harnessclaw] WebSocket error:', err.message)
    })

    this.ws.on('close', (code, reason) => {
      console.log('[Harnessclaw] WebSocket closed:', code, reason.toString())
      const reconnectSessionId = this.pendingSessionInitId || this.defaultSessionId
      this.ws = null
      this.pendingMessages.clear()
      this.pendingPermissionRequests.clear()
      this.clientId = ''
      this.defaultSessionId = ''
      this.subscriptions = []
      this.sessionCreateInFlight = false
      this.rejectTransportWaiters(new Error(`Harnessclaw websocket closed: ${code} ${reason.toString()}`))
      this.rejectSessionInitWaiters(new Error(`Harnessclaw websocket closed before session initialized: ${code} ${reason.toString()}`))
      this.resolvePendingPongs(false)
      this.setStatus('disconnected')
      this.pendingSessionInitId = this.shouldReconnect ? reconnectSessionId : ''
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (!this.shouldReconnect) return
    if (this.retryCount >= this.maxRetries) {
      console.warn('[Harnessclaw] Max retries reached, giving up')
      return
    }
    const delay = Math.min(1000 * Math.max(1, 2 ** Math.min(this.retryCount, 4)), 30_000)
    console.log(`[Harnessclaw] Retry in ${delay}ms...`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.retryCount++
      this.attemptConnect(true)
    }, delay)
  }

  private resolveTransportWaiters(): void {
    const waiters = [...this.transportWaiters]
    this.transportWaiters = []
    waiters.forEach((waiter) => waiter.resolve())
  }

  private rejectTransportWaiters(error: Error): void {
    if (this.transportWaiters.length === 0) return
    const waiters = [...this.transportWaiters]
    this.transportWaiters = []
    waiters.forEach((waiter) => waiter.reject(error))
  }

  private resolveSessionInitWaiters(sessionId: string): void {
    const waiters = [...this.sessionInitWaiters]
    this.sessionInitWaiters = []
    waiters.forEach((waiter) => waiter.resolve(sessionId))
  }

  private rejectSessionInitWaiters(error: Error): void {
    if (this.sessionInitWaiters.length === 0) return
    const waiters = [...this.sessionInitWaiters]
    this.sessionInitWaiters = []
    waiters.forEach((waiter) => waiter.reject(error))
  }

  private resolvePendingPongs(ok: boolean): void {
    if (this.pendingPongWaiters.length === 0) return
    const waiters = [...this.pendingPongWaiters]
    this.pendingPongWaiters = []
    waiters.forEach((waiter) => waiter(ok))
  }

  private waitForTransport(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    if (!this.shouldReconnect) {
      this.connect()
    }
    return new Promise((resolve, reject) => {
      this.transportWaiters.push({ resolve, reject })
    })
  }

  private sendSessionCreate(sessionId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.sessionCreateInFlight) return

    const cfg = this.readConfig()
    const payload: Record<string, unknown> = {
      type: 'session.create',
      event_id: makeEventId(),
    }

    if (sessionId) {
      payload.session_id = sessionId
    }
    if (cfg?.userId) {
      payload.user_id = cfg.userId
    }

    this.sessionCreateInFlight = true
    console.log('[Harnessclaw] → send:', JSON.stringify(payload))
    this.ws.send(JSON.stringify(payload))
  }

  private async ensureSession(sessionId: string): Promise<string> {
    const trimmedSessionId = sessionId.trim()
    if (!trimmedSessionId) {
      throw new Error('No active Harnessclaw session')
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.defaultSessionId === trimmedSessionId) {
      return trimmedSessionId
    }

    if (this.pendingSessionInitId === trimmedSessionId && this.sessionInitWaiters.length > 0) {
      return new Promise((resolve, reject) => {
        this.sessionInitWaiters.push({ resolve, reject })
      })
    }

    this.pendingSessionInitId = trimmedSessionId

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.waitForTransport()
    } else if (this.defaultSessionId && this.defaultSessionId !== trimmedSessionId) {
      this.attemptConnect(true)
      await this.waitForTransport()
    } else {
      this.sendSessionCreate(trimmedSessionId)
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.defaultSessionId === trimmedSessionId) {
      this.sessionCreateInFlight = false
      this.pendingSessionInitId = ''
      return trimmedSessionId
    }

    return new Promise((resolve, reject) => {
      this.sessionInitWaiters.push({ resolve, reject })
    })
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = typeof msg.type === 'string' ? msg.type : ''
    const sessionId = typeof msg.session_id === 'string' ? msg.session_id : this.defaultSessionId
    if (!type) return

    switch (type) {
      case 'session.created': {
        this.defaultSessionId = sessionId
        this.pendingSessionInitId = ''
        this.sessionCreateInFlight = false
        this.clientId = `session:${sessionId}`
        this.subscriptions = sessionId ? [sessionId] : []
        if (sessionId) {
          this.knownSessions.set(sessionId, Date.now())
        }
        this.resolveSessionInitWaiters(sessionId)
        this.emitCompatEvent({
          type: 'connected',
          session_id: sessionId,
          client_id: this.clientId,
          protocol_version: msg.protocol_version,
          session: msg.session,
        })
        this.emitSessions()
        break
      }

      case 'message.start': {
        const hadPendingMessage = this.pendingMessages.has(sessionId)
        this.pendingMessages.set(sessionId, {
          requestId: typeof msg.request_id === 'string' ? msg.request_id : undefined,
          usage: isPlainObject(msg.message) && isPlainObject(msg.message.usage)
            ? {
                input_tokens: typeof msg.message.usage.input_tokens === 'number' ? msg.message.usage.input_tokens : 0,
                output_tokens: 0,
                cache_read_tokens: typeof msg.message.usage.cache_read_tokens === 'number' ? msg.message.usage.cache_read_tokens : 0,
                cache_write_tokens: typeof msg.message.usage.cache_write_tokens === 'number' ? msg.message.usage.cache_write_tokens : 0,
              }
            : undefined,
          blocks: new Map<number, PendingContentBlock>(),
        })
        if (!hadPendingMessage) {
          this.emitCompatEvent({
            type: 'turn_start',
            session_id: sessionId,
            request_id: msg.request_id,
            message: msg.message,
          })
        }
        break
      }

      case 'content.start': {
        const index = typeof msg.index === 'number' ? msg.index : -1
        const state = this.ensurePendingMessage(sessionId)
        const block = isPlainObject(msg.content_block) ? msg.content_block : {}
        state.blocks.set(index, {
          type: typeof block.type === 'string' ? block.type : 'text',
          id: typeof block.id === 'string' ? block.id : undefined,
          name: typeof block.name === 'string' ? block.name : undefined,
          text: typeof block.text === 'string' ? block.text : '',
          thinking: typeof block.thinking === 'string' ? block.thinking : '',
          inputJson: isPlainObject(block.input) ? JSON.stringify(block.input) : '',
        })
        break
      }

      case 'content.delta': {
        const index = typeof msg.index === 'number' ? msg.index : -1
        const state = this.ensurePendingMessage(sessionId)
        const block = state.blocks.get(index)
        const delta = isPlainObject(msg.delta) ? msg.delta : {}
        const deltaType = typeof delta.type === 'string' ? delta.type : ''

        if (deltaType === 'text_delta') {
          const chunk = typeof delta.text === 'string' ? delta.text : ''
          if (block) block.text = `${block.text || ''}${chunk}`
          this.emitCompatEvent({
            type: 'text_delta',
            session_id: sessionId,
            request_id: state.requestId,
            content: chunk,
          })
        }

        if (deltaType === 'thinking_delta') {
          const chunk = typeof delta.thinking === 'string' ? delta.thinking : ''
          if (block) block.thinking = `${block.thinking || ''}${chunk}`
          this.emitCompatEvent({
            type: 'thinking',
            session_id: sessionId,
            request_id: state.requestId,
            content: block?.thinking || chunk,
          })
        }

        if (deltaType === 'input_json_delta' && block) {
          const partialJson = typeof delta.partial_json === 'string' ? delta.partial_json : ''
          block.inputJson = `${block.inputJson || ''}${partialJson}`
        }

        break
      }

      case 'message.delta': {
        const state = this.ensurePendingMessage(sessionId)
        if (isPlainObject(msg.delta) && typeof msg.delta.stop_reason === 'string') {
          state.stopReason = msg.delta.stop_reason
        }
        if (isPlainObject(msg.usage)) {
          state.usage = {
            ...(state.usage || {}),
            output_tokens: typeof msg.usage.output_tokens === 'number' ? msg.usage.output_tokens : 0,
          }
        }
        break
      }

      case 'message.stop': {
        break
      }

      case 'tool.start': {
        const toolName = typeof msg.tool_name === 'string' ? msg.tool_name : ''
        const toolUseId = typeof msg.tool_use_id === 'string' ? msg.tool_use_id : ''
        const input = isPlainObject(msg.input) ? msg.input : {}
        this.emitCompatEvent({
          type: 'tool_call',
          session_id: sessionId,
          request_id: msg.request_id,
          name: toolName,
          arguments: input,
          call_id: toolUseId,
        })
        break
      }

      case 'tool.end': {
        const toolName = typeof msg.tool_name === 'string' ? msg.tool_name : ''
        const toolUseId = typeof msg.tool_use_id === 'string' ? msg.tool_use_id : ''
        const metadata = isPlainObject(msg.metadata) ? msg.metadata : {}
        const output = typeof msg.output === 'string'
          ? msg.output
          : isPlainObject(msg.error) && typeof msg.error.message === 'string'
            ? msg.error.message
            : ''
        this.emitCompatEvent({
          type: 'tool_result',
          session_id: sessionId,
          request_id: msg.request_id,
          name: toolName,
          content: output,
          call_id: toolUseId,
          is_error: msg.is_error === true || msg.status === 'error',
          status: msg.status,
          duration_ms: msg.duration_ms,
          metadata,
        })
        break
      }

      case 'tool.call': {
        const toolName = typeof msg.tool_name === 'string' ? msg.tool_name : ''
        const toolUseId = typeof msg.tool_use_id === 'string' ? msg.tool_use_id : ''
        const input = isPlainObject(msg.input) ? msg.input : {}
        this.emitCompatEvent({
          type: 'tool_call',
          session_id: sessionId,
          request_id: msg.request_id,
          name: toolName,
          arguments: input,
          call_id: toolUseId,
        })
        void this.executeToolCall(sessionId, toolUseId, toolName, input)
        break
      }

      case 'permission.request': {
        const requestId = typeof msg.request_id === 'string' ? msg.request_id : ''
        const toolName = typeof msg.tool_name === 'string' ? msg.tool_name : ''
        const toolInput = typeof msg.tool_input === 'string' ? msg.tool_input : ''
        const message = typeof msg.message === 'string' ? msg.message : ''
        const isReadOnly = msg.is_read_only === true
        const options = Array.isArray(msg.options)
          ? msg.options.flatMap((option) => {
              if (!isPlainObject(option)) return []
              const label = typeof option.label === 'string' ? option.label : ''
              const scope = option.scope === 'session' ? 'session' : 'once'
              const allow = option.allow === true
              return label ? [{ label, scope, allow }] : []
            })
          : []
        if (requestId) {
          this.pendingPermissionRequests.set(requestId, {
            sessionId,
            toolName,
            toolInput,
            message,
            isReadOnly,
            options,
          })
        }
        this.emitCompatEvent({
          type: 'permission_request',
          session_id: sessionId,
          request_id: requestId,
          name: toolName,
          tool_input: toolInput,
          content: message,
          is_read_only: isReadOnly,
          options,
        })
        break
      }

      case 'task.end': {
        const usage = toUsage(msg.total_usage)
        if (msg.status === 'aborted') {
          this.emitCompatEvent({
            type: 'stopped',
            session_id: sessionId,
            request_id: msg.request_id,
            usage,
          })
        } else {
          this.emitCompatEvent({
            type: 'response_end',
            session_id: sessionId,
            request_id: msg.request_id,
            usage,
            status: msg.status,
            duration_ms: msg.duration_ms,
            num_turns: msg.num_turns,
          })
        }
        this.pendingMessages.delete(sessionId)
        this.knownSessions.set(sessionId, Date.now())
        this.emitSessions()
        break
      }

      case 'error': {
        const error = isPlainObject(msg.error) ? msg.error : {}
        const content = typeof error.message === 'string' ? error.message : 'Unknown websocket error'
        if (this.pendingSessionInitId) {
          this.pendingSessionInitId = ''
          this.sessionCreateInFlight = false
          this.rejectSessionInitWaiters(new Error(content))
        }
        this.emitCompatEvent({
          type: 'error',
          session_id: sessionId,
          request_id: msg.request_id,
          content,
          error,
        })
        break
      }

      case 'pong': {
        const waiter = this.pendingPongWaiters.shift()
        if (waiter) {
          waiter(true)
        }
        this.emitCompatEvent({ type: 'pong' })
        break
      }

      default:
        this.emit('event', msg)
    }
  }

  private ensurePendingMessage(sessionId: string): PendingMessageState {
    const existing = this.pendingMessages.get(sessionId)
    if (existing) return existing
    const next: PendingMessageState = { blocks: new Map<number, PendingContentBlock>() }
    this.pendingMessages.set(sessionId, next)
    return next
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

  async send(content: string, sessionId?: string): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId
    if (!resolvedSessionId) {
      this.emitCompatEvent({ type: 'error', content: 'No active Harnessclaw session' })
      return false
    }

    try {
      await this.ensureSession(resolvedSessionId)
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('Harnessclaw websocket is not open')
      }

      const payload = {
        type: 'user.message',
        event_id: makeEventId(),
        session_id: resolvedSessionId,
        content: {
          type: 'text',
          text: content,
        },
      }
      console.log('[Harnessclaw] → send:', JSON.stringify(payload))
      this.ws.send(JSON.stringify(payload))
      this.knownSessions.set(resolvedSessionId, Date.now())
      return true
    } catch (error) {
      this.emitCompatEvent({
        type: 'error',
        session_id: resolvedSessionId,
        content: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  command(cmd: string, sessionId?: string): void {
    if (cmd.trim() !== '/new') {
      this.emitCompatEvent({ type: 'error', session_id: sessionId, content: `Unsupported command: ${cmd}` })
      return
    }

    if (sessionId) {
      this.knownSessions.set(sessionId, Date.now())
      this.emitSessions()
      this.emitCompatEvent({ type: 'subscribed', session_id: sessionId, subscriptions: [sessionId] })
    }
  }

  async stop(sessionId?: string): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId
    if (!resolvedSessionId) return false

    try {
      await this.ensureSession(resolvedSessionId)
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('Harnessclaw websocket is not open')
      }
      const payload = {
        type: 'session.interrupt',
        event_id: makeEventId(),
        session_id: resolvedSessionId,
      }
      console.log('[Harnessclaw] → send:', JSON.stringify(payload))
      this.ws.send(JSON.stringify(payload))
      return true
    } catch (error) {
      this.emitCompatEvent({
        type: 'error',
        session_id: resolvedSessionId,
        content: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  subscribe(sessionId: string): void {
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

  async probe(timeoutMs = 3000): Promise<boolean> {
    try {
      await this.waitForTransport()
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return false
      }

      return await new Promise<boolean>((resolve) => {
        let settled = false
        const waiter = (ok: boolean): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(ok)
        }
        const timer = setTimeout(() => {
          const index = this.pendingPongWaiters.indexOf(waiter)
          if (index >= 0) {
            this.pendingPongWaiters.splice(index, 1)
          }
          waiter(false)
        }, timeoutMs)

        this.pendingPongWaiters.push(waiter)
        const payload = { type: 'ping', event_id: makeEventId() }
        console.log('[Harnessclaw] → send:', JSON.stringify(payload))
        this.ws?.send(JSON.stringify(payload), (error) => {
          if (!error) return
          const index = this.pendingPongWaiters.indexOf(waiter)
          if (index >= 0) {
            this.pendingPongWaiters.splice(index, 1)
          }
          waiter(false)
        })
      })
    } catch {
      return false
    }
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.pendingMessages.clear()
    this.pendingPermissionRequests.clear()
    this.pendingSessionInitId = ''
    this.sessionCreateInFlight = false
    this.rejectTransportWaiters(new Error('Harnessclaw websocket disconnected by client'))
    this.rejectSessionInitWaiters(new Error('Harnessclaw session initialization cancelled by client'))
    this.resolvePendingPongs(false)
    this.ws?.close()
    this.ws = null
    this.clientId = ''
    this.defaultSessionId = ''
    this.subscriptions = []
    this.setStatus('disconnected')
  }

  getStatus(): { status: HarnessclawStatus; clientId: string; sessionId: string; subscriptions: string[] } {
    return {
      status: this.status,
      clientId: this.clientId,
      sessionId: this.defaultSessionId,
      subscriptions: this.subscriptions,
    }
  }

  private setStatus(status: HarnessclawStatus): void {
    this.status = status
    this.emit('statusChange', status)
  }

  respondPermission(
    requestId: string,
    approved: boolean,
    scope: 'once' | 'session' = 'once',
    message?: string,
  ): boolean {
    const pending = this.pendingPermissionRequests.get(requestId)
    if (!pending || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }

    const payload: Record<string, unknown> = {
      type: 'permission.response',
      event_id: makeEventId(),
      session_id: pending.sessionId,
      request_id: requestId,
      approved,
      scope,
    }
    if (!approved && message) {
      payload.message = message
    }

    console.log('[Harnessclaw] → send:', JSON.stringify(payload))
    this.ws.send(JSON.stringify(payload))
    this.pendingPermissionRequests.delete(requestId)

    this.emitCompatEvent({
      type: 'permission_result',
      session_id: pending.sessionId,
      request_id: requestId,
      name: pending.toolName,
      tool_input: pending.toolInput,
      is_read_only: pending.isReadOnly,
      options: pending.options,
      approved,
      scope,
      content: approved ? 'User approved permission request' : (message || 'User denied permission request'),
    })

    return true
  }

  private sendToolResult(sessionId: string, toolUseId: string, payload: ToolResultPayload): void {
    const message: Record<string, unknown> = {
      type: 'tool.result',
      event_id: makeEventId(),
      session_id: sessionId,
      tool_use_id: toolUseId,
      status: payload.status,
    }
    if (payload.status === 'success') {
      message.output = payload.output || ''
    } else {
      message.error = payload.error
    }
    if (payload.metadata) {
      message.metadata = payload.metadata
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[Harnessclaw] → send:', JSON.stringify(message))
      this.ws.send(JSON.stringify(message))
    }
  }

  private async executeToolCall(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const cfg = this.readConfig()
    if (!cfg) return

    const loweredToolName = toolName.trim().toLowerCase()
    if (cfg.deniedTools.includes(loweredToolName)) {
      const deniedPayload: ToolResultPayload = {
        status: 'denied',
        error: {
          code: 'permission_denied',
          message: `Tool "${toolName}" is denied by local policy`,
        },
      }
      this.emitCompatEvent({
        type: 'tool_result',
        session_id: sessionId,
        name: toolName,
        call_id: toolUseId,
        is_error: true,
        content: deniedPayload.error?.message,
      })
      this.sendToolResult(sessionId, toolUseId, deniedPayload)
      return
    }

    if (cfg.allowedTools.length > 0 && !cfg.allowedTools.includes(loweredToolName)) {
      const deniedPayload: ToolResultPayload = {
        status: 'denied',
        error: {
          code: 'permission_denied',
          message: `Tool "${toolName}" is not in allowed_tools`,
        },
      }
      this.emitCompatEvent({
        type: 'tool_result',
        session_id: sessionId,
        name: toolName,
        call_id: toolUseId,
        is_error: true,
        content: deniedPayload.error?.message,
      })
      this.sendToolResult(sessionId, toolUseId, deniedPayload)
      return
    }

    let result: ToolResultPayload
    try {
      switch (loweredToolName) {
        case 'bash':
          result = await this.runBashTool(input, Math.min(cfg.bashTimeoutMs, cfg.toolTimeoutMs))
          break
        case 'file_read':
          result = await this.runFileReadTool(input)
          break
        case 'file_write':
          result = await this.runFileWriteTool(input)
          break
        case 'file_edit':
          result = await this.runFileEditTool(input)
          break
        case 'glob':
          result = await this.runGlobTool(input)
          break
        case 'grep':
          result = await this.runGrepTool(input, Math.min(30_000, cfg.toolTimeoutMs))
          break
        case 'web_fetch':
          result = await this.runWebFetchTool(input, Math.min(cfg.webFetchTimeoutMs, cfg.toolTimeoutMs))
          break
        default:
          result = {
            status: 'error',
            error: {
              code: 'unsupported_tool',
              message: `Unsupported local tool: ${toolName}`,
            },
          }
      }
    } catch (err) {
      result = {
        status: 'error',
        error: {
          code: 'tool_execution_failed',
          message: String(err),
        },
      }
    }

    this.emitCompatEvent({
      type: 'tool_result',
      session_id: sessionId,
      name: toolName,
      call_id: toolUseId,
      is_error: result.status !== 'success',
      content: result.status === 'success' ? (result.output || '') : (result.error?.message || 'Tool execution failed'),
    })
    this.sendToolResult(sessionId, toolUseId, result)
  }

  private async runBashTool(input: Record<string, unknown>, timeoutMs: number): Promise<ToolResultPayload> {
    const command = typeof input.command === 'string' ? input.command.trim() : ''
    if (!command) {
      return {
        status: 'error',
        error: {
          code: 'invalid_tool_input',
          message: 'bash tool requires a non-empty command',
        },
      }
    }

    if (/(^|\s)(rm\s+-rf\s+\/|mkfs|shutdown|reboot)(\s|$)/i.test(command)) {
      return {
        status: 'denied',
        error: {
          code: 'permission_denied',
          message: `Dangerous bash command blocked by local policy: ${command}`,
        },
      }
    }

    return new Promise((resolvePromise) => {
      const startedAt = Date.now()
      const child = spawn(process.env.SHELL || 'zsh', ['-lc', command], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: homedir() },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGTERM')
        resolvePromise({
          status: 'timeout',
          error: {
            code: 'execution_timeout',
            message: `Command timed out after ${timeoutMs}ms`,
          },
          metadata: {
            duration_ms: Date.now() - startedAt,
          },
        })
      }, timeoutMs)

      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise({
          status: 'error',
          error: {
            code: 'spawn_failed',
            message: String(err),
          },
          metadata: {
            duration_ms: Date.now() - startedAt,
          },
        })
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)

        const combined = combineOutput(stdout, stderr)
        const trimmed = trimOutput(combined)
        const metadata = {
          exit_code: code ?? null,
          duration_ms: Date.now() - startedAt,
          truncated: trimmed.truncated,
        }

        if (code === 0) {
          resolvePromise({
            status: 'success',
            output: trimmed.text,
            metadata,
          })
          return
        }

        resolvePromise({
          status: 'error',
          error: {
            code: 'command_failed',
            message: trimmed.text || `Command exited with code ${code ?? 'unknown'}`,
          },
          metadata,
        })
      })
    })
  }

  private async runFileReadTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const path = typeof input.path === 'string' ? input.path : ''
    if (!path) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'file_read requires path' },
      }
    }

    const absolutePath = resolve(path)
    const content = readFileSync(absolutePath, 'utf-8')
    const limit = typeof input.limit === 'number' && input.limit > 0 ? input.limit : undefined
    const trimmed = trimOutput(limit ? content.slice(0, limit) : content, limit || 200_000)
    return {
      status: 'success',
      output: trimmed.text,
      metadata: {
        path: absolutePath,
        truncated: trimmed.truncated || (typeof limit === 'number' && content.length > limit),
      },
    }
  }

  private async runFileWriteTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const path = typeof input.path === 'string' ? input.path : ''
    const content = typeof input.content === 'string' ? input.content : ''
    if (!path) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'file_write requires path' },
      }
    }

    const absolutePath = resolve(path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content, 'utf-8')
    return {
      status: 'success',
      output: content,
      metadata: {
        path: absolutePath,
        bytes: Buffer.byteLength(content, 'utf-8'),
      },
    }
  }

  private async runFileEditTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const path = typeof input.path === 'string' ? input.path : ''
    const oldString = typeof input.old_string === 'string' ? input.old_string : typeof input.search === 'string' ? input.search : ''
    const newString = typeof input.new_string === 'string' ? input.new_string : typeof input.replace === 'string' ? input.replace : ''
    const replaceAll = input.replace_all === true
    if (!path || !oldString) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'file_edit requires path and old_string/search' },
      }
    }

    const absolutePath = resolve(path)
    const original = readFileSync(absolutePath, 'utf-8')
    if (!original.includes(oldString)) {
      return {
        status: 'error',
        error: { code: 'match_not_found', message: 'Target text not found in file' },
      }
    }

    const next = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString)
    writeFileSync(absolutePath, next, 'utf-8')
    return {
      status: 'success',
      output: next,
      metadata: {
        path: absolutePath,
        replace_all: replaceAll,
      },
    }
  }

  private async runGlobTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const pattern = typeof input.pattern === 'string' ? input.pattern : ''
    const basePath = typeof input.path === 'string' ? input.path : process.cwd()
    if (!pattern) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'glob requires pattern' },
      }
    }

    const command = `rg --files ${this.escapeShellArg(resolve(basePath))} -g ${this.escapeShellArg(pattern)}`
    return this.runBashTool({ command }, 15_000)
  }

  private async runGrepTool(input: Record<string, unknown>, timeoutMs: number): Promise<ToolResultPayload> {
    const pattern = typeof input.pattern === 'string' ? input.pattern : ''
    const path = typeof input.path === 'string' ? input.path : process.cwd()
    if (!pattern) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'grep requires pattern' },
      }
    }

    const glob = typeof input.glob === 'string' ? input.glob : ''
    const commandParts = [
      'rg',
      '-n',
      this.escapeShellArg(pattern),
      this.escapeShellArg(resolve(path)),
    ]
    if (glob) {
      commandParts.push('-g', this.escapeShellArg(glob))
    }
    return this.runBashTool({ command: commandParts.join(' ') }, timeoutMs)
  }

  private async runWebFetchTool(input: Record<string, unknown>, timeoutMs: number): Promise<ToolResultPayload> {
    const url = typeof input.url === 'string' ? input.url : ''
    if (!url) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'web_fetch requires url' },
      }
    }

    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { signal: controller.signal })
      const text = await response.text()
      const trimmed = trimOutput(text, 120_000)
      return {
        status: response.ok ? 'success' : 'error',
        output: response.ok ? trimmed.text : undefined,
        error: response.ok ? undefined : {
          code: 'http_error',
          message: `${response.status} ${response.statusText}\n${trimmed.text}`,
        },
        metadata: {
          status_code: response.status,
          duration_ms: Date.now() - startedAt,
          truncated: trimmed.truncated,
        },
      }
    } catch (err) {
      return {
        status: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'error',
        error: {
          code: err instanceof Error && err.name === 'AbortError' ? 'execution_timeout' : 'fetch_failed',
          message: String(err),
        },
        metadata: {
          duration_ms: Date.now() - startedAt,
        },
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private escapeShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
  }

  private readConfig(): HarnessclawConfig | null {
    try {
      const raw = readNanobotConfig({})

      const channels = isPlainObject(raw.channels) ? raw.channels : {}
      const websocket = isPlainObject(channels.websocket)
        ? channels.websocket
        : isPlainObject(channels.harnessclaw)
          ? channels.harnessclaw
          : {}
      const permission = isPlainObject(raw.permission) ? raw.permission : {}
      const tools = isPlainObject(raw.tools) ? raw.tools : {}
      const engine = isPlainObject(raw.engine) ? raw.engine : {}
      const bash = isPlainObject(tools.bash) ? tools.bash : {}
      const webFetch = isPlainObject(tools.web_fetch) ? tools.web_fetch : {}

      return {
        enabled: typeof websocket.enabled === 'boolean' ? websocket.enabled : true,
        host: HARNESSCLAW_WS_HOST,
        port: HARNESSCLAW_WS_PORT,
        path: HARNESSCLAW_WS_PATH,
        token: typeof websocket.token === 'string'
          ? websocket.token
          : typeof raw.token === 'string'
            ? raw.token
            : '',
        userId: typeof websocket.user_id === 'string'
          ? websocket.user_id
          : typeof websocket.userId === 'string'
            ? websocket.userId
            : '',
        toolTimeoutMs: parseDurationMs(engine.tool_timeout, 120_000),
        bashTimeoutMs: parseDurationMs(bash.timeout, 60_000),
        webFetchTimeoutMs: parseDurationMs(webFetch.timeout, 30_000),
        allowedTools: asStringArray(permission.allowed_tools).map((value) => value.toLowerCase()),
        deniedTools: asStringArray(permission.denied_tools).map((value) => value.toLowerCase()),
      }
    } catch {
      return null
    }
  }
}

export const harnessclawClient = new HarnessclawClient()
