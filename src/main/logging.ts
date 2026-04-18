import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inspect } from 'node:util'
import { EXPORTS_DIR, LATEST_LOG_PATH, LOG_DIR } from './runtime-paths'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export type LogThreshold = LogLevel
export type LogFileKind = 'harnessclaw'

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
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
}
const CONSOLE_LEVELS: Record<'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error', LogLevel> = {
  trace: 'trace',
  debug: 'debug',
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
}
const HARNESSCLAW_LOG_PATTERN = /^\[(?<isoTime>[^\]]+)\] \[(?<level>[A-Z]+)\] \[(?<source>[^\]]+)\] (?<body>.*)$/

let currentLogThreshold: LogThreshold = 'info'
let consolePatched = false
let activeDayKey = ''

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureParent(path: string): void {
  ensureDir(dirname(path))
}

function redactSecret(value: unknown): string {
  if (typeof value !== 'string') return '[REDACTED]'
  if (value.length <= 8) return '[REDACTED]'
  return `${value.slice(0, 3)}***${value.slice(-2)}`
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
      }),
    )
  }

  if (typeof value === 'string' && value.length > 4000) {
    return `${value.slice(0, 4000)}...`
  }

  return value
}

function serializeMeta(meta?: unknown): string {
  if (meta == null) return ''
  try {
    return JSON.stringify(sanitizeValue(meta))
  } catch {
    return String(meta)
  }
}

function dayKeyFor(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDailyLogPath(date: Date = new Date()): string {
  return join(LOG_DIR, `harnessclaw-${dayKeyFor(date.getTime())}.log`)
}

function syncLatestLog(targetDayKey: string): void {
  const dailyPath = join(LOG_DIR, `harnessclaw-${targetDayKey}.log`)
  const content = existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') : ''
  ensureParent(LATEST_LOG_PATH)
  writeFileSync(LATEST_LOG_PATH, content, 'utf-8')
}

function ensureActiveTargets(timestamp = Date.now()): { dailyPath: string; latestPath: string } {
  ensureDir(LOG_DIR)
  ensureDir(EXPORTS_DIR)
  const dayKey = dayKeyFor(timestamp)
  if (activeDayKey !== dayKey) {
    activeDayKey = dayKey
    syncLatestLog(dayKey)
  }
  return {
    dailyPath: getDailyLogPath(new Date(timestamp)),
    latestPath: LATEST_LOG_PATH,
  }
}

function appendLine(line: string, timestamp = Date.now()): void {
  const { dailyPath, latestPath } = ensureActiveTargets(timestamp)
  ensureParent(dailyPath)
  appendFileSync(dailyPath, `${line}\n`, 'utf-8')
  appendFileSync(latestPath, `${line}\n`, 'utf-8')
}

function normalizeConsoleModule(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'main.console'
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === 'string') return value
  return inspect(sanitizeValue(value), { depth: 4, breakLength: 120, compact: true })
}

function parseConsolePayload(args: unknown[]): { source: string; message: string; meta?: unknown } {
  if (args.length === 0) {
    return { source: 'main.console', message: '(empty)' }
  }

  let source = 'main.console'
  const [first, ...rest] = args

  if (typeof first === 'string') {
    const match = first.match(/^\[([^\]]+)\]\s*(.*)$/)
    let message = match ? match[2] || '' : first
    if (match) {
      source = normalizeConsoleModule(match[1])
    }

    if (rest.length === 1 && rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0])) {
      return { source, message: message || 'console payload', meta: rest[0] }
    }

    const tail = rest.map((item) => formatConsoleValue(item)).filter(Boolean)
    if (tail.length > 0) {
      message = [message, ...tail].filter(Boolean).join(' ')
    }
    return { source, message: message || '(empty)' }
  }

  if (args.length === 1 && first && typeof first === 'object' && !Array.isArray(first)) {
    return {
      source,
      message: 'structured console payload',
      meta: first,
    }
  }

  return {
    source,
    message: args.map((item) => formatConsoleValue(item)).filter(Boolean).join(' ') || '(empty)',
  }
}

export function normalizeLogThreshold(value: unknown): LogThreshold {
  if (
    value === 'trace'
    || value === 'debug'
    || value === 'info'
    || value === 'warn'
    || value === 'error'
    || value === 'fatal'
  ) {
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
  ensureActiveTargets()
}

export function initializeConsoleLogging(): void {
  if (consolePatched) return
  consolePatched = true

  const original = {
    trace: console.trace.bind(console),
    debug: console.debug.bind(console),
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  ;(['trace', 'debug', 'log', 'info', 'warn', 'error'] as const).forEach((method) => {
    console[method] = (...args: unknown[]) => {
      original[method](...args)
      const payload = parseConsolePayload(args)
      writeLog(CONSOLE_LEVELS[method], payload.source, payload.message, payload.meta)
    }
  })
}

export function initializeLogging(): void {
  ensureLoggingDirs()
  initializeConsoleLogging()
}

export function writeLog(level: LogLevel, source: string, message: string, meta?: unknown): void {
  const safeSource = source.trim() || 'app'
  const metaText = serializeMeta(meta)
  appendLine(`[${new Date().toISOString()}] [${level.toUpperCase()}] [${safeSource}] ${message}${metaText ? ` ${metaText}` : ''}`)
}

export function writeAppLog(level: LogLevel, source: string, message: string, meta?: unknown): void {
  writeLog(level, source, message, meta)
}

export function writeRendererLog(level: LogLevel, message: string, meta?: unknown, source = 'renderer'): void {
  writeLog(level, source, message, meta)
}

export function writeUsageLog(entry: UsageLogEntry): void {
  const createdAt = entry.createdAt || Date.now()
  writeLog('debug', 'usage', `${entry.category}.${entry.action}`, {
    status: entry.status,
    sessionId: entry.sessionId || null,
    details: sanitizeValue(entry.details || {}),
    createdAt,
  })
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
  return LOG_LEVEL_ORDER[level] <= LOG_LEVEL_ORDER[threshold]
}

function normalizeLogLevel(value: string): LogLevel {
  const lowered = value.toLowerCase()
  if (
    lowered === 'trace'
    || lowered === 'debug'
    || lowered === 'info'
    || lowered === 'warn'
    || lowered === 'error'
    || lowered === 'fatal'
  ) {
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

function parseLogFile(path: string): Array<Omit<RuntimeLogEntry, 'cursor'>> {
  const content = readTextFile(path)
  if (!content.trim()) return []

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(HARNESSCLAW_LOG_PATTERN)
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
        source: match.groups.source || 'app',
        message,
        metaText,
        file: 'harnessclaw' as const,
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
  const file = options.file === 'harnessclaw' ? options.file : 'all'
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000)

  const entries = parseLogFile(LATEST_LOG_PATH)
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp
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
    logDir: LOG_DIR,
  }
}
