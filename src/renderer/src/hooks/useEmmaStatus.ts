import { useState, useEffect } from 'react'

type EmmaStatus = 'disconnected' | 'connecting' | 'connected'

export function useEmmaStatus(): EmmaStatus {
  const [status, setStatus] = useState<EmmaStatus>('disconnected')

  useEffect(() => {
    window.emma.getStatus().then((s) => {
      setStatus(s.status as EmmaStatus)
    })

    const off = window.emma.onStatus((s) => {
      setStatus(s as EmmaStatus)
    })

    return off
  }, [])

  return status
}
