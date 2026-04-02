import { useState, useEffect } from 'react'

type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

export function useHarnessclawStatus(): HarnessclawStatus {
  const [status, setStatus] = useState<HarnessclawStatus>('disconnected')

  useEffect(() => {
    window.harnessclaw.getStatus().then((s) => {
      setStatus(s.status as HarnessclawStatus)
    })

    const off = window.harnessclaw.onStatus((s) => {
      setStatus(s as HarnessclawStatus)
    })

    return off
  }, [])

  return status
}
