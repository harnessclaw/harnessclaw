import http from 'node:http'

const DEFAULT_PORT = 8090
const API_PREFIX = '/console/v1'

let currentPort = DEFAULT_PORT

export function setConsolePort(port: number): void {
  currentPort = port > 0 && port <= 65535 ? port : DEFAULT_PORT
}

export function getConsolePort(): number {
  return currentPort
}

interface ConsoleResponse<T = unknown> {
  code: string
  data?: T
  total?: number
  message?: string
}

interface AgentDefinition {
  name: string
  display_name?: string
  description?: string
  agent_type?: string
  profile?: string
  system_prompt?: string
  model?: string
  max_turns?: number
  auto_team?: boolean
  tools?: string[]
  allowed_tools?: string[]
  disallowed_tools?: string[]
  skills?: string[]
  sub_agents?: Array<{ name: string; role?: string; agent_type?: string; profile?: string }>
  source?: string
}

function request<T = unknown>(method: string, path: string, body?: unknown): Promise<ConsoleResponse<T>> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_PREFIX}${path}`, `http://localhost:${currentPort}`)
    const payload = body ? JSON.stringify(body) : undefined

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          Accept: 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode === 204) {
            resolve({ code: 'OK' })
            return
          }
          try {
            resolve(JSON.parse(raw) as ConsoleResponse<T>)
          } catch {
            reject(new Error(`Invalid JSON response: ${raw.slice(0, 200)}`))
          }
        })
      },
    )

    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Console API request timeout'))
    })

    if (payload) req.write(payload)
    req.end()
  })
}

export async function probeConsole(port?: number): Promise<{ ok: boolean; error?: string }> {
  const targetPort = port != null && port > 0 ? port : currentPort
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: targetPort,
        path: `${API_PREFIX}/agents?limit=1`,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve({ ok: true })
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}` })
          }
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: '连接超时' })
    })
    req.end()
  })
}

export async function listAgents(params?: {
  agent_type?: string
  source?: string
  limit?: number
  offset?: number
}): Promise<ConsoleResponse<AgentDefinition[]>> {
  const query = new URLSearchParams()
  if (params?.agent_type) query.set('agent_type', params.agent_type)
  if (params?.source) query.set('source', params.source)
  if (params?.limit != null) query.set('limit', String(params.limit))
  if (params?.offset != null) query.set('offset', String(params.offset))
  const qs = query.toString()
  return request<AgentDefinition[]>('GET', `/agents${qs ? `?${qs}` : ''}`)
}

export async function getAgent(name: string): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('GET', `/agents/${encodeURIComponent(name)}`)
}

export async function createAgent(agent: Omit<AgentDefinition, 'source'>): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('POST', '/agents', agent)
}

export async function updateAgent(name: string, fields: Partial<Omit<AgentDefinition, 'name' | 'source'>>): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('PUT', `/agents/${encodeURIComponent(name)}`, fields)
}

export async function deleteAgent(name: string): Promise<ConsoleResponse> {
  return request('DELETE', `/agents/${encodeURIComponent(name)}`)
}
