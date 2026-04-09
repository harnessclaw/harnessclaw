import { useEffect, useState } from 'react'

const DEFAULT_STATUS: AppRuntimeStatus = {
  localService: 'starting',
  transport: 'disconnected',
  llmConfigured: false,
  applyingConfig: false,
}

export function useAppRuntimeStatus(): AppRuntimeStatus {
  const [status, setStatus] = useState<AppRuntimeStatus>(DEFAULT_STATUS)

  useEffect(() => {
    window.appRuntime.getStatus().then((next) => {
      setStatus(next)
    })

    const off = window.appRuntime.onStatus((next) => {
      setStatus(next)
    })

    return off
  }, [])

  return status
}
