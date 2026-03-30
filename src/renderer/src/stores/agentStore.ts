import { create } from 'zustand'

interface Agent {
  id: string
  name: string
  emoji?: string
  workspace: string
  model?: string
  createdAt?: number
}

interface AgentStore {
  agents: Agent[]
  activeAgent: Agent | null
  isLoading: boolean
  setAgents: (agents: Agent[]) => void
  setActiveAgent: (agent: Agent | null) => void
  setLoading: (loading: boolean) => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  activeAgent: null,
  isLoading: false,
  setAgents: (agents) => set({ agents }),
  setActiveAgent: (agent) => set({ activeAgent: agent }),
  setLoading: (loading) => set({ isLoading: loading }),
}))
