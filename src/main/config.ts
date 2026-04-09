import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'

export const HARNESSCLAW_DIR = join(homedir(), '.harnessclaw')
export const NANOBOT_CONFIG_PATH = join(HARNESSCLAW_DIR, 'config.json')
export const HARNESSCLAW_CONFIG_PATH = join(HARNESSCLAW_DIR, 'harnessclaw.json')

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function readJsonConfig(path: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

export function saveJsonConfig(path: string, data: unknown): { ok: boolean; error?: string } {
  try {
    ensureDir(dirname(path))
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function readHarnessclawConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return readJsonConfig(HARNESSCLAW_CONFIG_PATH, fallback)
}

export function saveHarnessclawConfig(data: unknown): { ok: boolean; error?: string } {
  return saveJsonConfig(HARNESSCLAW_CONFIG_PATH, data)
}

export function readNanobotConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return readJsonConfig(NANOBOT_CONFIG_PATH, fallback)
}

export function saveNanobotConfig(data: unknown): { ok: boolean; error?: string } {
  return saveJsonConfig(NANOBOT_CONFIG_PATH, data)
}
