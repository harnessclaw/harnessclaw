import { WebSocket } from 'ws'
import { readFileSync, existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { ENGINE_CONFIG_PATH } from './runtime-paths'

interface HarnessclawConfig {
  enabled: boolean
  host: string
  port: number
  token: string
  allowFrom: string[]
}

type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

const DEFAULT_HARNESSCLAW_CONFIG: HarnessclawConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 18765,
  token: '',
  allowFrom: ['*'],
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export class HarnessclawClient extends EventEmitter {
  private ws: WebSocket | null = null
  private status: HarnessclawStatus = 'disconnected'
  private clientId = ''
  private defaultSessionId = ''
  private subscriptions: string[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private shouldReconnect = false

  connect(): void {
    if (this.status === 'connected') return
    this.shouldReconnect = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.retryCount = 0
    this.attemptConnect()
  }

  private attemptConnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }

    const cfg = this.readConfig()
    const url = `ws://${cfg.host}:${cfg.port}`
    console.log(`[Harnessclaw] Connecting to ${url} (attempt ${this.retryCount + 1})`)
    this.setStatus('connecting')

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      console.log('[Harnessclaw] WebSocket opened')
      this.retryCount = 0
      if (cfg.token) {
        this.ws?.send(JSON.stringify({ type: 'auth', token: cfg.token }))
      }
    })

    this.ws.on('message', (data) => {
      try {
        const raw = data.toString()
        console.log('[Harnessclaw] ← recv:', raw)
        const msg = JSON.parse(raw)
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
      this.ws = null
      this.clientId = ''
      this.defaultSessionId = ''
      this.subscriptions = []
      this.setStatus('disconnected')
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (!this.shouldReconnect) return
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
    }
    // Gateway startup can lag behind Electron on every platform, so retries stay open-ended.
    const delay = Math.min(Math.floor(this.retryCount / 2) + 1, 5) * 1000
    console.log(`[Harnessclaw] Retry in ${delay}ms...`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.retryCount++
      this.attemptConnect()
    }, delay)
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string

    if (type === 'connected') {
      this.clientId = msg.client_id as string
      this.defaultSessionId = msg.session_id as string
      this.subscriptions = [this.defaultSessionId]
      this.setStatus('connected')
      console.log('[Harnessclaw] Connected, client_id:', this.clientId, 'session_id:', this.defaultSessionId)
    }

    if (type === 'subscribed') {
      this.subscriptions = (msg.subscriptions as string[]) || this.subscriptions
    }

    if (type === 'unsubscribed') {
      this.subscriptions = (msg.subscriptions as string[]) || this.subscriptions
    }

    // Forward all events to renderer
    this.emit('event', msg)
  }

  private sendJson(payload: Record<string, string>): void {
    if (!this.ws || this.status !== 'connected') {
      this.emit('event', { type: 'error', content: 'Not connected to Harnessclaw' })
      return
    }

    const raw = JSON.stringify(payload)
    console.log('[Harnessclaw] → send:', raw)
    try {
      this.ws.send(raw)
    } catch (err) {
      console.error('[Harnessclaw] Send failed:', err)
      this.emit('event', { type: 'error', content: `Harnessclaw send failed: ${String(err)}` })
    }
  }

  send(content: string, sessionId?: string): void {
    const payload: Record<string, string> = { type: 'message', content }
    if (sessionId) payload.session_id = sessionId
    this.sendJson(payload)
  }

  command(cmd: string, sessionId?: string): void {
    const payload: Record<string, string> = { type: 'command', command: cmd }
    if (sessionId) payload.session_id = sessionId
    this.sendJson(payload)
  }

  stop(sessionId?: string): void {
    const payload: Record<string, string> = { type: 'stop' }
    if (sessionId) payload.session_id = sessionId
    this.sendJson(payload)
  }

  subscribe(sessionId: string): void {
    this.sendJson({ type: 'subscribe', session_id: sessionId })
  }

  unsubscribe(sessionId: string): void {
    this.sendJson({ type: 'unsubscribe', session_id: sessionId })
  }

  listSessions(): void {
    this.sendJson({ type: 'list_sessions' })
  }

  ping(): void {
    this.sendJson({ type: 'ping' })
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.ws?.close()
    this.ws = null
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

  private readConfig(): HarnessclawConfig {
    try {
      const configPath = existsSync(ENGINE_CONFIG_PATH) ? ENGINE_CONFIG_PATH : null
      if (!configPath) return DEFAULT_HARNESSCLAW_CONFIG

      const raw = asRecord(JSON.parse(readFileSync(configPath, 'utf-8')))
      const harnessclaw = asRecord(asRecord(raw.channels).harnessclaw)
      const allowFrom = Array.isArray(harnessclaw.allowFrom)
        ? harnessclaw.allowFrom.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : DEFAULT_HARNESSCLAW_CONFIG.allowFrom
      return {
        enabled: typeof harnessclaw.enabled === 'boolean' ? harnessclaw.enabled : DEFAULT_HARNESSCLAW_CONFIG.enabled,
        host: typeof harnessclaw.host === 'string' && harnessclaw.host.trim()
          ? harnessclaw.host
          : DEFAULT_HARNESSCLAW_CONFIG.host,
        port: typeof harnessclaw.port === 'number' ? harnessclaw.port : DEFAULT_HARNESSCLAW_CONFIG.port,
        token: typeof harnessclaw.token === 'string' ? harnessclaw.token : DEFAULT_HARNESSCLAW_CONFIG.token,
        allowFrom: allowFrom.length > 0 ? allowFrom : DEFAULT_HARNESSCLAW_CONFIG.allowFrom,
      }
    } catch {
      return DEFAULT_HARNESSCLAW_CONFIG
    }
  }
}

export const harnessclawClient = new HarnessclawClient()
