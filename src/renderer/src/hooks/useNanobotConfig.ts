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
        const result = await bridge.save(configRef.current)
        void window.appRuntime.trackUsage({
          category: 'config',
          action: bridge === window.nanobotConfig ? 'renderer_save_nanobot_config' : 'renderer_save_app_config',
          status: result.ok ? 'ok' : 'error',
          details: result.ok ? {} : { error: result.error || 'Unknown error' },
        })
        if (!result.ok) {
          void window.appRuntime.logRenderer('error', 'Config save failed', { error: result.error || 'Unknown error' })
        }
      }, 500)
      return updated
    })
  }, [bridge])

  return { config, loading, updateConfig }
}

export function useNanobotConfig() {
  return useJsonConfig(window.nanobotConfig)
}

export function useAppConfig() {
  return useJsonConfig(window.appConfig)
}
