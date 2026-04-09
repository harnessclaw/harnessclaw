import { useState, useEffect, useRef, useCallback } from 'react'

type ConfigBridge = {
  read: () => Promise<Record<string, unknown>>
  save: (data: unknown) => Promise<{ ok: boolean; error?: string }>
}

function useJsonConfig(bridge: ConfigBridge) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configRef = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await bridge.read()
        setConfig(data)
        configRef.current = data
      } catch {
        setConfig({})
        configRef.current = {}
      } finally {
        setLoading(false)
      }
    })()
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const updateConfig = useCallback((patch: Record<string, unknown>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...patch }
      configRef.current = updated
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        await bridge.save(configRef.current)
      }, 500)
      return updated
    })
  }, [bridge])

  return { config, loading, updateConfig }
}

export function useEngineConfig() {
  return useJsonConfig(window.engineConfig)
}

// Backward-compatible alias for older imports.
export function useNanobotConfig() {
  return useEngineConfig()
}

export function useAppConfig() {
  return useJsonConfig(window.appConfig)
}
