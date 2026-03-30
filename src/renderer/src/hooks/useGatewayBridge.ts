import { useEffect } from 'react'
import { useConnectionStore, type GatewaySnapshot } from '../stores/connectionStore'
import { useAgentStore } from '../stores/agentStore'

/**
 * Bridges Electron IPC gateway events into Zustand stores.
 * Call once at the top of the component tree (AppLayout).
 */
export function useGatewayBridge() {
  const { setStatus, setSnapshot, clearSnapshot } = useConnectionStore()
  const { setAgents, setActiveAgent } = useAgentStore()

  useEffect(() => {
    // Sync initial status
    window.gateway.getStatus().then((s) => {
      setStatus(s as 'connected' | 'disconnected' | 'connecting' | 'reconnecting')
    })

    // Listen for status changes
    const offStatus = window.gateway.onStatus((s) => {
      setStatus(s as 'connected' | 'disconnected' | 'connecting' | 'reconnecting')
      if (s === 'disconnected' || s === 'reconnecting') {
        clearSnapshot()
      }
    })

    // Listen for successful connection with snapshot
    const offConnected = window.gateway.onConnected((raw) => {
      const snap = raw as GatewaySnapshot
      setSnapshot(snap)

      // Populate agent store from snapshot
      const gatewayAgents = snap?.snapshot?.health?.agents ?? []
      const agents = gatewayAgents.map((a) => ({
        id: a.agentId,
        name: a.agentId === 'main' ? 'Main Agent' : a.agentId,
        emoji: a.agentId === 'main' ? '🤖' : '🦾',
        workspace: snap.snapshot?.stateDir ?? '~/.clawdbot',
        model: undefined,
      }))
      setAgents(agents)

      // Set default active agent
      const defaultAgentId = snap?.snapshot?.health?.defaultAgentId
      if (defaultAgentId) {
        const found = agents.find((a) => a.id === defaultAgentId)
        if (found) setActiveAgent(found)
      }
    })

    return () => {
      offStatus()
      offConnected()
    }
  }, [])
}
