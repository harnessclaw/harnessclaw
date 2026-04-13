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
export const HARNESSCLAW_WORKSPACE_DIR = join(HARNESSCLAW_DIR, 'workspace')
export const HARNESSCLAW_SKILLS_DIR = join(HARNESSCLAW_WORKSPACE_DIR, 'skills')
export const APP_RESOURCES_DIR = app.isPackaged
  ? process.resourcesPath
  : join(process.cwd(), 'resources')
export const BUNDLED_BIN_DIR = join(APP_RESOURCES_DIR, 'bin')

const HOME_DIRS = [
  HARNESSCLAW_DIR,
  join(HARNESSCLAW_DIR, 'bin'),
  join(HARNESSCLAW_DIR, 'cron'),
  join(HARNESSCLAW_DIR, 'db'),
  join(HARNESSCLAW_DIR, 'logs'),
  HARNESSCLAW_WORKSPACE_DIR,
  HARNESSCLAW_SKILLS_DIR,
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function hasProviderContent(value: unknown): boolean {
  const provider = asPlainObject(value)
  return Boolean(
    asString(provider.apiKey) ||
    asString(provider.apiBase) ||
    asString(provider.api_key) ||
    asString(provider.base_url) ||
    asString(provider.model),
  )
}

function toUiProvider(value: unknown): Record<string, unknown> {
  const provider = asPlainObject(value)
  return {
    apiKey: asString(provider.apiKey || provider.api_key),
    apiBase: asString(provider.apiBase || provider.base_url),
    model: asString(provider.model, provider.model ? '' : 'xopglm5'),
  }
}

function toEngineProvider(value: unknown, fallbackModel = 'xopglm5'): Record<string, unknown> {
  const provider = asPlainObject(value)
  return {
    api_key: asString(provider.api_key || provider.apiKey),
    base_url: asString(provider.base_url || provider.apiBase),
    model: asString(provider.model, fallbackModel),
    max_tokens: typeof provider.max_tokens === 'number'
      ? provider.max_tokens
      : typeof provider.maxTokens === 'number'
        ? provider.maxTokens
        : 16384,
  }
}

function getDefaultEngineConfig(): Record<string, unknown> {
  return {
    server: {
      host: '127.0.0.1',
      port: 8080,
    },
    log: {
      level: 'info',
      format: 'console',
      output: 'stdout',
    },
    llm: {
      default_provider: 'openai',
      max_retries: 3,
      api_timeout: '120s',
      providers: {
        openai: {
          api_key: '',
          base_url: '',
          model: 'xopglm5',
          max_tokens: 16384,
        },
        anthropic: {
          api_key: '',
          base_url: '',
          model: '',
          max_tokens: 16384,
        },
      },
      bifrost: {
        enabled: false,
        provider: '',
        model: '',
        api_key: '',
        base_url: '',
      },
    },
    engine: {
      max_turns: 24,
      auto_compact_threshold: 0.8,
      tool_timeout: '120s',
    },
    session: {
      max_messages: 200,
      idle_timeout: '30m',
      storage: 'memory',
    },
    channels: {
      websocket: {
        enabled: true,
        host: '0.0.0.0',
        port: 8081,
        path: '/ws',
        write_buffer: 256,
        ping_interval: '30s',
        write_timeout: '10s',
        max_message_size: 524288,
        client_tools: true,
        token: '',
      },
      http: {
        enabled: false,
        host: '127.0.0.1',
        port: 0,
        path: '/api/v1',
      },
      feishu: {
        enabled: false,
        host: '127.0.0.1',
        port: 0,
      },
    },
    tools: {
      bash: {
        enabled: true,
        timeout: '60s',
        sandbox: false,
      },
      file_read: {
        enabled: true,
      },
      file_edit: {
        enabled: true,
      },
      file_write: {
        enabled: true,
      },
      grep: {
        enabled: true,
      },
      glob: {
        enabled: true,
      },
      web_fetch: {
        enabled: true,
        timeout: '30s',
      },
    },
    permission: {
      mode: 'default',
      allowed_tools: [],
      denied_tools: [],
    },
    skills: {
      dirs: [HARNESSCLAW_SKILLS_DIR],
    },
    providers: {
      openai: {
        apiKey: '',
        apiBase: '',
        model: 'xopglm5',
      },
      anthropic: {
        apiKey: '',
        apiBase: '',
        model: '',
      },
    },
    agents: {
      defaults: {
        workspace: '~/.harnessclaw/workspace',
        provider: 'openai',
        model: 'xopglm5',
      },
    },
    gateway: {
      host: '127.0.0.1',
      port: 18790,
      heartbeat: {
        enabled: true,
        intervalS: 1800,
      },
    },
    auth: {
      mode: 'token',
      token: '',
    },
    clawhub: {
      token: '',
    },
  }
}

function getDefaultHarnessclawConfig(): Record<string, unknown> {
  return {
    ui: {
      theme: 'system',
    },
  }
}

function normalizeEngineConfig(data: unknown): Record<string, unknown> {
  const base = getDefaultEngineConfig()
  const source = asPlainObject(data)
  const normalized: Record<string, unknown> = {
    ...base,
    ...source,
  }

  const llm = {
    ...asPlainObject(base.llm),
    ...asPlainObject(source.llm),
  }
  const currentProviders = {
    ...asPlainObject(asPlainObject(base.llm).providers),
    ...asPlainObject(llm.providers),
  }
  const rootProviders = asPlainObject(source.providers)
  const fallbackModel = asString(
    asPlainObject(asPlainObject(source.agents).defaults).model,
    'xopglm5',
  )

  if (hasProviderContent(rootProviders.custom)) {
    currentProviders.openai = {
      ...toEngineProvider(currentProviders.openai, fallbackModel),
      ...toEngineProvider(rootProviders.custom, fallbackModel),
    }
  }

  if (hasProviderContent(rootProviders.openai)) {
    currentProviders.openai = {
      ...toEngineProvider(currentProviders.openai, fallbackModel),
      ...toEngineProvider(rootProviders.openai, fallbackModel),
    }
  }

  if (hasProviderContent(rootProviders.anthropic)) {
    currentProviders.anthropic = {
      ...toEngineProvider(currentProviders.anthropic, fallbackModel),
      ...toEngineProvider(rootProviders.anthropic, fallbackModel),
    }
  }

  const requestedProvider = asString(llm.default_provider, 'openai')
  const defaultProvider = requestedProvider === 'anthropic' ? 'anthropic' : 'openai'
  if (!currentProviders[defaultProvider]) {
    currentProviders[defaultProvider] = toEngineProvider({}, fallbackModel)
  }

  normalized.llm = {
    ...llm,
    default_provider: defaultProvider,
    providers: currentProviders,
  }

  const websocket = {
    ...asPlainObject(asPlainObject(base.channels).websocket),
    ...asPlainObject(asPlainObject(source.channels).websocket),
  }
  const legacyHarnessclawChannel = asPlainObject(asPlainObject(source.channels).harnessclaw)
  if (!('token' in websocket) && typeof legacyHarnessclawChannel.token === 'string') {
    websocket.token = legacyHarnessclawChannel.token
  }
  normalized.channels = {
    ...asPlainObject(base.channels),
    ...asPlainObject(source.channels),
    websocket,
  }

  normalized.providers = {
    ...asPlainObject(base.providers),
    ...rootProviders,
    openai: toUiProvider(currentProviders.openai),
    anthropic: toUiProvider(currentProviders.anthropic),
    custom: hasProviderContent(rootProviders.custom)
      ? toUiProvider(rootProviders.custom)
      : toUiProvider(currentProviders.openai),
  }

  normalized.agents = {
    ...asPlainObject(base.agents),
    ...asPlainObject(source.agents),
    defaults: {
      ...asPlainObject(asPlainObject(base.agents).defaults),
      ...asPlainObject(asPlainObject(source.agents).defaults),
      model: fallbackModel,
      workspace: '~/.harnessclaw/workspace',
      provider: defaultProvider,
    },
  }

  normalized.gateway = {
    ...asPlainObject(base.gateway),
    ...asPlainObject(source.gateway),
  }
  normalized.auth = {
    ...asPlainObject(base.auth),
    ...asPlainObject(source.auth),
  }
  normalized.clawhub = {
    ...asPlainObject(base.clawhub),
    ...asPlainObject(source.clawhub),
  }

  return normalized
}

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
  if (!existsSync(HARNESSCLAW_CONFIG_PATH)) {
    return { ...getDefaultHarnessclawConfig(), ...fallback }
  }
  return readJsonConfig(HARNESSCLAW_CONFIG_PATH, fallback)
}

export function saveHarnessclawConfig(data: unknown): { ok: boolean; error?: string } {
  return saveJsonConfig(HARNESSCLAW_CONFIG_PATH, {
    ...getDefaultHarnessclawConfig(),
    ...asPlainObject(data),
  })
}

export function readEngineConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (existsSync(ENGINE_CONFIG_PATH)) {
    return normalizeEngineConfig(readYamlConfig(ENGINE_CONFIG_PATH, fallback))
  }
  if (existsSync(LEGACY_ENGINE_CONFIG_PATH)) {
    return normalizeEngineConfig(readJsonConfig(LEGACY_ENGINE_CONFIG_PATH, fallback))
  }
  return { ...normalizeEngineConfig({}), ...fallback }
}

export function saveEngineConfig(data: unknown): { ok: boolean; error?: string } {
  return saveYamlConfig(ENGINE_CONFIG_PATH, normalizeEngineConfig(data))
}

export function ensureHarnessclawHomeInitialized(): void {
  HOME_DIRS.forEach(ensureDir)

  if (!existsSync(HARNESSCLAW_CONFIG_PATH)) {
    saveHarnessclawConfig(getDefaultHarnessclawConfig())
  }

  if (!existsSync(ENGINE_CONFIG_PATH)) {
    const seed = existsSync(LEGACY_ENGINE_CONFIG_PATH)
      ? readJsonConfig(LEGACY_ENGINE_CONFIG_PATH, {})
      : {}
    saveEngineConfig(seed)
  }
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
