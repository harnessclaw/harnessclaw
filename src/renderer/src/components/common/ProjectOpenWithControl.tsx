import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ProjectOpenWithControlProps {
  cwd?: string
  className?: string
  alwaysVisible?: boolean
}

export function ProjectOpenWithControl({ cwd = '', className, alwaysVisible = false }: ProjectOpenWithControlProps) {
  const { t } = useTranslation()
  const [openApps, setOpenApps] = useState<ProjectOpenApp[]>([])
  const [selectedOpenAppId, setSelectedOpenAppId] = useState(() => localStorage.getItem('project-open-app-id') || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.projectOpenApps.list()
      .then((result) => {
        if (cancelled) return
        const apps = result.ok ? result.apps : []
        setOpenApps(apps)
        setSelectedOpenAppId((current) => {
          if (current && apps.some((app) => app.id === current)) return current
          const next = apps[0]?.id || ''
          if (next) localStorage.setItem('project-open-app-id', next)
          return next
        })
      })
      .catch(() => {
        if (!cancelled) setOpenApps([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      setMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const selectedOpenApp = openApps.find((app) => app.id === selectedOpenAppId) || openApps[0] || null

  const openProjectWithApp = async (app: ProjectOpenApp | null) => {
    if (!app || !cwd) return
    setError('')
    const result = await window.projectOpenApps.open({ appId: app.id, cwd })
    if (!result.ok) setError(result.error || t('projects.workspace.openWith.openFailed'))
  }

  const handleSelectOpenApp = (app: ProjectOpenApp) => {
    const appId = app.id
    setSelectedOpenAppId(appId)
    localStorage.setItem('project-open-app-id', appId)
    setMenuOpen(false)
    setError('')
    void openProjectWithApp(app)
  }

  const handleOpenProjectWithApp = async () => {
    await openProjectWithApp(selectedOpenApp)
  }

  if (!cwd && !loading && !alwaysVisible) return null

  return (
    <div ref={rootRef} className={cn('titlebar-no-drag relative', className)}>
      <div className="inline-flex h-9 items-center overflow-hidden rounded-lg text-muted-foreground">
        <button
          type="button"
          onClick={() => void handleOpenProjectWithApp()}
          disabled={!selectedOpenApp || !cwd || loading}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={selectedOpenApp
            ? t('projects.workspace.openWith.openWithApp', { name: selectedOpenApp.name })
            : t('projects.workspace.openWith.noApps')}
          title={selectedOpenApp
            ? t('projects.workspace.openWith.openWithApp', { name: selectedOpenApp.name })
            : t('projects.workspace.openWith.noApps')}
        >
          <ProjectOpenAppIcon app={selectedOpenApp} size="sm" />
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          disabled={openApps.length === 0 || loading}
          className="inline-flex h-9 w-7 items-center justify-center rounded-lg transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={t('projects.workspace.openWith.choose')}
          aria-expanded={menuOpen}
        >
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      </div>

      {menuOpen ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[220px] overflow-hidden rounded-[16px] border border-border bg-card py-2 shadow-[0_18px_46px_rgba(15,23,42,0.14)]">
          {openApps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => handleSelectOpenApp(app)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted',
                selectedOpenApp?.id === app.id && 'bg-muted/70 text-foreground'
              )}
            >
              <ProjectOpenAppIcon app={app} size="md" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{app.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="absolute right-0 top-[calc(100%+6px)] z-40 max-w-[260px] whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-destructive shadow-md">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ProjectOpenAppIcon({ app, size }: { app: ProjectOpenApp | null; size: 'sm' | 'md' }) {
  const boxClass = size === 'sm' ? 'h-[18px] w-[18px] rounded-[5px]' : 'h-6 w-6 rounded-md'
  const fallbackText = app?.name
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  if (app?.iconDataUrl) {
    return <img src={app.iconDataUrl} alt="" className={boxClass} aria-hidden="true" />
  }

  if (fallbackText) {
    return (
      <span className={cn('flex items-center justify-center bg-muted text-[10px] font-semibold text-muted-foreground', boxClass)} aria-hidden="true">
        {fallbackText}
      </span>
    )
  }

  return <AppWindow size={size === 'sm' ? 18 : 15} aria-hidden="true" />
}
