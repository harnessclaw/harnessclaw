import { useEffect, useState } from 'react'

type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

const POLL_INTERVAL_MS = 10000

let sharedStatus: HarnessclawStatus = 'disconnected'
let activeConsumers = 0
let monitorStarted = false
let pollTimer: number | null = null
let statusUnsubscribe: (() => void) | null = null
let probeInFlight: Promise<void> | null = null

const listeners = new Set<(status: HarnessclawStatus) => void>()

function emitStatus(next: HarnessclawStatus): void {
  sharedStatus = next
  listeners.forEach((listener) => listener(next))
}

async function syncStatus(): Promise<void> {
  if (probeInFlight) {
    return probeInFlight
  }

  probeInFlight = (async () => {
    try {
      const current = await window.harnessclaw.getStatus()

      if (current.status === 'disconnected') {
        emitStatus('connecting')
      } else {
        emitStatus(current.status as HarnessclawStatus)
      }

      const probe = await window.harnessclaw.probe()
      emitStatus(probe.ok ? 'connected' : 'disconnected')
    } catch {
      emitStatus('disconnected')
    } finally {
      probeInFlight = null
    }
  })()

  return probeInFlight
}

function startMonitor(): void {
  if (monitorStarted) return
  monitorStarted = true

  statusUnsubscribe = window.harnessclaw.onStatus((status) => {
    emitStatus(status === 'disconnected' ? 'connecting' : (status as HarnessclawStatus))
    void syncStatus()
  })

  void syncStatus()
  pollTimer = window.setInterval(() => {
    void syncStatus()
  }, POLL_INTERVAL_MS)
}

function stopMonitor(): void {
  if (!monitorStarted || activeConsumers > 0) return
  monitorStarted = false

  if (pollTimer != null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }

  if (statusUnsubscribe) {
    statusUnsubscribe()
    statusUnsubscribe = null
  }
}

export function useHarnessclawStatus(): HarnessclawStatus {
  const [status, setStatus] = useState<HarnessclawStatus>(sharedStatus)

  useEffect(() => {
    activeConsumers += 1
    startMonitor()

    listeners.add(setStatus)
    setStatus(sharedStatus)

    return () => {
      listeners.delete(setStatus)
      activeConsumers = Math.max(0, activeConsumers - 1)
      stopMonitor()
    }
  }, [])

  return status
}
