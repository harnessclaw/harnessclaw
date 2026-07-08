export const PROJECT_CWDS_CHANGED_EVENT = 'project-cwds-changed'

const PROJECT_CWDS_KEY = 'harnessclaw-project-cwds'

interface ProjectLike {
  project_id: string
  description?: string | null
}

interface SessionLike {
  cwd?: string | null
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

function normalizeCwd(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return ''
  return trimmed.replace(/[\\/]+$/, '')
}

function writeProjectCwds(cwds: Record<string, string>): void {
  if (!canUseLocalStorage()) return
  window.localStorage.setItem(PROJECT_CWDS_KEY, JSON.stringify(cwds))
  window.dispatchEvent(new CustomEvent(PROJECT_CWDS_CHANGED_EVENT))
}

export function readProjectCwds(): Record<string, string> {
  if (!canUseLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(PROJECT_CWDS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const cwds: Record<string, string> = {}
    for (const [projectId, value] of Object.entries(parsed)) {
      const cwd = normalizeCwd(typeof value === 'string' ? value : '')
      if (projectId && cwd) cwds[projectId] = cwd
    }
    return cwds
  } catch {
    return {}
  }
}

export function getProjectCwd(project: ProjectLike, projectCwds: Record<string, string>): string {
  const storedCwd = normalizeCwd(projectCwds[project.project_id])
  if (storedCwd) return storedCwd

  const description = normalizeCwd(project.description || '')
  return isAbsolutePath(description) ? description : ''
}

export function setProjectCwd(projectId: string, cwd: string | null | undefined): Record<string, string> {
  const normalizedCwd = normalizeCwd(cwd)
  if (!projectId || !normalizedCwd) return readProjectCwds()

  const cwds = readProjectCwds()
  cwds[projectId] = normalizedCwd
  writeProjectCwds(cwds)
  return cwds
}

export function clearProjectCwd(projectId: string): Record<string, string> {
  const cwds = readProjectCwds()
  delete cwds[projectId]
  writeProjectCwds(cwds)
  return cwds
}

export function sessionBelongsToProjectByCwd(
  session: SessionLike,
  project: ProjectLike,
  projectCwds: Record<string, string>,
): boolean {
  const sessionCwd = normalizeCwd(session.cwd)
  if (!sessionCwd) return false
  const projectCwd = getProjectCwd(project, projectCwds)
  return Boolean(projectCwd) && sessionCwd === projectCwd
}
