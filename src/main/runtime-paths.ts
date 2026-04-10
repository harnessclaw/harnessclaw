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
export const LOGS_DIR = join(HARNESSCLAW_HOME, 'logs')
export const APP_LOG_PATH = join(LOGS_DIR, 'app.log')
export const RENDERER_LOG_PATH = join(LOGS_DIR, 'renderer.log')
export const USAGE_LOG_PATH = join(LOGS_DIR, 'usage.jsonl')
export const EXPORTS_DIR = join(LOGS_DIR, 'exports')

export function getDefaultWorkspaceSetting(): string {
  return IS_WINDOWS ? '~/.harnessclaw/workspace' : '~/.nanobot/workspace'
}
