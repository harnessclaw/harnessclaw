import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { FolderKanban, MoreHorizontal, Plus, X } from 'lucide-react'
import { DangerConfirmMenu } from '../common/DangerConfirmMenu'
import { cn } from '../../lib/utils'

interface ProjectDraft {
  name: string
  description: string
}

const EMPTY_DRAFT: ProjectDraft = { name: '', description: '' }

export function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<DbProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null)
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [projectActionError, setProjectActionError] = useState('')
  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_DRAFT)
  const [nameError, setNameError] = useState('')
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const loadProjects = async () => {
    setLoading(true)
    try {
      const rows = await window.db.listProjects()
      setProjects(rows)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProjects()
  }, [])

  useEffect(() => {
    if (!menuProjectId) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-project-actions]')) return
      if (target?.closest('[data-danger-confirm-dialog]')) return
      setMenuProjectId(null)
      setConfirmDeleteProjectId(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuProjectId(null)
        setConfirmDeleteProjectId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuProjectId])

  useEffect(() => {
    if (!createOpen) return

    requestAnimationFrame(() => nameInputRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreateOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [createOpen])

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT)
    setNameError('')
  }

  const closeCreateDialog = () => {
    setCreateOpen(false)
    resetDraft()
  }

  const validateProjectName = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return '请填写项目名称。'
    if (trimmed.length > 40) return '项目名称请控制在 40 个字符以内。'
    if (projects.some((project) => project.name === trimmed)) return '已有同名项目，请换一个名称。'
    return ''
  }

  const createProjectId = () => `project-${globalThis.crypto.randomUUID()}`

  const handleCreateProject = async () => {
    const nextError = validateProjectName(draft.name)
    if (nextError) {
      setNameError(nextError)
      return
    }

    const result = await window.db.createProject({
      projectId: createProjectId(),
      name: draft.name.trim(),
      description: draft.description.trim() || '项目描述暂未填写，后续可以继续补充目标、上下文和交付范围。',
    })

    if (!result.ok || !result.project) {
      setNameError(result.error || '项目创建失败，请稍后再试。')
      return
    }

    setProjects((current) => [result.project!, ...current])
    closeCreateDialog()
  }

  const handleDeleteProject = async (projectId: string) => {
    setProjectActionError('')
    setDeletingProjectId(projectId)
    try {
      const result = await window.db.deleteProject(projectId)
      if (!result.ok) {
        setProjectActionError(result.error || '项目删除失败，请稍后再试。')
        return
      }

      setProjects((current) => current.filter((project) => project.project_id !== projectId))
      setMenuProjectId(null)
      setConfirmDeleteProjectId(null)
    } finally {
      setDeletingProjectId(null)
    }
  }

  const confirmingProject = projects.find((project) => project.project_id === confirmDeleteProjectId) ?? null

  return (
    <div className="relative flex min-h-full justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="w-full max-w-[1180px]">
        <header className="border-b border-border/70 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-foreground">
                <FolderKanban size={16} className="text-muted-foreground" />
                <h1 className="text-lg font-semibold tracking-tight">项目</h1>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {projects.length}
                </span>
              </div>
            </div>

            <div className="flex justify-start sm:justify-end">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <Plus size={14} />
                <span>新建项目</span>
              </button>
            </div>
          </div>
        </header>

        <section className="space-y-4 pt-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">全部项目</h2>
            {projectActionError ? (
              <p className="mt-1 text-xs text-destructive">{projectActionError}</p>
            ) : null}
          </div>

          {loading ? (
            <div className="rounded-[24px] border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              正在加载项目...
            </div>
          ) : projects.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <article
                  key={project.project_id}
                  className="group relative rounded-xl border border-border bg-card text-left transition-all duration-200 hover:border-foreground/10 hover:shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${project.project_id}`)}
                    className="block w-full overflow-hidden rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="border-b border-border/80 px-4 py-4 pr-12">
                      <h3 className="truncate text-sm font-semibold text-foreground">{project.name}</h3>
                    </div>
                    <div className="bg-muted/18 px-4 py-3">
                      <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {project.description}
                      </p>
                    </div>
                  </button>

                  <div data-project-actions className="absolute right-2.5 top-2.5 z-10">
                    <button
                      type="button"
                      onClick={() => {
                        setProjectActionError('')
                        setConfirmDeleteProjectId(null)
                        setMenuProjectId((current) => current === project.project_id ? null : project.project_id)
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={`打开${project.name}的项目操作`}
                      aria-expanded={menuProjectId === project.project_id}
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {menuProjectId === project.project_id ? (
                      <DangerConfirmMenu
                        className="absolute right-0 top-9"
                        confirming={false}
                        disabled={deletingProjectId === project.project_id}
                        pending={deletingProjectId === project.project_id}
                        pendingLabel="删除中"
                        onRequestConfirm={() => {
                          setMenuProjectId(null)
                          setConfirmDeleteProjectId(project.project_id)
                        }}
                        onCancel={() => setConfirmDeleteProjectId(null)}
                        onConfirm={() => void handleDeleteProject(project.project_id)}
                      />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-border bg-card px-5 py-8 text-center sm:px-6">
              <h3 className="text-base font-semibold text-foreground">当前还没有项目</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                先创建一个新项目，把后续对话和交付物集中到同一个工作台里。
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <Plus size={16} />
                <span>新建项目</span>
              </button>
            </div>
          )}
        </section>
      </div>

      <CreateProjectDialog
        open={createOpen}
        draft={draft}
        nameError={nameError}
        nameInputRef={nameInputRef}
        onClose={closeCreateDialog}
        onChangeDraft={setDraft}
        onSubmit={handleCreateProject}
        onClearNameError={() => setNameError('')}
      />

      {confirmingProject ? (
        <DangerConfirmMenu
          confirming
          disabled={deletingProjectId === confirmingProject.project_id}
          pending={deletingProjectId === confirmingProject.project_id}
          pendingLabel="删除中"
          onRequestConfirm={() => undefined}
          onCancel={() => setConfirmDeleteProjectId(null)}
          onConfirm={() => void handleDeleteProject(confirmingProject.project_id)}
        />
      ) : null}
    </div>
  )
}

function CreateProjectDialog({
  open,
  draft,
  nameError,
  nameInputRef,
  onClose,
  onChangeDraft,
  onSubmit,
  onClearNameError,
}: {
  open: boolean
  draft: ProjectDraft
  nameError: string
  nameInputRef: React.RefObject<HTMLInputElement | null>
  onClose: () => void
  onChangeDraft: React.Dispatch<React.SetStateAction<ProjectDraft>>
  onSubmit: () => void
  onClearNameError: () => void
}) {
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/32">
      <div
        className="flex min-h-full items-center justify-center px-4 py-6 sm:px-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClose()
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-title"
          className="w-full max-w-[560px] rounded-[26px] border border-border bg-background shadow-[0_28px_80px_rgba(15,23,42,0.22)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4 sm:px-6">
            <h2 id="create-project-title" className="text-lg font-semibold text-foreground">新建项目</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭新建项目对话框"
            >
              <X size={16} />
            </button>
          </div>

          <form
            className="space-y-4 px-5 py-5 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit()
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="project-name" className="text-xs font-medium text-muted-foreground">
                项目名称
              </label>
              <input
                id="project-name"
                ref={nameInputRef}
                value={draft.name}
                onChange={(event) => {
                  onClearNameError()
                  onChangeDraft((current) => ({ ...current, name: event.target.value }))
                }}
                placeholder="例如：v0.1.0 发布准备"
                className={cn(
                  'w-full rounded-2xl border bg-card px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring',
                  nameError ? 'border-destructive' : 'border-border'
                )}
              />
              {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="project-description" className="text-xs font-medium text-muted-foreground">
                项目描述
              </label>
              <textarea
                id="project-description"
                value={draft.description}
                onChange={(event) => onChangeDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="简要说明这个项目会集中处理什么问题、关联哪些对话或交付物。"
                rows={5}
                className="w-full resize-none rounded-2xl border border-border bg-card px-3 py-3 text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
              />
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                取消
              </button>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                创建项目
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}
