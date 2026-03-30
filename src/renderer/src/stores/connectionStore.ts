import { create } from 'zustand'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting'

export interface GatewayAgent {
  agentId: string
  isDefault: boolean
  sessions: { count: number; recent: Array<{ key: string; updatedAt: number; age: number }> }
}

export interface GatewaySnapshot {
  type: 'hello-ok'
  protocol: number
  server: { version: string; host: string; connId: string }
  features: { methods: string[]; events: string[] }
  snapshot: {
    health: {
      ok: boolean
      defaultAgentId: string
      agents: GatewayAgent[]
      sessions: { count: number; recent: Array<{ key: string; updatedAt: number; age: number }> }
    }
    stateDir: string
    configPath: string
    uptimeMs: number
    sessionDefaults: { defaultAgentId: string; mainKey: string; mainSessionKey: string }
  }
  canvasHostUrl: string
  auth: { deviceToken: string; role: string; scopes: string[] }
}

interface ConnectionStore {
  status: ConnectionStatus
  gatewayUrl: string
  snapshot: GatewaySnapshot | null
  setStatus: (status: ConnectionStatus) => void
  setGatewayUrl: (url: string) => void
  setSnapshot: (snapshot: GatewaySnapshot) => void
  clearSnapshot: () => void
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'disconnected',
  gatewayUrl: 'ws://127.0.0.1:18789',
  snapshot: null,
  setStatus: (status) => set({ status }),
  setGatewayUrl: (url) => set({ gatewayUrl: url }),
  setSnapshot: (snapshot) => set({ snapshot }),
  clearSnapshot: () => set({ snapshot: null }),
}))
