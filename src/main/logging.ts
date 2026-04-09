import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_LOG_PATH, EXPORTS_DIR, LOGS_DIR, RENDERER_LOG_PATH, USAGE_LOG_PATH } from './runtime-paths'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogThreshold = 'error' | 'info' | 'debug'
export type LogFileKind = 'app' | 'renderer'

export interface RuntimeLogEntry {
  cursor: string
  timestamp: number
  isoTime: string
  level: LogLevel
  source: string
  message: string
  metaText: string
  file: LogFileKind
  raw: string
}

export interface GetLogsOptions {
  after?: string
  level?: LogThreshold
  query?: string
  file?: 'all' | LogFileKind
  limit?: number
}

export interface GetLogsResult {
  items: RuntimeLogEntry[]
  cursor: string | null
  logDir: string
}

export interface UsageLogEntry {
  category: string
  action: string
  status: string
  details?: Record<string, unknown>
  sessionId?: string
  createdAt?: number
}

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|token|authorization|secret|password)/i
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}
const LOG_THRESHOLD_ORDER: Record<LogThreshold, number> = {
  error: LOG_LEVEL_ORDER.error,
  info: LOG_LEVEL_ORDER.info,
  debug: LOG_LEVEL_ORDER.debug,
}

let currentLogThreshold: LogThreshold = 'info'

const APP_LOG_PATTERN = /^\[(?<isoTime>[^\]]+)\] \[(?<level>[A-Z]+)\] \[(?<source>[^\]]+)\] (?<body>.*)$/
const RENDERER_LOG_PATTERN = /^\[(?<isoTime>[^\]]+)\] \[(?<level>[A-Z]+)\] (?<body>.*)$/

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureParent(path: string): void {
  ensureDir(dirname(path))
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, redactSecret(child)]
        }
        return [key, sanitizeValue(child)]
      })
    )
  }

  if (typeof value === 'string' && value.length > 2000) {
    return `${value.slice(0, 2000)}...`
  }

  return value
}

function redactSecret(value: unknown): string {
  if (typeof value !== 'string') return '[REDACTED]'
  if (value.length <= 8) return '[REDACTED]'
  return `${value.slice(0, 3)}***${value.slice(-2)}`
}

function serializeMeta(meta?: unknown): string {
  if (meta == null) return ''
  try {
    return JSON.stringify(sanitizeValue(meta))
  } catch {
    return String(meta)
  }
}

function appendLine(path: string, line: string): void {
  ensureParent(path)
  appendFileSync(path, `${line}\n`, 'utf-8')
}

export function normalizeLogThreshold(value: unknown): LogThreshold {
  if (value === 'error' || value === 'info' || value === 'debug') {
    return value
  }
  return 'info'
}

export function setLogThreshold(level: unknown): LogThreshold {
  currentLogThreshold = normalizeLogThreshold(level)
  return currentLogThreshold
}

export function getLogThreshold(): LogThreshold {
  return currentLogThreshold
}

export function ensureLoggingDirs(): void {
  ensureDir(LOGS_DIR)
  ensureDir(EXPORTS_DIR)
}

export function writeAppLog(level: LogLevel, source: string, message: string, meta?: unknown): void {
  const metaText = serializeMeta(meta)
  appendLine(APP_LOG_PATH, `[${new Date().toISOString()}] [${level.toUpperCase()}] [${source}] ${message}${metaText ? ` ${metaText}` : ''}`)
}

export function writeRendererLog(level: LogLevel, message: string, meta?: unknown): void {
  const metaText = serializeMeta(meta)
  appendLine(RENDERER_LOG_PATH, `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${metaText ? ` ${metaText}` : ''}`)
}

export function writeUsageLog(entry: UsageLogEntry): void {
  const normalized = {
    category: entry.category,
    action: entry.action,
    status: entry.status,
    details: sanitizeValue(entry.details || {}),
    sessionId: entry.sessionId || null,
    createdAt: entry.createdAt || Date.now(),
  }
  appendLine(USAGE_LOG_PATH, JSON.stringify(normalized))
}

export function readTextFile(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

export function writeExportFile(name: string, content: string): string {
  ensureLoggingDirs()
  const path = join(EXPORTS_DIR, name)
  writeFileSync(path, content, 'utf-8')
  return path
}

export function sanitizeForLogging<T>(value: T): T {
  return sanitizeValue(value) as T
}

export function matchesLogThreshold(level: LogLevel, threshold: LogThreshold): boolean {
  return LOG_LEVEL_ORDER[level] <= LOG_THRESHOLD_ORDER[threshold]
}

function normalizeLogLevel(value: string): LogLevel {
  const lowered = value.toLowerCase()
  if (lowered === 'debug' || lowered === 'info' || lowered === 'warn' || lowered === 'error') {
    return lowered
  }
  return 'info'
}

function splitBodyAndMeta(body: string): { message: string; metaText: string } {
  const trimmed = body.trimEnd()

  for (let index = trimmed.length - 1; index > 0; index -= 1) {
    if (trimmed[index] !== '{' || trimmed[index - 1] !== ' ') continue

    const candidate = trimmed.slice(index).trim()
    try {
      JSON.parse(candidate)
      return {
        message: trimmed.slice(0, index).trimEnd(),
        metaText: candidate,
      }
    } catch {
      continue
    }
  }

  return {
    message: trimmed,
    metaText: '',
  }
}

function parseLogFile(path: string, file: LogFileKind): Array<Omit<RuntimeLogEntry, 'cursor'>> {
  const content = readTextFile(path)
  if (!content.trim()) return []

  const pattern = file === 'app' ? APP_LOG_PATTERN : RENDERER_LOG_PATTERN

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(pattern)
      if (!match?.groups) return null

      const isoTime = match.groups.isoTime
      const timestamp = Date.parse(isoTime)
      if (Number.isNaN(timestamp)) return null

      const body = match.groups.body || ''
      const { message, metaText } = splitBodyAndMeta(body)

      return {
        timestamp,
        isoTime,
        level: normalizeLogLevel(match.groups.level || 'info'),
        source: file === 'app' ? (match.groups.source || 'app') : 'renderer',
        message,
        metaText,
        file,
        raw: line,
      }
    })
    .filter((entry): entry is Omit<RuntimeLogEntry, 'cursor'> => Boolean(entry))
}

function parseCursor(cursor?: string): { timestamp: number; sequence: number } | null {
  if (!cursor) return null
  const [timestampText, sequenceText] = cursor.split(':')
  const timestamp = Number.parseInt(timestampText, 10)
  const sequence = Number.parseInt(sequenceText, 10)
  if (!Number.isFinite(timestamp) || !Number.isFinite(sequence)) {
    return null
  }
  return { timestamp, sequence }
}

function isAfterCursor(cursor: string, baseline: string | undefined): boolean {
  const entryCursor = parseCursor(cursor)
  const baselineCursor = parseCursor(baseline)
  if (!entryCursor || !baselineCursor) return true

  if (entryCursor.timestamp !== baselineCursor.timestamp) {
    return entryCursor.timestamp > baselineCursor.timestamp
  }

  return entryCursor.sequence > baselineCursor.sequence
}

function matchesQuery(entry: RuntimeLogEntry, query: string): boolean {
  if (!query) return true

  const haystack = [
    entry.isoTime,
    entry.level,
    entry.source,
    entry.message,
    entry.metaText,
    entry.raw,
  ]
    .join('\n')
    .toLowerCase()

  return haystack.includes(query)
}

export function readStructuredLogs(options: GetLogsOptions = {}): GetLogsResult {
  const threshold = normalizeLogThreshold(options.level)
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const file = options.file === 'app' || options.file === 'renderer' ? options.file : 'all'
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000)

  const entries = [
    ...parseLogFile(APP_LOG_PATH, 'app'),
    ...parseLogFile(RENDERER_LOG_PATH, 'renderer'),
  ]
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp
      }
      if (left.file !== right.file) {
        return left.file.localeCompare(right.file)
      }
      return left.raw.localeCompare(right.raw)
    })
    .map((entry, index) => ({
      ...entry,
      cursor: `${entry.timestamp}:${index + 1}`,
    }))

  const matchingEntries = entries.filter((entry) => {
    if (file !== 'all' && entry.file !== file) return false
    if (!matchesLogThreshold(entry.level, threshold)) return false
    return matchesQuery(entry, query)
  })

  const latestCursor = matchingEntries.length > 0
    ? matchingEntries[matchingEntries.length - 1].cursor
    : options.after || null

  const filtered = matchingEntries
    .filter((entry) => !options.after || isAfterCursor(entry.cursor, options.after))
    .slice(-limit)
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp
      }
      return right.cursor.localeCompare(left.cursor)
    })

  return {
    items: filtered,
    cursor: latestCursor,
    logDir: LOGS_DIR,
  }
}
