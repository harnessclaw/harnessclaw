import { homedir } from 'node:os'
import { join } from 'node:path'

export const HARNESSCLAW_HOME = join(homedir(), '.harnessclaw')
export const LEGACY_NANOBOT_HOME = join(homedir(), '.nanobot')
export const IS_WINDOWS = process.platform === 'win32'

export const ENGINE_HOME = IS_WINDOWS ? HARNESSCLAW_HOME : LEGACY_NANOBOT_HOME
export const ENGINE_CONFIG_PATH = join(ENGINE_HOME, 'config.json')
export const LEGACY_ENGINE_CONFIG_PATH = join(LEGACY_NANOBOT_HOME, 'config.json')
export const APP_CONFIG_PATH = join(HARNESSCLAW_HOME, 'harnessclaw.json')
export const LEGACY_APP_CONFIG_PATH = join(homedir(), '.icuclaw.json')
export const LEGACY_APP_CONFIG_IN_HOME = join(HARNESSCLAW_HOME, 'app.json')
export const HARNESSCLAW_LAUNCHED_FLAG = join(HARNESSCLAW_HOME, '.launched')
export const NANOBOT_PID_PATH = join(HARNESSCLAW_HOME, 'nanobot-gateway.pid')
export const BIN_DIR = join(HARNESSCLAW_HOME, 'bin')
export const DB_DIR = join(HARNESSCLAW_HOME, 'db')
export const DB_PATH = join(DB_DIR, 'harnessclaw.db')
export const SKILL_REPOS_CACHE_DIR = join(HARNESSCLAW_HOME, 'cache', 'skill-repos')
export const LOG_DIR = join(HARNESSCLAW_HOME, 'log')
export const LOGS_DIR = LOG_DIR
export const LATEST_LOG_PATH = join(LOG_DIR, 'latest.log')
export const APP_LOG_PATH = LATEST_LOG_PATH
export const RENDERER_LOG_PATH = LATEST_LOG_PATH
export const USAGE_LOG_PATH = LATEST_LOG_PATH
export const EXPORTS_DIR = join(LOG_DIR, 'exports')

export function getDefaultWorkspaceSetting(): string {
  return IS_WINDOWS ? '~/.harnessclaw/workspace' : '~/.nanobot/workspace'
}
