import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { app } from 'electron'
import {
  DEFAULT_BROWSER_AGENT_CDP_PORT,
  type BrowserAgentAskHumanResult,
  type BrowserAgentCloseResult,
  type BrowserAgentCloseSessionsResult,
  type BrowserAgentSessionInfo,
  type BrowserAgentSessionManagerLike,
  type BrowserAgentSessionPrivateMetadata,
} from './browser-agent-session'
import { writeAppLog } from './logging'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type HelperResponse = {
  id?: string
  ok?: boolean
  result?: unknown
  error?: { code?: string; message?: string }
  event?: string
  session?: BrowserAgentSessionInfo
}

type SessionResponse = {
  session: BrowserAgentSessionInfo
  metadata?: BrowserAgentSessionPrivateMetadata
}

type CloseResponse = {
  result: BrowserAgentCloseResult
}

type CloseSessionsResponse = {
  result: BrowserAgentCloseSessionsResult
}

interface BrowserAgentHelperClientOptions {
  onSessionChanged?: (session: BrowserAgentSessionInfo) => void
}

export class BrowserAgentHelperClient implements BrowserAgentSessionManagerLike {
  private readonly onSessionChanged?: (session: BrowserAgentSessionInfo) => void
  private readonly sessionsByID = new Map<string, BrowserAgentSessionInfo>()
  private readonly privateMetadataBySessionID = new Map<string, BrowserAgentSessionPrivateMetadata>()
  private readonly pending = new Map<string, PendingRequest>()
  private child: ChildProcess | null = null
  private startPromise: Promise<void> | null = null
  private cdpPort = 0
  private token = ''

  constructor(options: BrowserAgentHelperClientOptions = {}) {
    this.onSessionChanged = options.onSessionChanged
  }

  async createSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const response = await this.request<SessionResponse>('createSession', input)
    this.cacheSessionResponse(response)
    return response.session
  }

  async closeSession(input: Record<string, unknown>): Promise<BrowserAgentCloseResult> {
    const response = await this.request<CloseResponse>('close', input)
    this.sessionsByID.delete(response.result.session_id)
    this.privateMetadataBySessionID.delete(response.result.session_id)
    return response.result
  }

  async askHuman(input: Record<string, unknown>): Promise<BrowserAgentAskHumanResult> {
    const response = await this.request<{ result: BrowserAgentAskHumanResult }>('askHuman', input)
    return response.result
  }

  async getSessionState(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const response = await this.request<SessionResponse>('state', input)
    this.cacheSessionResponse(response)
    return response.session
  }

  listSessions(): BrowserAgentSessionInfo[] {
    return [...this.sessionsByID.values()]
  }

  async setVisibility(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const response = await this.request<SessionResponse>('visibility', input)
    this.cacheSessionResponse(response)
    return response.session
  }

  async hideSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    return this.setVisibility({ ...input, visible: false })
  }

  hideSessionsForTurn(turnID: string): void {
    if (!this.child) return
    void this.request('hideSessionsForTurn', { turn_id: turnID }).catch((error) => {
      writeAppLog('warn', 'browser-agent.helper', 'Failed to hide helper sessions for turn', {
        error: error.message,
      })
    })
  }

  async closeSessions(input: Record<string, unknown>): Promise<BrowserAgentCloseSessionsResult> {
    if (!this.child && !hasSessionIDs(input.session_ids)) {
      return { closed_session_ids: [], missing_session_ids: [] }
    }
    const response = await this.request<CloseSessionsResponse>('closeSessions', input)
    for (const sessionID of response.result.closed_session_ids) {
      this.sessionsByID.delete(sessionID)
      this.privateMetadataBySessionID.delete(sessionID)
    }
    return response.result
  }

  async finishHumanTakeover(requestID: string, status: 'success' | 'cancelled'): Promise<void> {
    if (!this.child) return
    await this.request('finishHumanTakeover', { request_id: requestID, status })
  }

  getSessionPrivateMetadata(sessionID: string): BrowserAgentSessionPrivateMetadata | undefined {
    return this.privateMetadataBySessionID.get(sessionID)
  }

  closeAll(): void {
    if (!this.child) return
    const child = this.child
    void this.request('closeAll', {}).catch(() => undefined).finally(() => {
      if (!child.killed) {
        child.kill()
      }
    })
    this.resetState()
  }

  private cacheSessionResponse(response: SessionResponse): void {
    this.sessionsByID.set(response.session.session_id, response.session)
    if (response.metadata) {
      this.privateMetadataBySessionID.set(response.session.session_id, response.metadata)
    }
  }

  private async request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.ensureStarted()
    if (!this.child?.stdin) {
      throw new Error('Browser Agent helper is not running')
    }
    const id = randomUUID()
    const payload = JSON.stringify({ id, token: this.token, method, params })
    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.child?.stdin?.write(`${payload}\n`, (error) => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return
    if (this.startPromise) {
      await this.startPromise
      return
    }
    this.startPromise = this.start()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async start(): Promise<void> {
    this.cdpPort = await resolveHelperCDPPort()
    this.token = randomUUID()
    const args = app.isPackaged
      ? ['--browser-agent-helper']
      : [app.getAppPath(), '--browser-agent-helper']
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HARNESSCLAW_BROWSER_AGENT_HELPER: '1',
        HARNESSCLAW_BROWSER_AGENT_CDP_PORT: String(this.cdpPort),
        HARNESSCLAW_BROWSER_AGENT_HELPER_TOKEN: this.token,
      },
    })
    this.child = child

    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line))
    child.stderr?.on('data', (chunk) => {
      writeAppLog('debug', 'browser-agent.helper.stderr', String(chunk).trim())
    })
    child.on('exit', (code, signal) => {
      writeAppLog('info', 'browser-agent.helper', 'Browser Agent helper exited', { code, signal })
      this.failPending(new Error('Browser Agent helper exited'))
      this.resetState()
    })
    child.on('error', (error) => {
      this.failPending(error)
      this.resetState()
    })

    writeAppLog('info', 'browser-agent.helper', 'Browser Agent helper started', {
      cdp_port: this.cdpPort,
      pid: child.pid,
    })
  }

  private handleLine(line: string): void {
    if (!line.trim()) return
    let message: HelperResponse
    try {
      message = JSON.parse(line) as HelperResponse
    } catch (error) {
      writeAppLog('warn', 'browser-agent.helper', 'Invalid helper JSON line', {
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    if (message.event === 'sessionChanged' && message.session) {
      this.sessionsByID.set(message.session.session_id, message.session)
      if (message.session.closed) {
        this.sessionsByID.delete(message.session.session_id)
        this.privateMetadataBySessionID.delete(message.session.session_id)
      }
      this.onSessionChanged?.(message.session)
      return
    }
    if (!message.id) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.ok === false) {
      pending.reject(new Error(message.error?.message || 'Browser Agent helper request failed'))
      return
    }
    pending.resolve(message.result)
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }

  private resetState(): void {
    this.child = null
    this.sessionsByID.clear()
    this.privateMetadataBySessionID.clear()
  }
}

async function resolveHelperCDPPort(): Promise<number> {
  const envPort = normalizePort(process.env.HARNESSCLAW_BROWSER_HELPER_CDP_PORT)
  if (envPort) return envPort
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : DEFAULT_BROWSER_AGENT_CDP_PORT
      server.close(() => resolve(port))
    })
  })
}

function normalizePort(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 0
}

function hasSessionIDs(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim())
}
