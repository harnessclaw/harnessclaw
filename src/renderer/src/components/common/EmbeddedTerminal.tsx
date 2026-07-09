import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, SquareTerminal, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/lib/utils'

type TerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

interface EmbeddedTerminalProps {
  open: boolean
  sessionId: string
  cwd?: string | null
  onClose: () => void
}

interface TerminalTab {
  key: string
  title: string
  sequence: number
}

const latteAnsiTheme = {
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  cursorAccent: '#eff1f5',
  selectionBackground: '#ccd0da',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#8839ef',
  cyan: '#179299',
  white: '#acb0be',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#8839ef',
  brightCyan: '#179299',
  brightWhite: '#bcc0cc',
}

const mochaAnsiTheme = {
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#11111b',
  selectionBackground: '#45475a',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
}

function resolveCssColor(variableName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
  return value || fallback
}

function isDarkMode(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function terminalTheme() {
  const ansiTheme = isDarkMode() ? mochaAnsiTheme : latteAnsiTheme
  return {
    ...ansiTheme,
    background: resolveCssColor('--background', isDarkMode() ? '#0C0E16' : '#F7F7F7'),
  }
}

function getTerminalTitle(cwd: string | null | undefined, index: number): string {
  const normalized = (cwd || '').trim().replace(/[\\/]+$/, '')
  const name = normalized.split(/[\\/]/).filter(Boolean).pop()
  const baseName = name || 'terminal'
  return index <= 1 ? baseName : `${baseName}(${index})`
}

function createTerminalTab(cwd: string | null | undefined, index: number): TerminalTab {
  return {
    key: `terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: getTerminalTitle(cwd, index),
    sequence: index,
  }
}

function getNextTerminalIndex(tabs: TerminalTab[]): number {
  const used = new Set(tabs.map((tab) => tab.sequence))
  let index = 1
  while (used.has(index)) {
    index += 1
  }
  return index
}

export function EmbeddedTerminal({ open, sessionId, cwd, onClose }: EmbeddedTerminalProps) {
  const { t } = useTranslation()
  const cwdRef = useRef(cwd)
  const editingInputRef = useRef<HTMLInputElement | null>(null)
  const initialTab = useMemo(() => createTerminalTab(cwd, 1), [cwd])
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [initialTab])
  const [activeTabKey, setActiveTabKey] = useState(initialTab.key)
  const [editingTabKey, setEditingTabKey] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  useEffect(() => {
    cwdRef.current = cwd
  }, [cwd])

  useEffect(() => {
    const nextTab = createTerminalTab(cwdRef.current, 1)
    setTabs([nextTab])
    setActiveTabKey(nextTab.key)
    setEditingTabKey(null)
    setEditingTitle('')
  }, [sessionId])

  const handleAddTerminal = useCallback(() => {
    setTabs((current) => {
      const tab = createTerminalTab(cwd, getNextTerminalIndex(current))
      setActiveTabKey(tab.key)
      setEditingTabKey(null)
      setEditingTitle('')
      return [...current, tab]
    })
  }, [cwd])

  const handleCloseTerminal = useCallback((tabKey: string) => {
    setTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.key === tabKey)
      const nextTabs = current.filter((tab) => tab.key !== tabKey)
      setActiveTabKey((active) => {
        if (active !== tabKey) return active
        const fallback = nextTabs[Math.max(0, closingIndex - 1)] || nextTabs[0]
        return fallback?.key || ''
      })
      return nextTabs
    })
    setEditingTabKey((current) => (current === tabKey ? null : current))
    setEditingTitle((current) => (editingTabKey === tabKey ? '' : current))
  }, [editingTabKey])

  const beginRenameTab = useCallback((tab: TerminalTab) => {
    setActiveTabKey(tab.key)
    setEditingTabKey(tab.key)
    setEditingTitle(tab.title)
  }, [])

  const cancelRenameTab = useCallback(() => {
    setEditingTabKey(null)
    setEditingTitle('')
  }, [])

  const commitRenameTab = useCallback(() => {
    if (!editingTabKey) return
    const nextTitle = editingTitle.trim()
    if (nextTitle) {
      setTabs((current) =>
        current.map((tab) => (tab.key === editingTabKey ? { ...tab, title: nextTitle } : tab))
      )
    }
    setEditingTabKey(null)
    setEditingTitle('')
  }, [editingTabKey, editingTitle])

  useEffect(() => {
    if (!editingTabKey) return
    const timer = window.setTimeout(() => {
      editingInputRef.current?.focus()
      editingInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editingTabKey])

  return (
    <div
      className={cn(
        'local-terminal-panel overflow-hidden border-t border-border bg-background text-foreground transition-[height,opacity,border-color] duration-200 ease-out',
        open ? 'h-[min(34vh,340px)] opacity-100' : 'h-0 border-t-transparent opacity-0 pointer-events-none'
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border bg-background px-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.key === activeTabKey
              const editing = tab.key === editingTabKey
              return (
                <div
                  key={tab.key}
                  className={cn(
                    'group inline-flex h-7 max-w-[220px] flex-shrink-0 items-center overflow-hidden rounded-lg text-xs font-medium transition-colors',
                    active
                      ? 'bg-muted text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  )}
                >
                  {editing ? (
                    <div className="inline-flex h-full min-w-0 flex-1 items-center gap-2 px-3">
                      <SquareTerminal size={14} className="flex-shrink-0" />
                      <span className="grid min-w-[2ch] max-w-[150px]">
                        <span
                          className="invisible col-start-1 row-start-1 whitespace-pre px-1 text-xs"
                          aria-hidden="true"
                        >
                          {editingTitle || ' '}
                        </span>
                        <input
                          ref={editingInputRef}
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onBlur={commitRenameTab}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitRenameTab()
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelRenameTab()
                            }
                          }}
                          className="col-start-1 row-start-1 h-5 w-full min-w-0 rounded bg-background px-1 text-xs text-foreground outline-none ring-1 ring-border selection:bg-[#ccd0da]"
                          aria-label={t('common.rename')}
                        />
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveTabKey(tab.key)}
                      onDoubleClick={() => beginRenameTab(tab)}
                      className="inline-flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left"
                      title={tab.title}
                      aria-pressed={active}
                    >
                      <SquareTerminal size={14} className="flex-shrink-0" />
                      <span className="truncate">{tab.title}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleCloseTerminal(tab.key)
                    }}
                    className="mr-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/80 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                    title={t('chat.terminal.closeTab')}
                    aria-label={t('chat.terminal.closeTab')}
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={handleAddTerminal}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t('chat.terminal.new')}
              aria-label={t('chat.terminal.new')}
            >
              <Plus size={17} />
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t('chat.terminal.close')}
            aria-label={t('chat.terminal.close')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {tabs.length === 0 && (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t('chat.terminal.empty')}
            </div>
          )}
          {tabs.map((tab) => (
            <TerminalPane
              key={tab.key}
              active={tab.key === activeTabKey}
              panelOpen={open}
              sessionId={sessionId}
              cwd={cwd}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface TerminalPaneProps {
  active: boolean
  panelOpen: boolean
  sessionId: string
  cwd?: string | null
}

function TerminalPane({ active, panelOpen, sessionId, cwd }: TerminalPaneProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([])
  const pendingDataRef = useRef('')
  const flushFrameRef = useRef<number | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const startingRef = useRef(false)
  const [status, setStatus] = useState<TerminalStatus>('idle')
  const [error, setError] = useState('')

  const setPaneStatus = useCallback((nextStatus: TerminalStatus) => {
    setStatus(nextStatus)
  }, [])

  const flushPendingData = useCallback(() => {
    flushFrameRef.current = null
    const terminal = terminalRef.current
    if (!terminal || !pendingDataRef.current) return
    const data = pendingDataRef.current
    pendingDataRef.current = ''
    terminal.write(data)
  }, [])

  const applyTerminalTheme = useCallback(() => {
    if (!terminalRef.current) return
    terminalRef.current.options.theme = terminalTheme()
  }, [])

  const scheduleFit = useCallback(() => {
    if (resizeTimerRef.current != null) {
      window.clearTimeout(resizeTimerRef.current)
    }
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null
      if (!panelOpen || !active || !fitAddonRef.current || !terminalRef.current) return
      try {
        applyTerminalTheme()
        fitAddonRef.current.fit()
        const terminalId = terminalIdRef.current
        const terminal = terminalRef.current
        if (terminalId) {
          void window.localTerminal.resize(terminalId, terminal.cols, terminal.rows)
        }
      } catch {
        // FitAddon can throw while the panel is transitioning through 0px.
      }
    }, 80)
  }, [active, applyTerminalTheme, panelOpen])

  const ensureTerminal = useCallback(() => {
    if (terminalRef.current || !containerRef.current) return terminalRef.current

    const terminal = new Terminal({
      fontFamily: 'JetBrains Mono, Cascadia Mono, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 8000,
      convertEol: true,
      theme: terminalTheme(),
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
        webglAddonRef.current = null
      })
      terminal.loadAddon(webglAddon)
      webglAddonRef.current = webglAddon
    } catch {
      webglAddonRef.current = null
    }

    terminal.open(containerRef.current)
    disposablesRef.current.push(
      terminal.onData((data) => {
        const terminalId = terminalIdRef.current
        if (terminalId) {
          void window.localTerminal.write(terminalId, data)
        }
      }),
      terminal.onResize(({ cols, rows }) => {
        const terminalId = terminalIdRef.current
        if (!terminalId) return
        if (resizeTimerRef.current != null) {
          window.clearTimeout(resizeTimerRef.current)
        }
        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null
          void window.localTerminal.resize(terminalId, cols, rows)
        }, 100)
      }),
    )

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    return terminal
  }, [])

  const startTerminal = useCallback(async () => {
    if (startingRef.current || terminalIdRef.current) return
    if (!window.localTerminal) {
      setPaneStatus('error')
      setError(t('chat.terminal.apiUnavailable'))
      return
    }

    const terminal = ensureTerminal()
    if (!terminal) return

    startingRef.current = true
    setPaneStatus('starting')
    setError('')

    try {
      const result = await window.localTerminal.start({
        sessionId,
        cwd: cwd || undefined,
        cols: terminal.cols || 80,
        rows: terminal.rows || 24,
      })
      if (!result.ok) {
        setPaneStatus('error')
        setError(result.error)
        terminal.writeln(`\x1b[38;2;210;15;57m${result.error}\x1b[0m`)
        return
      }

      terminalIdRef.current = result.id
      setPaneStatus('running')
      scheduleFit()
      if (active && panelOpen) {
        terminal.focus()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setPaneStatus('error')
      setError(message)
      terminal.writeln(`\x1b[38;2;210;15;57m${message}\x1b[0m`)
    } finally {
      startingRef.current = false
    }
  }, [active, cwd, ensureTerminal, panelOpen, scheduleFit, sessionId, setPaneStatus, t])

  useEffect(() => {
    const offData = window.localTerminal?.onData((event) => {
      if (event.id !== terminalIdRef.current) return
      pendingDataRef.current += event.data
      if (flushFrameRef.current == null) {
        flushFrameRef.current = window.requestAnimationFrame(flushPendingData)
      }
    })
    const offExit = window.localTerminal?.onExit((event) => {
      if (event.id !== terminalIdRef.current) return
      terminalIdRef.current = null
      setPaneStatus('exited')
      terminalRef.current?.writeln(`\r\n\x1b[38;2;108;111;133m${t('chat.terminal.exited', { code: event.exitCode })}\x1b[0m`)
    })
    return () => {
      offData?.()
      offExit?.()
    }
  }, [flushPendingData, setPaneStatus, t])

  useEffect(() => {
    if (!panelOpen || !active) return
    void startTerminal()
  }, [active, panelOpen, startTerminal])

  useEffect(() => {
    if (!panelOpen || !active) return
    scheduleFit()
    terminalRef.current?.focus()

    const panel = containerRef.current?.parentElement
    if (panel && typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(() => scheduleFit())
      resizeObserverRef.current.observe(panel)
    }
    window.addEventListener('resize', scheduleFit)

    return () => {
      window.removeEventListener('resize', scheduleFit)
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
    }
  }, [active, panelOpen, scheduleFit])

  useEffect(() => {
    const handleThemeChange = () => {
      applyTerminalTheme()
      scheduleFit()
    }
    window.addEventListener('theme-changed', handleThemeChange)
    const observer = new MutationObserver(handleThemeChange)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      window.removeEventListener('theme-changed', handleThemeChange)
      observer.disconnect()
    }
  }, [applyTerminalTheme, scheduleFit])

  useEffect(() => {
    return () => {
      if (flushFrameRef.current != null) {
        window.cancelAnimationFrame(flushFrameRef.current)
      }
      if (resizeTimerRef.current != null) {
        window.clearTimeout(resizeTimerRef.current)
      }
      const terminalId = terminalIdRef.current
      if (terminalId) {
        void window.localTerminal?.kill(terminalId)
      }
      disposablesRef.current.forEach((disposable) => disposable.dispose())
      webglAddonRef.current?.dispose()
      fitAddonRef.current?.dispose()
      terminalRef.current?.dispose()
    }
  }, [])

  return (
    <div className={cn('absolute inset-0 min-h-0 bg-background', !active && 'hidden')}>
      {error && (
        <div className="border-b border-border bg-muted/40 px-4 py-1.5 text-[11px] text-[#d20f39]">
          {error}
        </div>
      )}
      <div ref={containerRef} className="h-full min-h-0 px-4 py-3" />
      {status === 'idle' && panelOpen && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {t('chat.terminal.status.starting')}
        </div>
      )}
    </div>
  )
}
