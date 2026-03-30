import { create } from 'zustand'

interface Session {
  id: string
  agentId: string
  agentName?: string
  status: 'active' | 'closed' | 'archived'
  messageCount?: number
  createdAt?: number
  lastMessageAt?: number
}

interface SessionStore {
  sessions: Session[]
  activeSession: Session | null
  isLoading: boolean
  setSessions: (sessions: Session[]) => void
  setActiveSession: (session: Session | null) => void
  setLoading: (loading: boolean) => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSession: null,
  isLoading: false,
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (session) => set({ activeSession: session }),
  setLoading: (loading) => set({ isLoading: loading }),
}))
