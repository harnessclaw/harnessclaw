import { app } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'

const yaml = require('js-yaml') as {
  load: (source: string) => unknown
  dump: (value: unknown, options?: Record<string, unknown>) => string
}

export const HARNESSCLAW_DIR = join(homedir(), '.harnessclaw')
export const LEGACY_ENGINE_CONFIG_PATH = join(HARNESSCLAW_DIR, 'config.json')
export const ENGINE_CONFIG_PATH = join(HARNESSCLAW_DIR, 'harnessclaw-engine.yaml')
export const HARNESSCLAW_CONFIG_PATH = join(HARNESSCLAW_DIR, 'harnessclaw.json')
export const APP_RESOURCES_DIR = app.isPackaged
  ? process.resourcesPath
  : join(process.cwd(), 'resources')
export const BUNDLED_BIN_DIR = join(APP_RESOURCES_DIR, 'bin')

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

export function readYamlConfig(path: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf-8')
    const parsed = yaml.load(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return fallback
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

export function saveYamlConfig(path: string, data: unknown): { ok: boolean; error?: string } {
  try {
    ensureDir(dirname(path))
    const serialized = yaml.dump(data, {
      noRefs: true,
      lineWidth: 120,
      sortKeys: false,
    })
    writeFileSync(path, serialized, 'utf-8')
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

export function readEngineConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (existsSync(ENGINE_CONFIG_PATH)) {
    return readYamlConfig(ENGINE_CONFIG_PATH, fallback)
  }
  return readJsonConfig(LEGACY_ENGINE_CONFIG_PATH, fallback)
}

export function saveEngineConfig(data: unknown): { ok: boolean; error?: string } {
  return saveYamlConfig(ENGINE_CONFIG_PATH, data)
}

// Backward-compatible aliases. Renderer and older code may still use the nanobot name.
export const NANOBOT_CONFIG_PATH = ENGINE_CONFIG_PATH
export const readNanobotConfig = readEngineConfig
export const saveNanobotConfig = saveEngineConfig

function normalizePlatform(platform: NodeJS.Platform): 'darwin' | 'linux' | 'windows' {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'darwin'
  return 'linux'
}

function normalizeArch(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'x64'
    case 'arm64':
      return 'arm64'
    default:
      return arch
  }
}

export function getBundledBinaryFileName(baseName: string, platform = process.platform, arch = process.arch): string {
  const normalizedPlatform = normalizePlatform(platform)
  const normalizedArch = normalizeArch(arch)
  const extension = normalizedPlatform === 'windows' ? '.exe' : ''
  return `${baseName}-${normalizedPlatform}-${normalizedArch}${extension}`
}

export function getBundledBinaryPath(baseName: string, platform = process.platform, arch = process.arch): string {
  return join(BUNDLED_BIN_DIR, getBundledBinaryFileName(baseName, platform, arch))
}

export function resolveBundledBinaryPath(baseName: string, platform = process.platform, arch = process.arch): string | null {
  const exactPath = getBundledBinaryPath(baseName, platform, arch)
  if (existsSync(exactPath)) {
    return exactPath
  }

  const fallbackExtension = normalizePlatform(platform) === 'windows' ? '.exe' : ''
  const fallbackPath = join(BUNDLED_BIN_DIR, `${baseName}${fallbackExtension}`)
  if (existsSync(fallbackPath)) {
    return fallbackPath
  }

  return null
}
