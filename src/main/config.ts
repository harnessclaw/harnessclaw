import { app } from 'electron'
import { dirname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { deleteConfigDocument, getConfigDocument, saveConfigDocument, type ConfigScope } from './db'

const yaml = require('js-yaml') as {
  load: (source: string) => unknown
  dump: (value: unknown, options?: Record<string, unknown>) => string
}

export const HARNESSCLAW_DIR = join(homedir(), '.harnessclaw')
export const ENGINE_CONFIG_PATH = join(HARNESSCLAW_DIR, 'harnessclaw-engine.yaml')
export const LEGACY_APP_CONFIG_PATH = join(HARNESSCLAW_DIR, 'harnessclaw.json')
export const APP_RESOURCES_DIR = app.isPackaged
  ? process.resourcesPath
  : join(process.cwd(), 'resources')
export const BUNDLED_BIN_DIR = join(APP_RESOURCES_DIR, 'bin')
export const ENGINE_CONFIG_TEMPLATE_PATH = join(APP_RESOURCES_DIR, 'templates', 'harnessclaw-engine.yaml')

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

function readText(path: string): string {
  return readFileSync(path, 'utf-8')
}

function writeText(path: string, content: string): void {
  ensureDir(dirname(path))
  writeFileSync(path, content, 'utf-8')
}

function parseJsonText(text: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : fallback
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

function persistConfigDocument(
  scope: ConfigScope,
  storageFormat: 'json',
  payloadText: string,
): { ok: boolean; error?: string } {
  try {
    saveConfigDocument({
      scope,
      storageFormat,
      payloadText,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function ensureConfigDocumentInitialized(
  scope: ConfigScope,
  storageFormat: 'json',
  seed: () => { ok: boolean; payloadText?: string; error?: string },
): { ok: boolean; created?: boolean; error?: string } {
  const existing = getConfigDocument(scope)
  if (existing) {
    return { ok: true, created: false }
  }

  const seeded = seed()
  if (!seeded.ok || typeof seeded.payloadText !== 'string') {
    return { ok: false, error: seeded.error || `Unable to seed ${scope} config` }
  }

  return {
    ...persistConfigDocument(scope, storageFormat, seeded.payloadText),
    created: true,
  }
}

function seedAppConfigDocument(): { ok: boolean; payloadText?: string; error?: string } {
  try {
    if (existsSync(LEGACY_APP_CONFIG_PATH)) {
      const raw = readText(LEGACY_APP_CONFIG_PATH)
      const parsed = parseJsonText(raw, {})
      return { ok: true, payloadText: `${JSON.stringify(parsed, null, 2)}\n` }
    }

    return { ok: true, payloadText: '{}\n' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function migrateLegacyEngineConfigFromDatabase(): { ok: boolean; migrated?: boolean; error?: string } {
  try {
    if (existsSync(ENGINE_CONFIG_PATH)) {
      if (getConfigDocument('engine')) {
        deleteConfigDocument('engine')
      }
      return { ok: true, migrated: false }
    }

    const legacyDocument = getConfigDocument('engine')
    if (!legacyDocument) {
      return { ok: true, migrated: false }
    }

    if (legacyDocument.storage_format === 'yaml') {
      writeText(ENGINE_CONFIG_PATH, legacyDocument.payload_text)
    } else {
      const parsed = parseJsonText(legacyDocument.payload_text, {})
      const result = saveYamlConfig(ENGINE_CONFIG_PATH, parsed)
      if (!result.ok) {
        return result
      }
    }

    deleteConfigDocument('engine')
    return { ok: true, migrated: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function ensureHarnessclawConfigInitialized(): { ok: boolean; created?: boolean; error?: string } {
  ensureDir(HARNESSCLAW_DIR)
  return ensureConfigDocumentInitialized('app', 'json', seedAppConfigDocument)
}

export function readHarnessclawConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const initialized = ensureHarnessclawConfigInitialized()
  if (!initialized.ok) {
    return { ...fallback, _error: initialized.error || 'Unable to initialize app config document' }
  }

  const stored = getConfigDocument('app')
  if (!stored) return fallback
  return parseJsonText(stored.payload_text, fallback)
}

export function saveHarnessclawConfig(data: unknown): { ok: boolean; error?: string } {
  const initialized = ensureHarnessclawConfigInitialized()
  if (!initialized.ok) return initialized
  return persistConfigDocument('app', 'json', `${JSON.stringify(data, null, 2)}\n`)
}

export function readEngineConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const initialized = ensureEngineConfigInitialized()
  if (!initialized.ok) {
    return { ...fallback, _error: initialized.error || 'Unable to initialize engine config file' }
  }
  return readYamlConfig(ENGINE_CONFIG_PATH, fallback)
}

export function saveEngineConfig(data: unknown): { ok: boolean; error?: string } {
  const initialized = ensureEngineConfigInitialized()
  if (!initialized.ok) return initialized
  return saveYamlConfig(ENGINE_CONFIG_PATH, data)
}

export function ensureEngineConfigInitialized(): { ok: boolean; created?: boolean; error?: string } {
  ensureDir(HARNESSCLAW_DIR)
  const migrated = migrateLegacyEngineConfigFromDatabase()
  if (!migrated.ok) {
    return { ok: false, error: migrated.error }
  }

  if (existsSync(ENGINE_CONFIG_PATH)) {
    return { ok: true, created: false }
  }

  if (!existsSync(ENGINE_CONFIG_TEMPLATE_PATH)) {
    return {
      ok: false,
      error: `Engine config template not found at ${ENGINE_CONFIG_TEMPLATE_PATH}`,
    }
  }

  copyFileSync(ENGINE_CONFIG_TEMPLATE_PATH, ENGINE_CONFIG_PATH)
  return { ok: true, created: true }
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
