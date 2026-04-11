import { WebSocket } from 'ws'
import { createPrivateKey, createPublicKey, sign, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

interface DeviceCredentials {
  deviceId: string
  privateKeyPem: string
  publicKeyPem: string
  token: string
}

interface GatewayRequest {
  type: 'req'
  id: string
  method: string
  params: Record<string, unknown>
}

interface GatewayResponse {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { code: string; message: string }
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null
  private credentials: DeviceCredentials | null = null
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout }
  >()
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private authFailed = false
  private status: ConnectionStatus = 'disconnected'
  private heartbeatTimer: NodeJS.Timeout | null = null

  public gatewayUrl = 'ws://127.0.0.1:18789'

  constructor() {
    super()
    this.loadCredentials()
  }

  private loadCredentials(): void {
    try {
      const devicePath = join(homedir(), '.clawdbot', 'identity', 'device.json')
      const authPath = join(homedir(), '.clawdbot', 'identity', 'device-auth.json')

      const device = JSON.parse(readFileSync(devicePath, 'utf-8'))
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'))

      this.credentials = {
        deviceId: device.deviceId,
        privateKeyPem: device.privateKeyPem,
        publicKeyPem: device.publicKeyPem,
        token: auth.tokens?.operator?.token || ''
      }
      console.log('[Gateway] Credentials loaded, deviceId:', device.deviceId.slice(0, 8) + '...')
    } catch (e) {
      console.error('[Gateway] Failed to load credentials:', e)
    }
  }

  private getPublicKeyB64(): string {
    if (!this.credentials) throw new Error('No credentials')
    const pubKey = createPublicKey(this.credentials.publicKeyPem)
    const der = pubKey.export({ type: 'spki', format: 'der' }) as Buffer
    const rawKey = der.slice(-32)
    return rawKey.toString('base64url')
  }

  private signNonce(nonce: string): string {
    if (!this.credentials) throw new Error('No credentials')
    const privateKey = createPrivateKey(this.credentials.privateKeyPem)
    const message = Buffer.from(nonce, 'utf8')
    const signature = sign(null, message, { key: privateKey })
    return signature.toString('base64url')
  }

  connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') return
    if (!this.credentials) {
      console.warn('[Gateway] No credentials loaded, skipping connection')
      this.setStatus('disconnected')
      return
    }
    this.authFailed = false
    this.setStatus('connecting')
    this.createConnection()
  }

  private createConnection(): void {
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
    }

    console.log('[Gateway] Connecting to', this.gatewayUrl)
    this.ws = new WebSocket(this.gatewayUrl)

    this.ws.on('open', () => {
      console.log('[Gateway] WebSocket opened, waiting for challenge...')
      this.reconnectAttempts = 0
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.handleMessage(msg)
      } catch (e) {
        console.error('[Gateway] Failed to parse message:', e)
      }
    })

    this.ws.on('error', (err) => {
      console.error('[Gateway] WebSocket error:', err.message)
    })

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason.toString()
      console.log('[Gateway] WebSocket closed:', code, reasonStr)
      this.setStatus('disconnected')
      this.stopHeartbeat()
      // 1008 = policy violation (device signature invalid) — permanent auth failure, don't retry
      if (code === 1008) {
        console.warn('[Gateway] Auth failed permanently, will not reconnect:', reasonStr)
        this.authFailed = true
        return
      }
      this.scheduleReconnect()
    })
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string

    if (type === 'event') {
      const event = msg.event as string

      if (event === 'connect.challenge') {
        this.handleChallenge(msg.payload as { nonce: string; ts: number })
        return
      }

      this.emit('event', msg)
      return
    }

    if (type === 'res') {
      const res = msg as unknown as GatewayResponse
      const pending = this.pendingRequests.get(res.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(res.id)
        if (res.ok) {
          pending.resolve(res.payload)
        } else {
          pending.reject(new Error(res.error?.message || 'Request failed'))
        }
      }
    }
  }

  private handleChallenge(payload: { nonce: string; ts: number }): void {
    if (!this.credentials) {
      console.error('[Gateway] No credentials for challenge, giving up')
      this.authFailed = true
      this.ws?.close()
      this.setStatus('disconnected')
      return
    }

    const { nonce } = payload
    const signedAt = Date.now()

    try {
      const signature = this.signNonce(nonce)
      const publicKey = this.getPublicKeyB64()

      const connectRequest: GatewayRequest = {
        type: 'req',
        id: randomUUID(),
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'clawdbot-control-ui',
            version: '1.0.0',
            platform: process.platform,
            mode: 'webchat'
          },
          device: {
            id: this.credentials.deviceId,
            publicKey,
            signature,
            signedAt,
            nonce
          },
          role: 'operator',
          scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
          caps: [],
          auth: {
            token: this.credentials.token
          },
          userAgent: `Electron/harnessclaw (${process.platform})`,
          locale: 'zh-CN'
        }
      }

      this.ws?.send(JSON.stringify(connectRequest))

      this.waitForResponse(connectRequest.id, 10000)
        .then((response) => {
          console.log('[Gateway] Connected!', JSON.stringify(response).slice(0, 200))
          this.setStatus('connected')
          this.startHeartbeat()
          this.emit('connected', response)
        })
        .catch((e) => {
          console.error('[Gateway] Connection failed:', e)
          this.setStatus('disconnected')
          this.scheduleReconnect()
        })
    } catch (e) {
      console.error('[Gateway] Challenge handling failed:', e)
      this.setStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private waitForResponse(id: string, timeout = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error('Request timeout'))
      }, timeout)
      this.pendingRequests.set(id, { resolve, reject, timer })
    })
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.status !== 'connected') {
      throw new Error('Not connected to Gateway')
    }

    const id = crypto.randomUUID()
    const request: GatewayRequest = { type: 'req', id, method, params }

    this.ws?.send(JSON.stringify(request))
    return this.waitForResponse(id)
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status
    this.emit('statusChange', status)
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  private scheduleReconnect(): void {
    if (this.authFailed) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Gateway] Max reconnect attempts reached')
      return
    }

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      if (!this.authFailed) this.createConnection()
    }, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.request('ping', {}).catch(() => {})
      }
    }, 30000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stopHeartbeat()
    this.ws?.close()
    this.setStatus('disconnected')
  }
}

export const gatewayClient = new GatewayClient()
