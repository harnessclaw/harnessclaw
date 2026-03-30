import { WebSocket } from 'ws'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

interface EmmaConfig {
  enabled: boolean
  host: string
  port: number
  token: string
  allowFrom: string[]
}

type EmmaStatus = 'disconnected' | 'connecting' | 'connected'

export class EmmaClient extends EventEmitter {
  private ws: WebSocket | null = null
  private status: EmmaStatus = 'disconnected'
  private clientId = ''
  private defaultSessionId = ''
  private subscriptions: string[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private maxRetries = 20
  private shouldReconnect = false

  connect(): void {
    if (this.status === 'connected') return
    this.shouldReconnect = true
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
    if (!cfg) {
      this.emit('event', { type: 'error', content: 'Emma channel not found in config' })
      return
    }

    const url = `ws://${cfg.host}:${cfg.port}`
    console.log(`[Emma] Connecting to ${url} (attempt ${this.retryCount + 1})`)
    this.setStatus('connecting')

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      console.log('[Emma] WebSocket opened')
      this.retryCount = 0
      if (cfg.token) {
        this.ws?.send(JSON.stringify({ type: 'auth', token: cfg.token }))
      }
    })

    this.ws.on('message', (data) => {
      try {
        const raw = data.toString()
        console.log('[Emma] ← recv:', raw)
        const msg = JSON.parse(raw)
        this.handleMessage(msg)
      } catch (e) {
        console.error('[Emma] Failed to parse message:', e)
      }
    })

    this.ws.on('error', (err) => {
      console.error('[Emma] WebSocket error:', err.message)
    })

    this.ws.on('close', (code, reason) => {
      console.log('[Emma] WebSocket closed:', code, reason.toString())
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
    if (this.retryCount >= this.maxRetries) {
      console.warn('[Emma] Max retries reached, giving up')
      return
    }
    // Backoff: 1s, 1s, 2s, 2s, 3s... capped at 5s
    const delay = Math.min(Math.floor(this.retryCount / 2) + 1, 5) * 1000
    console.log(`[Emma] Retry in ${delay}ms...`)
    this.retryTimer = setTimeout(() => {
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
      console.log('[Emma] Connected, client_id:', this.clientId, 'session_id:', this.defaultSessionId)
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

  send(content: string, sessionId?: string): void {
    if (!this.ws || this.status !== 'connected') {
      this.emit('event', { type: 'error', content: 'Not connected to Emma' })
      return
    }
    const payload: Record<string, string> = { type: 'message', content }
    if (sessionId) payload.session_id = sessionId
    console.log('[Emma] → send:', JSON.stringify(payload))
    this.ws.send(JSON.stringify(payload))
  }

  command(cmd: string, sessionId?: string): void {
    if (!this.ws || this.status !== 'connected') return
    const payload: Record<string, string> = { type: 'command', command: cmd }
    if (sessionId) payload.session_id = sessionId
    console.log('[Emma] → send:', JSON.stringify(payload))
    this.ws.send(JSON.stringify(payload))
  }

  stop(sessionId?: string): void {
    if (!this.ws || this.status !== 'connected') return
    const payload: Record<string, string> = { type: 'stop' }
    if (sessionId) payload.session_id = sessionId
    console.log('[Emma] → send:', JSON.stringify(payload))
    this.ws.send(JSON.stringify(payload))
  }

  subscribe(sessionId: string): void {
    if (!this.ws || this.status !== 'connected') return
    this.ws.send(JSON.stringify({ type: 'subscribe', session_id: sessionId }))
  }

  unsubscribe(sessionId: string): void {
    if (!this.ws || this.status !== 'connected') return
    this.ws.send(JSON.stringify({ type: 'unsubscribe', session_id: sessionId }))
  }

  listSessions(): void {
    if (!this.ws || this.status !== 'connected') return
    this.ws.send(JSON.stringify({ type: 'list_sessions' }))
  }

  ping(): void {
    if (!this.ws || this.status !== 'connected') return
    this.ws.send(JSON.stringify({ type: 'ping' }))
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

  getStatus(): { status: EmmaStatus; clientId: string; sessionId: string; subscriptions: string[] } {
    return {
      status: this.status,
      clientId: this.clientId,
      sessionId: this.defaultSessionId,
      subscriptions: this.subscriptions,
    }
  }

  private setStatus(status: EmmaStatus): void {
    this.status = status
    this.emit('statusChange', status)
  }

  private readConfig(): EmmaConfig | null {
    try {
      const cfgPath = join(homedir(), '.nanobot', 'config.json')
      if (!existsSync(cfgPath)) return null
      const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'))
      const emma = raw?.channels?.emma
      if (!emma) return null
      return {
        enabled: emma.enabled ?? false,
        host: emma.host ?? '127.0.0.1',
        port: emma.port ?? 18765,
        token: emma.token ?? '',
        allowFrom: emma.allowFrom ?? ['*'],
      }
    } catch {
      return null
    }
  }
}

export const emmaClient = new EmmaClient()
