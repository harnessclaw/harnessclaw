function isWindowsRuntime(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.userAgent.toLowerCase().includes('windows')
}

export const defaultWorkspaceDisplayPath = isWindowsRuntime()
  ? '~/.harnessclaw/workspace'
  : '~/.nanobot/workspace'

export const defaultSkillsDisplayPath = `${defaultWorkspaceDisplayPath}/skills`

export const defaultClawhubBinaryDisplayPath = isWindowsRuntime()
  ? '~/.harnessclaw/bin/clawhub-runtime'
  : '~/.harnessclaw/bin/clawhub-runtime'

export const defaultDbDisplayPath = '~/.harnessclaw/db/harnessclaw.db'

export const defaultLogsDisplayPath = '~/.harnessclaw/logs'
