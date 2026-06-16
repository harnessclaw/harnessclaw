import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import iconSidebarOpen from '../../assets/icon-sidebar-open.svg'
import iconSidebarCollapse from '../../assets/icon-sidebar-collapse.svg'
import type { ArtifactRef } from '../pages/ChatPage'

const PANEL_WIDTH_EXPANDED = 256
const PANEL_WIDTH_COLLAPSED = 44

type PanelTab = 'logs' | 'artifacts'

/**
 * Minimal shape of a plan step we render in the logs tab.
 * Mirrors the inlined step shape on `SessionState.planDraft.steps`
 * (description + status + summary) — defined locally so this component
 * doesn't have to import the larger SessionState surface.
 */
interface LogStep {
  id: string
  description?: string
  status?: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'skipped'
  summary?: string
}

interface ConversationSidePanelProps {
  steps: LogStep[]
  artifacts: ArtifactRef[]
  onSelectArtifact: (artifact: ArtifactRef) => void
}

const TAB_STORAGE_KEY = 'chat-side-panel-tab'

function readStoredTab(): PanelTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    return v === 'artifacts' ? 'artifacts' : 'logs'
  } catch {
    return 'logs'
  }
}

function statusDotClass(status?: LogStep['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500'
    case 'running':
    case 'dispatched':
      return 'bg-sky-500 animate-pulse'
    case 'failed':
      return 'bg-red-500'
    case 'skipped':
      return 'bg-muted-foreground/40'
    default:
      return 'bg-muted-foreground/30'
  }
}

function formatStepLabel(step: LogStep, t: (k: string) => string): string {
  const desc = (step.description || '').trim()
  if (!desc) return t('chat.sidePanel.unnamedStep')
  if (step.status === 'completed') return t('chat.sidePanel.completedPrefix') + desc
  return desc
}

export function ConversationSidePanel({ steps, artifacts, onSelectArtifact }: ConversationSidePanelProps) {
  const { t } = useTranslation()
  // Default closed every visit (tab choice is persisted, expanded state isn't).
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>(() => readStoredTab())

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab)
    } catch {
      // ignore — non-critical persistence
    }
  }, [activeTab])

  const toggleExpanded = () => setExpanded((prev) => !prev)

  return (
    <aside
      aria-label={t('chat.sidePanel.label')}
      style={{ width: expanded ? PANEL_WIDTH_EXPANDED : PANEL_WIDTH_COLLAPSED }}
      className="relative flex-shrink-0 flex flex-col select-none overflow-hidden transition-[width] duration-200"
    >
      {/* Header: collapse/expand toggle on the left, tabs on the right (visible
          when expanded). Top padding aligns the button row with the chat
          title bar (which uses py-4). */}
      <div className={cn(
        'flex flex-shrink-0 items-center gap-2 px-2 pt-4 pb-2',
        expanded ? 'justify-between' : 'justify-center'
      )}>
        <button
          onClick={toggleExpanded}
          title={expanded ? t('chat.sidePanel.collapseAria') : t('chat.sidePanel.expandAria')}
          aria-label={expanded ? t('chat.sidePanel.collapseAria') : t('chat.sidePanel.expandAria')}
          aria-expanded={expanded}
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent"
        >
          <img
            src={expanded ? iconSidebarCollapse : iconSidebarOpen}
            alt=""
            className="h-[18px] w-[18px]"
            aria-hidden="true"
          />
        </button>

        {expanded && (
          <div role="tablist" aria-label={t('chat.sidePanel.tabsAria')} className="flex items-center gap-1 rounded-full bg-muted/60 p-0.5">
            <button
              role="tab"
              aria-selected={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                activeTab === 'logs'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('chat.sidePanel.tabLogs')}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'artifacts'}
              onClick={() => setActiveTab('artifacts')}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                activeTab === 'artifacts'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('chat.sidePanel.tabArtifacts')}
            </button>
          </div>
        )}
      </div>

      {/* Body — only rendered while expanded; collapsed state is just the header button. */}
      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {activeTab === 'logs' ? (
            steps.length === 0 ? (
              <EmptyState
                title={t('chat.sidePanel.noLogs')}
                desc={t('chat.sidePanel.noLogsDesc')}
              />
            ) : (
              <ul className="space-y-3">
                {steps.map((step) => (
                  <li key={step.id} className="flex items-start gap-2">
                    <span className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', statusDotClass(step.status))} aria-hidden="true" />
                    <p className="text-xs leading-5 text-muted-foreground">{formatStepLabel(step, t)}</p>
                  </li>
                ))}
              </ul>
            )
          ) : (
            artifacts.length === 0 ? (
              <EmptyState
                title={t('chat.sidePanel.noArtifacts')}
                desc={t('chat.sidePanel.noArtifactsDesc')}
              />
            ) : (
              <ul className="space-y-1">
                {artifacts.map((artifact) => {
                  const title = artifact.name || artifact.artifact_id
                  const subtitle = artifact.description || artifact.mime_type || artifact.type || ''
                  return (
                    <li key={artifact.artifact_id}>
                      <button
                        onClick={() => onSelectArtifact(artifact)}
                        className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <span className="w-full truncate text-xs font-medium text-foreground">{title}</span>
                        {subtitle && (
                          <span className="w-full truncate text-[11px] text-muted-foreground">{subtitle}</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
          )}
        </div>
      )}
    </aside>
  )
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{desc}</p>
    </div>
  )
}
