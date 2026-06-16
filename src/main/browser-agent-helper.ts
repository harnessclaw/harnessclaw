import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import {
  BrowserAgentSessionError,
  BrowserAgentSessionManager,
  DEFAULT_BROWSER_AGENT_CDP_PORT,
  createWebContentsTargetEndpointResolver,
  type BrowserAgentSessionInfo,
} from './browser-agent-session'

type HelperRequest = {
  id?: string
  token?: string
  method?: string
  params?: Record<string, unknown>
}

let manager: BrowserAgentSessionManager | null = null

export async function runBrowserAgentHelper(): Promise<void> {
  const port = resolveHelperCDPPort()
  const token = process.env.HARNESSCLAW_BROWSER_AGENT_HELPER_TOKEN || ''
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', String(port))

  await app.whenReady()
  manager = new BrowserAgentSessionManager({
    createWindow: (options) => new BrowserWindow(options as BrowserWindowConstructorOptions),
    resolveCDPEndpoint: createWebContentsTargetEndpointResolver(port),
    onSessionChanged: (session) => sendEvent('sessionChanged', { session }),
  })

  app.on('window-all-closed', () => undefined)
  app.on('will-quit', () => {
    manager?.closeAll()
  })

  process.stdin.setEncoding('utf8')
  let buffer = ''
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      void handleLine(line, token)
      newline = buffer.indexOf('\n')
    }
  })
  process.stdin.on('end', () => {
    app.quit()
  })
}

async function handleLine(line: string, token: string): Promise<void> {
  if (!line.trim()) return
  let request: HelperRequest
  try {
    request = JSON.parse(line) as HelperRequest
  } catch (error) {
    sendError(undefined, 'invalid_json', error instanceof Error ? error.message : String(error))
    return
  }
  if (token && request.token !== token) {
    sendError(request.id, 'unauthorized', 'Invalid Browser Agent helper token')
    return
  }
  if (!request.id) {
    sendError(undefined, 'invalid_request', 'id is required')
    return
  }
  try {
    const result = await dispatch(request.method || '', request.params || {})
    sendResponse(request.id, result)
  } catch (error) {
    const code = error instanceof BrowserAgentSessionError ? error.code : 'helper_error'
    const message = error instanceof Error ? error.message : String(error)
    sendError(request.id, code, message)
  }
}

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!manager) {
    throw new BrowserAgentSessionError('helper_not_ready', 'Browser Agent helper is not ready')
  }
  switch (method) {
    case 'createSession': {
      const session = await manager.createSession(params)
      return sessionResult(session)
    }
    case 'state': {
      const session = manager.getSessionState(params)
      return sessionResult(session)
    }
    case 'visibility': {
      const session = manager.setVisibility(params)
      return sessionResult(session)
    }
    case 'askHuman':
      return { result: manager.askHuman(params) }
    case 'close':
      return { result: manager.closeSession(params) }
    case 'closeSessions':
      return { result: manager.closeSessions(params) }
    case 'list':
      return { sessions: manager.listSessions() }
    case 'hideSessionsForTurn':
      manager.hideSessionsForTurn(stringParam(params, 'turn_id'))
      return { ok: true }
    case 'finishHumanTakeover':
      manager.finishHumanTakeover(stringParam(params, 'request_id'), params.status === 'success' ? 'success' : 'cancelled')
      return { ok: true }
    case 'closeAll':
      manager.closeAll()
      return { ok: true }
    default:
      throw new BrowserAgentSessionError('unknown_method', `Unknown helper method: ${method}`)
  }
}

function sessionResult(session: BrowserAgentSessionInfo): Record<string, unknown> {
  return {
    session,
    metadata: manager?.getSessionPrivateMetadata(session.session_id),
  }
}

function resolveHelperCDPPort(): number {
  const raw = process.env.HARNESSCLAW_BROWSER_AGENT_CDP_PORT
  if (!raw) return DEFAULT_BROWSER_AGENT_CDP_PORT
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_BROWSER_AGENT_CDP_PORT
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  return typeof value === 'string' ? value.trim() : ''
}

function sendEvent(event: string, payload: Record<string, unknown>): void {
  send({ event, ...payload })
}

function sendResponse(id: string, result: unknown): void {
  send({ id, ok: true, result })
}

function sendError(id: string | undefined, code: string, message: string): void {
  send({ id, ok: false, error: { code, message } })
}

function send(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}
