import { app } from 'electron'
import { dirname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import {
  getConfigDocument,
  saveConfigDocument,
  type ConfigScope,
  type ConfigStorageFormat,
} from './db'

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
    const serialized = serializeYaml(data)
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

function parseYamlText(text: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const parsed = yaml.load(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : fallback
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

function serializeYaml(data: unknown): string {
  const serialized = yaml.dump(data, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  })
  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}

function persistConfigDocument(
  scope: ConfigScope,
  storageFormat: ConfigStorageFormat,
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
  storageFormat: ConfigStorageFormat,
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

function seedEngineConfigDocument(): { ok: boolean; payloadText?: string; error?: string } {
  try {
    if (existsSync(ENGINE_CONFIG_PATH)) {
      return { ok: true, payloadText: readText(ENGINE_CONFIG_PATH) }
    }

    if (!existsSync(ENGINE_CONFIG_TEMPLATE_PATH)) {
      return {
        ok: false,
        error: `Engine config template not found at ${ENGINE_CONFIG_TEMPLATE_PATH}`,
      }
    }

    copyFileSync(ENGINE_CONFIG_TEMPLATE_PATH, ENGINE_CONFIG_PATH)
    return { ok: true, payloadText: readText(ENGINE_CONFIG_PATH) }
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

  const stored = getConfigDocument('engine')
  if (stored) {
    if (!existsSync(ENGINE_CONFIG_PATH)) {
      const syncText = stored.storage_format === 'yaml'
        ? stored.payload_text
        : serializeYaml(parseJsonText(stored.payload_text, fallback))
      writeText(ENGINE_CONFIG_PATH, syncText)
    }

    return stored.storage_format === 'yaml'
      ? parseYamlText(stored.payload_text, fallback)
      : parseJsonText(stored.payload_text, fallback)
  }

  const fileConfig = readYamlConfig(ENGINE_CONFIG_PATH, fallback)
  if (existsSync(ENGINE_CONFIG_PATH)) {
    void persistConfigDocument('engine', 'yaml', readText(ENGINE_CONFIG_PATH))
  }
  return fileConfig
}

export function saveEngineConfig(data: unknown): { ok: boolean; error?: string } {
  const initialized = ensureEngineConfigInitialized()
  if (!initialized.ok) return initialized

  const payloadText = serializeYaml(data)
  const persisted = persistConfigDocument('engine', 'yaml', payloadText)
  if (!persisted.ok) return persisted

  return saveYamlConfig(ENGINE_CONFIG_PATH, data)
}

export function ensureEngineConfigInitialized(): { ok: boolean; created?: boolean; error?: string } {
  ensureDir(HARNESSCLAW_DIR)
  const stored = getConfigDocument('engine')

  if (stored && !existsSync(ENGINE_CONFIG_PATH)) {
    const payloadText = stored.storage_format === 'yaml'
      ? stored.payload_text
      : serializeYaml(parseJsonText(stored.payload_text, {}))
    writeText(ENGINE_CONFIG_PATH, payloadText)
    return { ok: true, created: true }
  }

  if (existsSync(ENGINE_CONFIG_PATH) && stored) {
    return { ok: true, created: false }
  }

  if (existsSync(ENGINE_CONFIG_PATH) && !stored) {
    const payloadText = readText(ENGINE_CONFIG_PATH)
    const persisted = persistConfigDocument('engine', 'yaml', payloadText)
    return {
      ok: persisted.ok,
      created: false,
      error: persisted.error,
    }
  }

  const initialized = ensureConfigDocumentInitialized('engine', 'yaml', seedEngineConfigDocument)
  if (!initialized.ok) {
    return initialized
  }

  const payloadText = getConfigDocument('engine')?.payload_text
  if (typeof payloadText === 'string') {
    writeText(ENGINE_CONFIG_PATH, payloadText)
  }

  return initialized
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
