import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, join, posix, relative, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { ensureDir, HARNESSCLAW_DIR, readJsonConfig } from './config'
import { getDb } from './db'
import { SKILL_REPOS_CACHE_DIR } from './runtime-paths'
const yaml = require('js-yaml') as {
  load: (input: string) => unknown
}

const SKILLS_DIR = join(HARNESSCLAW_DIR, 'workspace', 'skills')
const LEGACY_SKILL_MARKET_CONFIG_PATH = join(HARNESSCLAW_DIR, 'skill-market.json')
const INSTALL_SOURCE_FILE = '.harnessclaw-source.json'

let storageReady = false
let legacyRepositoriesMigrated = false
let activeDiscoveryTask: { id: string; worker: Worker; repositoryId?: string } | null = null

export interface SkillRepositoryProxy {
  enabled: boolean
  protocol: 'http' | 'https' | 'socks5'
  host: string
  port: string
}

export interface SkillSourceInfo {
  key: string
  repoId: string
  repoName: string
  repoUrl: string
  branch: string
  path: string
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  allowedTools: string
  hasReferences: boolean
  hasTemplates: boolean
  source?: SkillSourceInfo
}

export interface SkillRepository {
  id: string
  name: string
  provider: 'github'
  repoUrl: string
  owner: string
  repo: string
  branch: string
  basePath: string
  proxy: SkillRepositoryProxy
  enabled: boolean
  lastDiscoveredAt?: number
  lastError?: string
}

export interface SkillRepositoryDraft {
  id?: string
  name?: string
  repoUrl: string
  branch?: string
  basePath?: string
  proxy?: Partial<SkillRepositoryProxy>
  enabled?: boolean
}

export interface DiscoveredSkill {
  key: string
  repoId: string
  repoName: string
  repoUrl: string
  owner: string
  repo: string
  branch: string
  skillPath: string
  directoryName: string
  name: string
  description: string
  allowedTools: string
  hasReferences: boolean
  hasTemplates: boolean
}

export interface SkillDiscoveryEvent {
  type: 'started' | 'finished' | 'failed'
  taskId: string
  repositoryId?: string
  repositoryCount?: number
  successCount?: number
  errorCount?: number
  skillCount?: number
  error?: string
}

interface SkillDiscoveryLaunchResult {
  ok: boolean
  started: boolean
  taskId?: string
  error?: string
}

interface SkillMarkdownMeta {
  name: string
  description: string
  allowedTools: string
}

const DEFAULT_PROXY_PROTOCOL: SkillRepositoryProxy['protocol'] = 'http'

function createDefaultRepositoryProxy(): SkillRepositoryProxy {
  return {
    enabled: false,
    protocol: DEFAULT_PROXY_PROTOCOL,
    host: '',
    port: '',
  }
}

function ensureStorageReady(): void {
  if (storageReady) return
  ensureDir(SKILLS_DIR)
  ensureDir(SKILL_REPOS_CACHE_DIR)
  migrateLegacyRepositoriesToDb()
  syncInstalledSkillsToDb()
  storageReady = true
}

function normalizeRepoPath(input: string): string {
  const normalized = input
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
  return normalized === '.' ? '' : normalized
}

function normalizeRepositoryUrl(input: string): string {
  return input.trim().replace(/\.git$/i, '')
}

function normalizeProxyProtocol(input: unknown): SkillRepositoryProxy['protocol'] {
  return input === 'https' || input === 'socks5' ? input : DEFAULT_PROXY_PROTOCOL
}

function parseLegacyProxyRecord(raw: Record<string, unknown>): Partial<SkillRepositoryProxy> {
  const nestedProxy = typeof raw.proxy === 'object' && raw.proxy !== null && !Array.isArray(raw.proxy)
    ? raw.proxy as Record<string, unknown>
    : null
  const candidate = nestedProxy || raw

  return {
    enabled: nestedProxy
      ? candidate.enabled === true || candidate.proxyEnabled === true
      : raw.proxyEnabled === true,
    protocol: normalizeProxyProtocol(candidate.protocol ?? candidate.proxyProtocol),
    host: typeof candidate.host === 'string'
      ? candidate.host
      : typeof candidate.proxyHost === 'string'
        ? candidate.proxyHost
        : '',
    port: typeof candidate.port === 'string'
      ? candidate.port
      : typeof candidate.port === 'number'
        ? String(candidate.port)
        : typeof candidate.proxyPort === 'string'
          ? candidate.proxyPort
          : typeof candidate.proxyPort === 'number'
            ? String(candidate.proxyPort)
            : '',
  }
}

function normalizeRepositoryProxy(
  input?: Partial<SkillRepositoryProxy>,
  fallback?: SkillRepositoryProxy
): SkillRepositoryProxy {
  const base = fallback || createDefaultRepositoryProxy()

  return {
    enabled: input?.enabled ?? base.enabled,
    protocol: normalizeProxyProtocol(input?.protocol ?? base.protocol),
    host: (input?.host ?? base.host).trim(),
    port: String(input?.port ?? base.port).trim(),
  }
}

function validateRepositoryProxy(proxy: SkillRepositoryProxy): SkillRepositoryProxy {
  const normalized = normalizeRepositoryProxy(proxy)
  if (!normalized.enabled) {
    return normalized
  }

  if (!normalized.host) {
    throw new Error('启用代理时必须填写代理主机')
  }

  if (!normalized.port) {
    throw new Error('启用代理时必须填写代理端口')
  }

  if (!/^\d{1,5}$/.test(normalized.port)) {
    throw new Error('代理端口格式无效')
  }

  const port = Number(normalized.port)
  if (port < 1 || port > 65535) {
    throw new Error('代理端口必须在 1-65535 之间')
  }

  return normalized
}

function buildProxyUrl(proxy: SkillRepositoryProxy): string | null {
  if (!proxy.enabled || !proxy.host || !proxy.port) return null
  return `${proxy.protocol}://${proxy.host}:${proxy.port}`
}

function parseGitHubRepository(inputUrl: string, branchOverride?: string, basePathOverride?: string): {
  repoUrl: string
  owner: string
  repo: string
  branch: string
  basePath: string
} {
  const trimmed = normalizeRepositoryUrl(inputUrl)
  const normalizedInput = /^[\w.-]+\/[\w.-]+$/.test(trimmed) ? `https://github.com/${trimmed}` : trimmed
  const url = new URL(normalizedInput)
  if (url.hostname !== 'github.com') {
    throw new Error('当前仅支持 GitHub 仓库地址')
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error('仓库地址无效')
  }

  const owner = parts[0]
  const repo = parts[1]
  let branch = branchOverride?.trim() || 'main'
  let basePath = normalizeRepoPath(basePathOverride || '')

  if (parts[2] === 'tree' && parts[3] && !branchOverride) {
    branch = parts[3]
    if (!basePathOverride) {
      basePath = normalizeRepoPath(parts.slice(4).join('/'))
    }
  }

  return {
    repoUrl: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    branch,
    basePath,
  }
}

function makeRepositoryId(owner: string, repo: string, branch: string, basePath: string): string {
  return `github:${owner}/${repo}:${branch}:${basePath || '.'}`
}

function makeDiscoveryKey(repoId: string, skillPath: string): string {
  return `${repoId}::${skillPath || '.'}`
}

function sanitizeInstallId(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'skill'
}

function normalizeInstalledSkillId(input: string): string {
  const normalized = normalizeRepoPath(input)
  if (!normalized) {
    throw new Error('Invalid skill id')
  }

  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid skill id')
  }

  return normalized
}

function hashString(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-')
}

function stripMarkdownFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

function toSingleLineText(value: unknown): string {
  if (typeof value === 'string') {
    return value
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => toSingleLineText(item))
      .filter(Boolean)
      .join(', ')
      .trim()
  }

  return ''
}

function isSkillDescriptionPlaceholder(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '|' || trimmed === '>'
}

function extractHeadingName(markdownBody: string): string {
  const lines = markdownBody.replace(/\r\n/g, '\n').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = trimmed.match(/^#\s+(.+)$/)
    if (heading?.[1]) {
      return heading[1].trim()
    }
  }
  return ''
}

function extractBodyDescription(markdownBody: string): string {
  const lines = markdownBody.replace(/\r\n/g, '\n').split('\n')
  const paragraph: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (paragraph.length > 0) break
      continue
    }

    if (/^#\s+/.test(trimmed)) continue
    if (/^---+$/.test(trimmed)) continue
    if (/^[-*+]\s+/.test(trimmed)) continue
    if (/^\d+\.\s+/.test(trimmed)) continue
    if (/^>\s*/.test(trimmed)) continue

    paragraph.push(trimmed)
  }

  return paragraph.join(' ').trim()
}

function readSkillMarkdownMeta(content: string, fallbackName: string): SkillMarkdownMeta {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const body = stripMarkdownFrontmatter(content)
  let meta: Record<string, unknown> = {}

  if (match) {
    try {
      const parsed = yaml.load(match[1])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>
      }
    } catch {
      meta = {}
    }
  }

  const parsedName = toSingleLineText(meta.name)
  const parsedDescription = toSingleLineText(meta.description)
  const parsedAllowedTools = toSingleLineText(
    meta['allowed-tools'] ?? meta.allowed_tools ?? meta.allowedTools ?? meta.tools
  )
  const headingName = extractHeadingName(body)
  const bodyDescription = extractBodyDescription(body)
  const normalizedDescription = isSkillDescriptionPlaceholder(parsedDescription)
    ? ''
    : parsedDescription

  return {
    name: parsedName || headingName || fallbackName,
    description: normalizedDescription || bodyDescription,
    allowedTools: parsedAllowedTools,
  }
}

function readInstallSource(skillDir: string): SkillSourceInfo | undefined {
  try {
    const sourcePath = join(skillDir, INSTALL_SOURCE_FILE)
    if (!existsSync(sourcePath)) return undefined
    const raw = JSON.parse(readFileSync(sourcePath, 'utf-8')) as Record<string, unknown>
    if (
      typeof raw.key === 'string' &&
      typeof raw.repoId === 'string' &&
      typeof raw.repoName === 'string' &&
      typeof raw.repoUrl === 'string' &&
      typeof raw.branch === 'string' &&
      typeof raw.path === 'string'
    ) {
      return {
        key: raw.key,
        repoId: raw.repoId,
        repoName: raw.repoName,
        repoUrl: raw.repoUrl,
        branch: raw.branch,
        path: raw.path,
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function discoveryWorkerMain(): void {
  const { parentPort, workerData } = require('node:worker_threads')
  const { execFileSync } = require('node:child_process')
  const { createHash } = require('node:crypto')
  const { basename, dirname, join, relative, resolve } = require('node:path')
  const { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } = require('node:fs')
  const yaml = require('js-yaml') as {
    load: (input: string) => unknown
  }

  const cacheDir = workerData.cacheDir
  const repositories = Array.isArray(workerData.repositories) ? workerData.repositories : []

  const ensureDir = (path: string): void => {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true })
    }
  }

  const normalizeRepoPath = (input: string): string => {
    const normalized = String(input || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .trim()
    return normalized === '.' ? '' : normalized
  }

  const normalizeRepositoryUrl = (input: string): string => String(input || '').trim().replace(/\.git$/i, '')
  const hashString = (input: string): string => createHash('sha1').update(input).digest('hex')

  const buildProxyUrl = (proxy: { enabled?: boolean; protocol?: string; host?: string; port?: string }): string | null => {
    if (!proxy?.enabled || !proxy.host || !proxy.port) return null
    return `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`
  }

  const gitEnvForRepository = (repository: { proxy?: { enabled?: boolean; protocol?: string; host?: string; port?: string } }) => {
    const env = { ...process.env }
    const proxyUrl = buildProxyUrl(repository.proxy || {})
    if (!proxyUrl) return env
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
    env.ALL_PROXY = proxyUrl
    env.http_proxy = proxyUrl
    env.https_proxy = proxyUrl
    env.all_proxy = proxyUrl
    return env
  }

  const gitArgsForRepository = (args: string[], repository: { proxy?: { enabled?: boolean; protocol?: string; host?: string; port?: string } }) => {
    const proxyUrl = buildProxyUrl(repository.proxy || {})
    if (!proxyUrl) return args
    return ['-c', `http.proxy=${proxyUrl}`, '-c', `https.proxy=${proxyUrl}`, ...args]
  }

  const runGit = (args: string[], cwd: string | undefined, repository: { proxy?: { enabled?: boolean; protocol?: string; host?: string; port?: string } }) => {
    try {
      execFileSync('git', gitArgsForRepository(args, repository), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gitEnvForRepository(repository),
      })
    } catch (error) {
      const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
      const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf-8')
      const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf-8')
      const message = stderr?.trim() || stdout?.trim() || err.message || 'git command failed'
      throw new Error(`SKILL_GIT_ERROR: ${message}`)
    }
  }

  const runGitCapture = (args: string[], cwd: string | undefined, repository: { proxy?: { enabled?: boolean; protocol?: string; host?: string; port?: string } }): string => {
    try {
      return execFileSync('git', gitArgsForRepository(args, repository), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        env: gitEnvForRepository(repository),
      }).trim()
    } catch (error) {
      const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
      const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf-8')
      const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf-8')
      const message = stderr?.trim() || stdout?.trim() || err.message || 'git command failed'
      throw new Error(`SKILL_GIT_ERROR: ${message}`)
    }
  }

  const isRemoteBranchNotFound = (message: string): boolean => {
    const value = String(message).toLowerCase()
    return (
      (value.includes('remote branch') && value.includes('not found')) ||
      value.includes('could not find remote ref') ||
      value.includes('couldn\'t find remote ref')
    )
  }

  const detectRemoteDefaultBranch = (repository: { repoUrl: string; proxy?: { enabled?: boolean; protocol?: string; host?: string; port?: string } }): string | null => {
    try {
      const output = runGitCapture(['ls-remote', '--symref', repository.repoUrl, 'HEAD'], undefined, repository)
      const match = output.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/)
      return match?.[1]?.trim() || null
    } catch {
      return null
    }
  }

  const repositoryCacheDir = (repository: { repoUrl: string; branch: string }): string => {
    const key = `${normalizeRepositoryUrl(repository.repoUrl)}#${String(repository.branch || '').trim()}`
    return join(cacheDir, hashString(key))
  }

  const ensureDirectoryWithin = (parentDir: string, targetDir: string): string => {
    const parent = resolve(parentDir)
    const target = resolve(targetDir)
    if (target !== parent && !target.startsWith(`${parent}/`) && !target.startsWith(`${parent}\\`)) {
      throw new Error('仓库路径无效')
    }
    return target
  }

  const skillRootForRepository = (repository: { basePath?: string }, repoDir: string): string => {
    const basePath = normalizeRepoPath(repository.basePath || '')
    if (!basePath) return repoDir
    return ensureDirectoryWithin(repoDir, join(repoDir, basePath))
  }

  const stripMarkdownFrontmatter = (content: string): string => (
    content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  )

  const toSingleLineText = (value: unknown): string => {
    if (typeof value === 'string') {
      return value
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .join(' ')
        .trim()
    }

    if (Array.isArray(value)) {
      return value
        .map((item: unknown) => toSingleLineText(item))
        .filter(Boolean)
        .join(', ')
        .trim()
    }

    return ''
  }

  const isSkillDescriptionPlaceholder = (value: string): boolean => {
    const trimmed = value.trim()
    return trimmed === '|' || trimmed === '>'
  }

  const extractHeadingName = (markdownBody: string): string => {
    const lines = markdownBody.replace(/\r\n/g, '\n').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const heading = trimmed.match(/^#\s+(.+)$/)
      if (heading?.[1]) {
        return heading[1].trim()
      }
    }
    return ''
  }

  const extractBodyDescription = (markdownBody: string): string => {
    const lines = markdownBody.replace(/\r\n/g, '\n').split('\n')
    const paragraph: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        if (paragraph.length > 0) break
        continue
      }

      if (/^#\s+/.test(trimmed)) continue
      if (/^---+$/.test(trimmed)) continue
      if (/^[-*+]\s+/.test(trimmed)) continue
      if (/^\d+\.\s+/.test(trimmed)) continue
      if (/^>\s*/.test(trimmed)) continue

      paragraph.push(trimmed)
    }

    return paragraph.join(' ').trim()
  }

  const readSkillMarkdownMeta = (content: string, fallbackName: string) => {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    const body = stripMarkdownFrontmatter(content)
    let meta: Record<string, unknown> = {}

    if (match) {
      try {
        const parsed = yaml.load(match[1])
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>
        }
      } catch {
        meta = {}
      }
    }

    return {
      name: toSingleLineText(meta.name) || extractHeadingName(body) || fallbackName,
      description: (() => {
        const parsedDescription = toSingleLineText(meta.description)
        return (isSkillDescriptionPlaceholder(parsedDescription) ? '' : parsedDescription) || extractBodyDescription(body)
      })(),
      allowedTools: toSingleLineText(meta['allowed-tools'] ?? meta.allowed_tools ?? meta.allowedTools ?? meta.tools),
    }
  }

  const findSkillMarkdownFiles = (root: string): string[] => {
    const out: string[] = []
    const stack = [root]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current || !existsSync(current)) continue
      const entries = readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(current, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '.git') continue
          stack.push(fullPath)
          continue
        }
        if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
          out.push(fullPath)
        }
      }
    }
    return out
  }

  const scanRepositorySkills = (repository: { id: string; name: string; repoUrl: string; owner: string; repo: string; branch: string; basePath?: string }, repoDir: string) => {
    const root = skillRootForRepository(repository, repoDir)
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error('仓库扫描路径不存在')
    }

    return findSkillMarkdownFiles(root).map((skillMdPath) => {
      const skillDir = dirname(skillMdPath)
      const skillPath = relative(repoDir, skillDir).replace(/\\/g, '/')
      const content = readFileSync(skillMdPath, 'utf-8')
      const meta = readSkillMarkdownMeta(content, basename(skillDir))
      return {
        key: `${repository.id}::${skillPath || '.'}`,
        repoId: repository.id,
        repoName: repository.name,
        repoUrl: repository.repoUrl,
        owner: repository.owner,
        repo: repository.repo,
        branch: repository.branch,
        skillPath,
        directoryName: basename(skillDir),
        name: meta.name || basename(skillDir),
        description: meta.description,
        allowedTools: meta.allowedTools,
        hasReferences: existsSync(join(skillDir, 'references')),
        hasTemplates: existsSync(join(skillDir, 'templates')),
      }
    }).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  const ensureRepoCache = (repository: { repoUrl: string; branch: string; basePath?: string; proxy?: { enabled?: boolean; protocol?: string; host?: string; port?: string } }, refresh = true) => {
    ensureDir(cacheDir)
    const repoDir = repositoryCacheDir(repository)
    const gitDir = join(repoDir, '.git')
    let activeBranch = repository.branch

    const performSync = (branch: string): void => {
      if (!existsSync(gitDir)) {
        rmSync(repoDir, { recursive: true, force: true })
        ensureDir(dirname(repoDir))
        runGit(['clone', '--depth', '1', '--branch', branch, repository.repoUrl, repoDir], undefined, repository)
        return
      }

      if (refresh) {
        runGit(['remote', 'set-url', 'origin', repository.repoUrl], repoDir, repository)
        runGit(['fetch', '--depth', '1', 'origin', branch], repoDir, repository)
        runGit(['checkout', '-B', branch, 'FETCH_HEAD'], repoDir, repository)
        runGit(['clean', '-fd'], repoDir, repository)
      }
    }

    try {
      performSync(activeBranch)
    } catch (error) {
      const message = String(error)
      if (!isRemoteBranchNotFound(message)) {
        throw error
      }

      const fallbackBranch = detectRemoteDefaultBranch(repository)
      if (!fallbackBranch || fallbackBranch === activeBranch) {
        throw error
      }

      activeBranch = fallbackBranch
      performSync(activeBranch)
    }

    return { repoDir, branch: activeBranch }
  }

  try {
    const results = repositories.map((repository: Record<string, unknown>) => {
      try {
        const sync = ensureRepoCache(repository as never, true)
        const effectiveRepository = { ...repository, branch: sync.branch }
        const items = scanRepositorySkills(effectiveRepository as never, sync.repoDir)
        return {
          repositoryId: repository.id,
          branch: sync.branch,
          items,
          lastDiscoveredAt: Date.now(),
          lastError: null,
        }
      } catch (error) {
        return {
          repositoryId: repository.id,
          items: [],
          lastDiscoveredAt: undefined,
          lastError: String(error),
        }
      }
    })

    parentPort?.postMessage({ type: 'done', results })
  } catch (error) {
    parentPort?.postMessage({ type: 'error', error: String(error) })
  }
}

const DISCOVERY_WORKER_SOURCE = `(${discoveryWorkerMain.toString()})()`

function rowToRepository(row: Record<string, unknown>): SkillRepository {
  return {
    id: String(row.id),
    name: String(row.name),
    provider: 'github',
    repoUrl: String(row.repo_url),
    owner: String(row.owner),
    repo: String(row.repo),
    branch: String(row.branch),
    basePath: String(row.base_path || ''),
    proxy: normalizeRepositoryProxy({
      enabled: Number(row.proxy_enabled) !== 0,
      protocol: normalizeProxyProtocol(row.proxy_protocol),
      host: String(row.proxy_host || ''),
      port: String(row.proxy_port || ''),
    }),
    enabled: Number(row.enabled) !== 0,
    lastDiscoveredAt: typeof row.last_discovered_at === 'number' ? row.last_discovered_at : undefined,
    lastError: typeof row.last_error === 'string' && row.last_error.trim() ? row.last_error : undefined,
  }
}

function rowToDiscoveredSkill(row: Record<string, unknown>): DiscoveredSkill {
  const description = String(row.description || '')
  return {
    key: String(row.key),
    repoId: String(row.repo_id),
    repoName: String(row.repo_name),
    repoUrl: String(row.repo_url),
    owner: String(row.owner),
    repo: String(row.repo),
    branch: String(row.branch),
    skillPath: String(row.skill_path),
    directoryName: String(row.directory_name),
    name: String(row.name),
    description: isSkillDescriptionPlaceholder(description) ? '' : description,
    allowedTools: String(row.allowed_tools || ''),
    hasReferences: Number(row.has_references) !== 0,
    hasTemplates: Number(row.has_templates) !== 0,
  }
}

function rowToInstalledSkill(row: Record<string, unknown>): SkillInfo {
  const description = String(row.description || '')
  const source = row.source_key
    ? {
        key: String(row.source_key),
        repoId: String(row.source_repo_id || ''),
        repoName: String(row.source_repo_name || ''),
        repoUrl: String(row.source_repo_url || ''),
        branch: String(row.source_branch || ''),
        path: String(row.source_path || ''),
      }
    : undefined

  return {
    id: String(row.id),
    name: String(row.name),
    description: isSkillDescriptionPlaceholder(description) ? '' : description,
    allowedTools: String(row.allowed_tools || ''),
    hasReferences: Number(row.has_references) !== 0,
    hasTemplates: Number(row.has_templates) !== 0,
    source: source?.key ? source : undefined,
  }
}

function normalizeStoredRepository(raw: Record<string, unknown>): SkillRepository | null {
  if (typeof raw.repoUrl !== 'string' || typeof raw.owner !== 'string' || typeof raw.repo !== 'string') {
    return null
  }

  const branch = typeof raw.branch === 'string' && raw.branch.trim() ? raw.branch.trim() : 'main'
  const basePath = normalizeRepoPath(typeof raw.basePath === 'string' ? raw.basePath : '')
  const owner = raw.owner.trim()
  const repo = raw.repo.trim()
  const proxy = normalizeRepositoryProxy(parseLegacyProxyRecord(raw))

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : makeRepositoryId(owner, repo, branch, basePath),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : repo,
    provider: 'github',
    repoUrl: normalizeRepositoryUrl(raw.repoUrl),
    owner,
    repo,
    branch,
    basePath,
    proxy,
    enabled: raw.enabled !== false,
    lastDiscoveredAt: typeof raw.lastDiscoveredAt === 'number' ? raw.lastDiscoveredAt : undefined,
    lastError: typeof raw.lastError === 'string' && raw.lastError.trim() ? raw.lastError.trim() : undefined,
  }
}

function migrateLegacyRepositoriesToDb(): void {
  if (legacyRepositoriesMigrated) return
  legacyRepositoriesMigrated = true

  if (!existsSync(LEGACY_SKILL_MARKET_CONFIG_PATH)) return
  const raw = readJsonConfig(LEGACY_SKILL_MARKET_CONFIG_PATH, { repositories: [] })
  const repositories = Array.isArray(raw.repositories)
    ? raw.repositories
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map(normalizeStoredRepository)
        .filter(Boolean) as SkillRepository[]
    : []

  if (repositories.length === 0) return

  const db = getDb()
  const countRow = db.prepare('SELECT COUNT(1) as count FROM skill_repositories').get() as { count: number }
  if (countRow.count > 0) return

  const now = Date.now()
  const insert = db.prepare(`
    INSERT OR REPLACE INTO skill_repositories (
      id, name, provider, repo_url, owner, repo, branch, base_path,
      proxy_enabled, proxy_protocol, proxy_host, proxy_port,
      enabled, last_discovered_at, last_error, created_at, updated_at
    ) VALUES (
      @id, @name, @provider, @repo_url, @owner, @repo, @branch, @base_path,
      @proxy_enabled, @proxy_protocol, @proxy_host, @proxy_port,
      @enabled, @last_discovered_at, @last_error, @created_at, @updated_at
    )
  `)

  const tx = db.transaction((items: SkillRepository[]) => {
    items.forEach((repository) => {
      insert.run({
        id: repository.id,
        name: repository.name,
        provider: repository.provider,
        repo_url: repository.repoUrl,
        owner: repository.owner,
        repo: repository.repo,
        branch: repository.branch,
        base_path: repository.basePath,
        proxy_enabled: repository.proxy.enabled ? 1 : 0,
        proxy_protocol: repository.proxy.protocol,
        proxy_host: repository.proxy.host,
        proxy_port: repository.proxy.port,
        enabled: repository.enabled ? 1 : 0,
        last_discovered_at: repository.lastDiscoveredAt ?? null,
        last_error: repository.lastError ?? null,
        created_at: now,
        updated_at: now,
      })
    })
  })
  tx(repositories)
}

function syncInstalledSkillsToDb(): void {
  ensureDir(SKILLS_DIR)
  migrateInstalledSkillsIntoRepositoryFolders()
  const db = getDb()
  const directories = existsSync(SKILLS_DIR)
    ? findSkillMarkdownFiles(SKILLS_DIR)
        .map((filePath) => dirname(filePath))
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    : []

  const existingRows = db.prepare('SELECT id, created_at, source_key FROM installed_skills').all() as Array<{
    id: string
    created_at: number
    source_key: string | null
  }>
  const existingCreatedAt = new Map(existingRows.map((row) => [row.id, row.created_at]))
  const existingBySourceKey = new Map(
    existingRows
      .filter((row) => typeof row.source_key === 'string' && row.source_key.trim())
      .map((row) => [String(row.source_key), row])
  )
  const seen = new Set<string>()

  const upsert = db.prepare(`
    INSERT INTO installed_skills (
      id, name, description, allowed_tools, has_references, has_templates,
      source_key, source_repo_id, source_repo_name, source_repo_url, source_branch, source_path,
      created_at, updated_at
    ) VALUES (
      @id, @name, @description, @allowed_tools, @has_references, @has_templates,
      @source_key, @source_repo_id, @source_repo_name, @source_repo_url, @source_branch, @source_path,
      @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      allowed_tools = excluded.allowed_tools,
      has_references = excluded.has_references,
      has_templates = excluded.has_templates,
      source_key = excluded.source_key,
      source_repo_id = excluded.source_repo_id,
      source_repo_name = excluded.source_repo_name,
      source_repo_url = excluded.source_repo_url,
      source_branch = excluded.source_branch,
      source_path = excluded.source_path,
      updated_at = excluded.updated_at
  `)

  const tx = db.transaction(() => {
    const now = Date.now()
    directories.forEach((skillDir) => {
      const id = relative(SKILLS_DIR, skillDir).replace(/\\/g, '/')
      const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
      const meta = readSkillMarkdownMeta(content, id)
      const source = readInstallSource(skillDir)
      const existingBySource = source?.key ? existingBySourceKey.get(source.key) : undefined

      if (existingBySource?.id && existingBySource.id !== id) {
        db.prepare('DELETE FROM installed_skills WHERE id = ?').run(existingBySource.id)
        existingCreatedAt.set(id, existingBySource.created_at)
      }

      seen.add(id)
      upsert.run({
        id,
        name: meta.name || id,
        description: meta.description,
        allowed_tools: meta.allowedTools,
        has_references: existsSync(join(skillDir, 'references')) ? 1 : 0,
        has_templates: existsSync(join(skillDir, 'templates')) ? 1 : 0,
        source_key: source?.key ?? null,
        source_repo_id: source?.repoId ?? null,
        source_repo_name: source?.repoName ?? null,
        source_repo_url: source?.repoUrl ?? null,
        source_branch: source?.branch ?? null,
        source_path: source?.path ?? null,
        created_at: existingCreatedAt.get(id) ?? existingBySource?.created_at ?? now,
        updated_at: now,
      })
    })

    {
      const stale = existingRows.filter((row) => !seen.has(row.id))
      const remove = db.prepare('DELETE FROM installed_skills WHERE id = ?')
      stale.forEach((row) => remove.run(row.id))
    }
  })

  tx()
}

function migrateInstalledSkillsIntoRepositoryFolders(): void {
  if (!existsSync(SKILLS_DIR)) return

  const directChildren = readdirSync(SKILLS_DIR)
  directChildren.forEach((name) => {
    const skillDir = join(SKILLS_DIR, name)
    if (!statSync(skillDir).isDirectory()) return
    if (!existsSync(join(skillDir, 'SKILL.md'))) return

    const source = readInstallSource(skillDir)
    if (!source?.repoName) return

    const repoFolder = sanitizeInstallId(source.repoName)
    const targetRelativePath = `${repoFolder}/${name}`
    const targetDir = join(SKILLS_DIR, targetRelativePath)
    if (targetDir === skillDir || existsSync(targetDir)) return

    copyDirectoryRecursive(skillDir, targetDir)
    rmSync(skillDir, { recursive: true, force: true })
  })
}

function repositoryCacheDir(repository: Pick<SkillRepository, 'repoUrl' | 'branch'>): string {
  const key = `${normalizeRepositoryUrl(repository.repoUrl)}#${repository.branch.trim()}`
  return join(SKILL_REPOS_CACHE_DIR, hashString(key))
}

function gitEnvForRepository(repository?: Pick<SkillRepository, 'proxy'>): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const proxyUrl = repository ? buildProxyUrl(repository.proxy) : null
  if (!proxyUrl) {
    return env
  }

  env.HTTP_PROXY = proxyUrl
  env.HTTPS_PROXY = proxyUrl
  env.ALL_PROXY = proxyUrl
  env.http_proxy = proxyUrl
  env.https_proxy = proxyUrl
  env.all_proxy = proxyUrl
  return env
}

function gitArgsForRepository(args: string[], repository?: Pick<SkillRepository, 'proxy'>): string[] {
  const proxyUrl = repository ? buildProxyUrl(repository.proxy) : null
  if (!proxyUrl) {
    return args
  }

  return [
    '-c',
    `http.proxy=${proxyUrl}`,
    '-c',
    `https.proxy=${proxyUrl}`,
    ...args,
  ]
}

function runGit(args: string[], cwd?: string, repository?: Pick<SkillRepository, 'proxy'>): void {
  try {
    execFileSync('git', gitArgsForRepository(args, repository), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnvForRepository(repository),
    })
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf-8')
    const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf-8')
    const message = stderr?.trim() || stdout?.trim() || err.message || 'git command failed'
    throw new Error(`SKILL_GIT_ERROR: ${message}`)
  }
}

function runGitCapture(args: string[], cwd?: string, repository?: Pick<SkillRepository, 'proxy'>): string {
  try {
    return execFileSync('git', gitArgsForRepository(args, repository), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      env: gitEnvForRepository(repository),
    }).trim()
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf-8')
    const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf-8')
    const message = stderr?.trim() || stdout?.trim() || err.message || 'git command failed'
    throw new Error(`SKILL_GIT_ERROR: ${message}`)
  }
}

function isRemoteBranchNotFound(message: string): boolean {
  const value = message.toLowerCase()
  return (
    (value.includes('remote branch') && value.includes('not found')) ||
    value.includes('could not find remote ref') ||
    value.includes('couldn\'t find remote ref')
  )
}

function detectRemoteDefaultBranch(repository: Pick<SkillRepository, 'repoUrl' | 'proxy'>): string | null {
  try {
    const output = runGitCapture(['ls-remote', '--symref', repository.repoUrl, 'HEAD'], undefined, repository)
    const match = output.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

function updateRepositoryBranch(repositoryId: string, branch: string): void {
  getDb().prepare(`
    UPDATE skill_repositories
    SET branch = ?, updated_at = ?
    WHERE id = ?
  `).run(branch, Date.now(), repositoryId)
}

function ensureRepoCache(repository: SkillRepository, refresh = true): string {
  ensureDir(SKILL_REPOS_CACHE_DIR)
  const repoDir = repositoryCacheDir(repository)
  const gitDir = join(repoDir, '.git')
  let activeBranch = repository.branch

  const performSync = (branch: string): void => {
    if (!existsSync(gitDir)) {
      rmSync(repoDir, { recursive: true, force: true })
      ensureDir(dirname(repoDir))
      runGit(['clone', '--depth', '1', '--branch', branch, repository.repoUrl, repoDir], undefined, repository)
      return
    }

    if (refresh) {
      runGit(['remote', 'set-url', 'origin', repository.repoUrl], repoDir, repository)
      runGit(['fetch', '--depth', '1', 'origin', branch], repoDir, repository)
      runGit(['checkout', '-B', branch, 'FETCH_HEAD'], repoDir, repository)
      runGit(['clean', '-fd'], repoDir, repository)
    }
  }

  try {
    performSync(activeBranch)
  } catch (error) {
    const message = String(error)
    if (!isRemoteBranchNotFound(message)) {
      throw error
    }

    const fallbackBranch = detectRemoteDefaultBranch(repository)
    if (!fallbackBranch || fallbackBranch === activeBranch) {
      throw error
    }

    activeBranch = fallbackBranch
    performSync(activeBranch)
    updateRepositoryBranch(repository.id, activeBranch)
  }

  return repoDir
}

function ensureDirectoryWithin(parentDir: string, targetDir: string): string {
  const parent = resolve(parentDir)
  const target = resolve(targetDir)
  if (target !== parent && !target.startsWith(`${parent}${posix.sep}`) && !target.startsWith(`${parent}\\`)) {
    throw new Error('仓库路径无效')
  }
  return target
}

function skillRootForRepository(repository: SkillRepository, repoDir: string): string {
  const basePath = normalizeRepoPath(repository.basePath)
  if (!basePath) return repoDir
  return ensureDirectoryWithin(repoDir, join(repoDir, basePath))
}

function existingRepoCacheDir(repository: SkillRepository): string | null {
  const repoDir = repositoryCacheDir(repository)
  return existsSync(join(repoDir, '.git')) ? repoDir : null
}

function findSkillMarkdownFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !existsSync(current)) continue
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        out.push(fullPath)
      }
    }
  }

  return out
}

function upsertDiscoveredSkills(repository: SkillRepository, items: DiscoveredSkill[]): void {
  const db = getDb()
  const now = Date.now()
  const removeExisting = db.prepare('DELETE FROM skill_discoveries WHERE repo_id = ?')
  const insert = db.prepare(`
    INSERT INTO skill_discoveries (
      key, repo_id, repo_name, repo_url, owner, repo, branch, skill_path,
      directory_name, name, description, allowed_tools, has_references, has_templates,
      created_at, updated_at
    ) VALUES (
      @key, @repo_id, @repo_name, @repo_url, @owner, @repo, @branch, @skill_path,
      @directory_name, @name, @description, @allowed_tools, @has_references, @has_templates,
      @created_at, @updated_at
    )
  `)

  const tx = db.transaction(() => {
    removeExisting.run(repository.id)
    items.forEach((item) => {
      insert.run({
        key: item.key,
        repo_id: item.repoId,
        repo_name: item.repoName,
        repo_url: item.repoUrl,
        owner: item.owner,
        repo: item.repo,
        branch: item.branch,
        skill_path: item.skillPath,
        directory_name: item.directoryName,
        name: item.name,
        description: item.description,
        allowed_tools: item.allowedTools,
        has_references: item.hasReferences ? 1 : 0,
        has_templates: item.hasTemplates ? 1 : 0,
        created_at: now,
        updated_at: now,
      })
    })
  })

  tx()
}

function updateRepositoryDiscoveryState(repositoryId: string, input: { lastDiscoveredAt?: number; lastError?: string | null }): void {
  getDb().prepare(`
    UPDATE skill_repositories
    SET last_discovered_at = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(input.lastDiscoveredAt ?? null, input.lastError ?? null, Date.now(), repositoryId)
}

function scanRepositorySkills(repository: SkillRepository, repoDir: string): DiscoveredSkill[] {
  const root = skillRootForRepository(repository, repoDir)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error('仓库扫描路径不存在')
  }

  const skillFiles = findSkillMarkdownFiles(root)
  return skillFiles.map((skillMdPath) => {
    const skillDir = dirname(skillMdPath)
    const skillPath = relative(repoDir, skillDir).replace(/\\/g, '/')
    const content = readFileSync(skillMdPath, 'utf-8')
    const meta = readSkillMarkdownMeta(content, basename(skillDir))

    return {
      key: makeDiscoveryKey(repository.id, skillPath),
      repoId: repository.id,
      repoName: repository.name,
      repoUrl: repository.repoUrl,
      owner: repository.owner,
      repo: repository.repo,
      branch: repository.branch,
      skillPath,
      directoryName: basename(skillDir),
      name: meta.name || basename(skillDir),
      description: meta.description,
      allowedTools: meta.allowedTools,
      hasReferences: existsSync(join(skillDir, 'references')),
      hasTemplates: existsSync(join(skillDir, 'templates')),
    } satisfies DiscoveredSkill
  }).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

function discoverRepository(repository: SkillRepository): {
  items: DiscoveredSkill[]
  lastDiscoveredAt?: number
  lastError?: string
} {
  try {
    const repoDir = ensureRepoCache(repository, true)
    const items = scanRepositorySkills(repository, repoDir)
    upsertDiscoveredSkills(repository, items)
    return {
      items,
      lastDiscoveredAt: Date.now(),
    }
  } catch (error) {
    return {
      items: [],
      lastError: String(error),
    }
  }
}

function applyDiscoveryWorkerResults(
  repositories: SkillRepository[],
  results: Array<{
    repositoryId: string
    branch?: string
    items: DiscoveredSkill[]
    lastDiscoveredAt?: number
    lastError?: string | null
  }>
): { repositoryCount: number; successCount: number; errorCount: number; skillCount: number } {
  let successCount = 0
  let errorCount = 0
  let skillCount = 0

  results.forEach((result) => {
    const repository = repositories.find((item) => item.id === result.repositoryId)
    if (!repository) return

    const effectiveRepository = result.branch && result.branch !== repository.branch
      ? { ...repository, branch: result.branch }
      : repository

    if (result.branch && result.branch !== repository.branch) {
      updateRepositoryBranch(repository.id, result.branch)
    }

    if (result.lastError) {
      errorCount += 1
      updateRepositoryDiscoveryState(repository.id, {
        lastDiscoveredAt: result.lastDiscoveredAt,
        lastError: result.lastError,
      })
      return
    }

    successCount += 1
    skillCount += result.items.length
    upsertDiscoveredSkills(effectiveRepository, result.items)
    updateRepositoryDiscoveryState(repository.id, {
      lastDiscoveredAt: result.lastDiscoveredAt,
      lastError: null,
    })
  })

  return {
    repositoryCount: repositories.length,
    successCount,
    errorCount,
    skillCount,
  }
}

function queryRepositories(repositoryId?: string): SkillRepository[] {
  ensureStorageReady()
  const db = getDb()
  const rows = repositoryId
    ? db.prepare(`
        SELECT * FROM skill_repositories
        WHERE id = ?
        ORDER BY updated_at DESC, id DESC
      `).all(repositoryId)
    : db.prepare(`
        SELECT * FROM skill_repositories
        ORDER BY updated_at DESC, id DESC
      `).all()

  return (rows as Array<Record<string, unknown>>).map(rowToRepository)
}

function queryDiscoveredSkills(repositoryId?: string): DiscoveredSkill[] {
  ensureStorageReady()
  const db = getDb()
  const rows = repositoryId
    ? db.prepare(`
        SELECT * FROM skill_discoveries
        WHERE repo_id = ?
        ORDER BY name COLLATE NOCASE ASC, skill_path COLLATE NOCASE ASC
      `).all(repositoryId)
    : db.prepare(`
        SELECT * FROM skill_discoveries
        ORDER BY name COLLATE NOCASE ASC, skill_path COLLATE NOCASE ASC
      `).all()
  return (rows as Array<Record<string, unknown>>).map(rowToDiscoveredSkill)
}

function queryInstalledSkills(): SkillInfo[] {
  ensureStorageReady()
  syncInstalledSkillsToDb()
  const rows = getDb().prepare(`
    SELECT * FROM installed_skills
    ORDER BY name COLLATE NOCASE ASC, id COLLATE NOCASE ASC
  `).all() as Array<Record<string, unknown>>
  return rows.map(rowToInstalledSkill)
}

function resolveInstallId(directoryName: string, sourceKey: string): string {
  const baseId = sanitizeInstallId(directoryName)
  const installed = listInstalledSkills()
  const existingBySource = installed.find((item) => item.source?.key === sourceKey)
  const existingLeaf = existingBySource ? posix.basename(existingBySource.id) : ''
  return existingLeaf || baseId
}

function resolveInstallRelativePath(repository: SkillRepository, directoryName: string, sourceKey: string): string {
  const repoFolder = sanitizeInstallId(repository.name || repository.repo)
  const baseId = resolveInstallId(directoryName, sourceKey)
  const preferredId = `${repoFolder}/${baseId}`
  const installed = listInstalledSkills()
  const existingBySource = installed.find((item) => item.source?.key === sourceKey)
  if (existingBySource?.id) {
    return normalizeInstalledSkillId(preferredId)
  }

  if (!existsSync(join(SKILLS_DIR, preferredId))) {
    return normalizeInstalledSkillId(preferredId)
  }

  const fallbackLeaf = `${baseId}-${hashString(sourceKey).slice(0, 6)}`
  const fallbackId = `${repoFolder}/${fallbackLeaf}`
  if (!existsSync(join(SKILLS_DIR, fallbackId))) {
    return normalizeInstalledSkillId(fallbackId)
  }

  let counter = 2
  while (existsSync(join(SKILLS_DIR, `${fallbackId}-${counter}`))) {
    counter += 1
  }
  return normalizeInstalledSkillId(`${fallbackId}-${counter}`)
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
  ensureDir(targetDir)
  const entries = readdirSync(sourceDir, { withFileTypes: true })
  entries.forEach((entry) => {
    if (entry.name === '.git') return
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath)
      return
    }
    if (entry.isFile()) {
      ensureDir(dirname(targetPath))
      copyFileSync(sourcePath, targetPath)
    }
  })
}

export function listInstalledSkills(): SkillInfo[] {
  try {
    return queryInstalledSkills()
  } catch (error) {
    console.error('[Skills] Failed to list installed skills:', error)
    return []
  }
}

export function readInstalledSkill(id: string): string {
  try {
    const normalizedId = normalizeInstalledSkillId(id.trim())
    const filePath = join(SKILLS_DIR, normalizedId, 'SKILL.md')
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    console.error('[Skills] Failed to read skill:', error)
    return ''
  }
}

export function deleteInstalledSkill(id: string): { ok: boolean; error?: string } {
  try {
    ensureStorageReady()
    const normalizedId = normalizeInstalledSkillId(id.trim())

    const skillDir = join(SKILLS_DIR, normalizedId)
    if (!existsSync(skillDir)) {
      return { ok: false, error: 'Skill not found' }
    }

    rmSync(skillDir, { recursive: true, force: true })
    const parentDir = dirname(skillDir)
    if (parentDir !== SKILLS_DIR && existsSync(parentDir)) {
      try {
        if (readdirSync(parentDir).length === 0) {
          rmSync(parentDir, { recursive: true, force: true })
        }
      } catch {
        // Ignore parent cleanup errors; the skill itself is already removed.
      }
    }
    getDb().prepare('DELETE FROM installed_skills WHERE id = ?').run(normalizedId)
    return { ok: true }
  } catch (error) {
    console.error('[Skills] Failed to delete skill:', error)
    return { ok: false, error: String(error) }
  }
}

export function listSkillRepositories(): SkillRepository[] {
  return queryRepositories()
}

export function listDiscoveredSkills(repositoryId?: string): DiscoveredSkill[] {
  const cached = queryDiscoveredSkills(repositoryId)
  if (cached.length > 0) {
    return cached
  }

  const repositories = queryRepositories(repositoryId).filter((item) => item.enabled && (!repositoryId || item.id === repositoryId))
  let hydrated = false

  repositories.forEach((repository) => {
    const repoDir = existingRepoCacheDir(repository)
    if (!repoDir) return

    try {
      const items = scanRepositorySkills(repository, repoDir)
      upsertDiscoveredSkills(repository, items)
      if (items.length > 0) {
        hydrated = true
      }
    } catch (error) {
      console.error('[Skills] Failed to hydrate cached discoveries:', error)
    }
  })

  return hydrated ? queryDiscoveredSkills(repositoryId) : cached
}

export function saveSkillRepository(input: SkillRepositoryDraft): { ok: boolean; repo?: SkillRepository; error?: string } {
  try {
    ensureStorageReady()
    const db = getDb()
    const currentRepository = input.id
      ? queryRepositories(input.id)[0]
      : undefined

    const parsed = parseGitHubRepository(
      input.repoUrl || currentRepository?.repoUrl || '',
      input.branch || currentRepository?.branch,
      input.basePath ?? currentRepository?.basePath
    )

    const repositoryIdentityChanged = !!currentRepository && (
      currentRepository.repoUrl !== parsed.repoUrl ||
      currentRepository.branch !== parsed.branch ||
      currentRepository.basePath !== parsed.basePath
    )

    const repository: SkillRepository = {
      id: currentRepository?.id || makeRepositoryId(parsed.owner, parsed.repo, parsed.branch, parsed.basePath),
      name: (input.name || currentRepository?.name || parsed.repo).trim() || parsed.repo,
      provider: 'github',
      repoUrl: parsed.repoUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.branch,
      basePath: parsed.basePath,
      proxy: validateRepositoryProxy(normalizeRepositoryProxy(input.proxy, currentRepository?.proxy)),
      enabled: input.enabled ?? currentRepository?.enabled ?? true,
      lastDiscoveredAt: repositoryIdentityChanged ? undefined : currentRepository?.lastDiscoveredAt,
      lastError: repositoryIdentityChanged ? undefined : currentRepository?.lastError,
    }

    const now = Date.now()
    const existing = db.prepare(`
      SELECT id, created_at FROM skill_repositories
      WHERE id = ? OR (repo_url = ? AND branch = ? AND base_path = ?)
      LIMIT 1
    `).get(repository.id, repository.repoUrl, repository.branch, repository.basePath) as { id: string; created_at: number } | undefined

    db.prepare(`
      INSERT INTO skill_repositories (
        id, name, provider, repo_url, owner, repo, branch, base_path,
        proxy_enabled, proxy_protocol, proxy_host, proxy_port,
        enabled, last_discovered_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        provider = excluded.provider,
        repo_url = excluded.repo_url,
        owner = excluded.owner,
        repo = excluded.repo,
        branch = excluded.branch,
        base_path = excluded.base_path,
        proxy_enabled = excluded.proxy_enabled,
        proxy_protocol = excluded.proxy_protocol,
        proxy_host = excluded.proxy_host,
        proxy_port = excluded.proxy_port,
        enabled = excluded.enabled,
        last_discovered_at = excluded.last_discovered_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      existing?.id || repository.id,
      repository.name,
      repository.provider,
      repository.repoUrl,
      repository.owner,
      repository.repo,
      repository.branch,
      repository.basePath,
      repository.proxy.enabled ? 1 : 0,
      repository.proxy.protocol,
      repository.proxy.host,
      repository.proxy.port,
      repository.enabled ? 1 : 0,
      repository.lastDiscoveredAt ?? null,
      repository.lastError ?? null,
      existing?.created_at ?? now,
      now
    )

    if (repositoryIdentityChanged) {
      db.prepare('DELETE FROM skill_discoveries WHERE repo_id = ?').run(existing?.id || repository.id)
    }

    const saved = queryRepositories(existing?.id || repository.id)[0]
    return { ok: true, repo: saved }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export function removeSkillRepository(id: string): { ok: boolean; error?: string } {
  try {
    ensureStorageReady()
    const trimmed = id.trim()
    if (!trimmed) {
      return { ok: false, error: 'Invalid repository id' }
    }

    getDb().prepare('DELETE FROM skill_discoveries WHERE repo_id = ?').run(trimmed)
    getDb().prepare('DELETE FROM skill_repositories WHERE id = ?').run(trimmed)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export async function discoverSkills(repositoryId?: string): Promise<DiscoveredSkill[]> {
  ensureStorageReady()
  const repositories = queryRepositories(repositoryId).filter((item) => item.enabled && (!repositoryId || item.id === repositoryId))
  for (const repository of repositories) {
    const result = discoverRepository(repository)
    updateRepositoryDiscoveryState(repository.id, {
      lastDiscoveredAt: result.lastDiscoveredAt,
      lastError: result.lastError ?? null,
    })
  }

  return queryDiscoveredSkills(repositoryId)
}

export function startDiscoverSkills(
  repositoryId: string | undefined,
  onEvent?: (event: SkillDiscoveryEvent) => void
): SkillDiscoveryLaunchResult {
  ensureStorageReady()

  if (activeDiscoveryTask) {
    return {
      ok: false,
      started: false,
      taskId: activeDiscoveryTask.id,
      error: '已有刷新任务正在后台执行',
    }
  }

  const repositories = queryRepositories(repositoryId).filter((item) => item.enabled && (!repositoryId || item.id === repositoryId))
  if (repositories.length === 0) {
    return {
      ok: false,
      started: false,
      error: repositoryId ? '当前仓库未启用或不存在' : '没有可刷新的已启用仓库',
    }
  }

  const taskId = `skills-discovery-${Date.now()}`
  const worker = new Worker(DISCOVERY_WORKER_SOURCE, {
    eval: true,
    workerData: {
      cacheDir: SKILL_REPOS_CACHE_DIR,
      repositories: repositories.map((repository) => ({
        id: repository.id,
        name: repository.name,
        repoUrl: repository.repoUrl,
        owner: repository.owner,
        repo: repository.repo,
        branch: repository.branch,
        basePath: repository.basePath,
        proxy: repository.proxy,
      })),
    },
  })

  activeDiscoveryTask = { id: taskId, worker, repositoryId }
  onEvent?.({
    type: 'started',
    taskId,
    repositoryId,
  })

  const clearActiveTask = (): void => {
    if (activeDiscoveryTask?.id === taskId) {
      activeDiscoveryTask = null
    }
  }

  worker.on('message', (message: {
    type: 'done' | 'error'
    results?: Array<{
      repositoryId: string
      branch?: string
      items: DiscoveredSkill[]
      lastDiscoveredAt?: number
      lastError?: string | null
    }>
    error?: string
  }) => {
    if (message.type === 'done' && message.results) {
      const summary = applyDiscoveryWorkerResults(repositories, message.results)
      clearActiveTask()
      onEvent?.({
        type: 'finished',
        taskId,
        repositoryId,
        ...summary,
      })
      void worker.terminate()
      return
    }

    clearActiveTask()
    onEvent?.({
      type: 'failed',
      taskId,
      repositoryId,
      error: message.error || '后台刷新失败',
    })
    void worker.terminate()
  })

  worker.on('error', (error) => {
    clearActiveTask()
    onEvent?.({
      type: 'failed',
      taskId,
      repositoryId,
      error: String(error),
    })
  })

  worker.on('exit', (code) => {
    if (code === 0) return
    if (activeDiscoveryTask?.id !== taskId) return
    clearActiveTask()
    onEvent?.({
      type: 'failed',
      taskId,
      repositoryId,
      error: `后台刷新进程异常退出 (${code})`,
    })
  })

  return {
    ok: true,
    started: true,
    taskId,
  }
}

export async function previewDiscoveredSkill(repositoryId: string, skillPath: string): Promise<string> {
  ensureStorageReady()
  const repository = queryRepositories(repositoryId)[0]
  if (!repository) {
    throw new Error('Repository not found')
  }

  const repoDir = ensureRepoCache(repository, false)
  const normalizedSkillPath = normalizeRepoPath(skillPath)
  const filePath = join(repoDir, normalizedSkillPath, 'SKILL.md')
  if (!existsSync(filePath)) {
    throw new Error('Skill not found in repository')
  }

  return readFileSync(filePath, 'utf-8')
}

export async function installDiscoveredSkill(repositoryId: string, skillPath: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    ensureStorageReady()
    const repository = queryRepositories(repositoryId)[0]
    if (!repository) {
      return { ok: false, error: 'Repository not found' }
    }

    const normalizedSkillPath = normalizeRepoPath(skillPath)
    const sourceKey = makeDiscoveryKey(repository.id, normalizedSkillPath)
    const repoDir = ensureRepoCache(repository, false)
    const sourceDir = join(repoDir, normalizedSkillPath)
    const skillMdPath = join(sourceDir, 'SKILL.md')

    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory() || !existsSync(skillMdPath)) {
      return { ok: false, error: 'Skill 文件不完整' }
    }

    const existingBySource = listInstalledSkills().find((item) => item.source?.key === sourceKey)
    const installId = resolveInstallRelativePath(repository, posix.basename(normalizedSkillPath), sourceKey)
    const targetDir = join(SKILLS_DIR, installId)
    const previousDir = existingBySource ? join(SKILLS_DIR, normalizeInstalledSkillId(existingBySource.id)) : null

    if (previousDir && previousDir !== targetDir && existsSync(previousDir)) {
      rmSync(previousDir, { recursive: true, force: true })
      const previousParentDir = dirname(previousDir)
      if (previousParentDir !== SKILLS_DIR && existsSync(previousParentDir) && readdirSync(previousParentDir).length === 0) {
        rmSync(previousParentDir, { recursive: true, force: true })
      }
    }

    rmSync(targetDir, { recursive: true, force: true })
    copyDirectoryRecursive(sourceDir, targetDir)

    const source: SkillSourceInfo = {
      key: sourceKey,
      repoId: repository.id,
      repoName: repository.name,
      repoUrl: repository.repoUrl,
      branch: repository.branch,
      path: normalizedSkillPath,
    }
    writeFileSync(join(targetDir, INSTALL_SOURCE_FILE), JSON.stringify(source, null, 2), 'utf-8')
    syncInstalledSkillsToDb()

    return { ok: true, id: installId }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
