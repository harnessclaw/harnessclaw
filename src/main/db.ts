import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { DB_DIR, DB_PATH } from './runtime-paths'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true })
  }
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initTables(db)
  return db
}

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL,
      role             TEXT NOT NULL,
      content          TEXT NOT NULL DEFAULT '',
      content_segments TEXT,
      thinking         TEXT,
      tools_used       TEXT,
      usage_prompt     INTEGER,
      usage_completion INTEGER,
      usage_total      INTEGER,
      created_at       INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS tool_activities (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      type       TEXT NOT NULL,
      name       TEXT,
      content    TEXT NOT NULL DEFAULT '',
      call_id    TEXT,
      is_error   INTEGER DEFAULT 0,
      subagent_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tools_message ON tool_activities(message_id);

    CREATE TABLE IF NOT EXISTS usage_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      category     TEXT NOT NULL,
      action       TEXT NOT NULL,
      status       TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      session_id   TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);
  `)

  const messageColumns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
  const hasContentSegments = messageColumns.some((col) => col.name === 'content_segments')
  if (!hasContentSegments) {
    db.exec(`ALTER TABLE messages ADD COLUMN content_segments TEXT`)
  }

  const toolColumns = db.prepare(`PRAGMA table_info(tool_activities)`).all() as Array<{ name: string }>
  const hasSubagentJson = toolColumns.some((col) => col.name === 'subagent_json')
  if (!hasSubagentJson) {
    db.exec(`ALTER TABLE tool_activities ADD COLUMN subagent_json TEXT`)
  }
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function upsertSession(sessionId: string, title?: string): void {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO sessions (session_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(sessionId, title || '', now, now)
}

export function updateSessionTitle(sessionId: string, title: string): void {
  getDb().prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?`)
    .run(title, Date.now(), sessionId)
}

export interface SessionRow {
  session_id: string
  title: string
  created_at: number
  updated_at: number
}

export function listSessions(): SessionRow[] {
  return getDb().prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as SessionRow[]
}

export function deleteSession(sessionId: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId)
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  content_segments: string | null
  thinking: string | null
  tools_used: string | null
  usage_prompt: number | null
  usage_completion: number | null
  usage_total: number | null
  created_at: number
}

export interface ToolActivityRow {
  id: number
  message_id: string
  type: string
  name: string | null
  content: string
  call_id: string | null
  is_error: number
  subagent_json: string | null
  created_at: number
}

export interface UsageEventRow {
  id: number
  category: string
  action: string
  status: string
  details_json: string
  session_id: string | null
  created_at: number
}

export function insertMessage(msg: {
  id: string
  sessionId: string
  role: string
  content: string
  contentSegments?: Array<{ text: string; ts: number; subagent?: { taskId: string; label: string; status: string } }>
  thinking?: string
  createdAt: number
}): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO messages (id, session_id, role, content, content_segments, thinking, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    msg.sessionId,
    msg.role,
    msg.content,
    msg.contentSegments ? JSON.stringify(msg.contentSegments) : null,
    msg.thinking || null,
    msg.createdAt
  )
  // Touch session updated_at
  getDb().prepare(`UPDATE sessions SET updated_at = ? WHERE session_id = ?`)
    .run(msg.createdAt, msg.sessionId)
}

export function updateMessageContent(
  id: string,
  content: string,
  contentSegments?: Array<{ text: string; ts: number; subagent?: { taskId: string; label: string; status: string } }>,
  toolsUsed?: string[],
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
): void {
  if (usage) {
    // response_end: update metadata only, don't overwrite streamed content
    if (content) {
      getDb().prepare(`
        UPDATE messages SET content = ?, content_segments = ?, tools_used = ?, usage_prompt = ?, usage_completion = ?, usage_total = ?
        WHERE id = ?
      `).run(
        content,
        contentSegments ? JSON.stringify(contentSegments) : null,
        toolsUsed ? JSON.stringify(toolsUsed) : null,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens,
        id
      )
    } else {
      getDb().prepare(`
        UPDATE messages SET content_segments = COALESCE(?, content_segments), tools_used = ?, usage_prompt = ?, usage_completion = ?, usage_total = ?
        WHERE id = ?
      `).run(
        contentSegments ? JSON.stringify(contentSegments) : null,
        toolsUsed ? JSON.stringify(toolsUsed) : null,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens,
        id
      )
    }
  } else if (content) {
    getDb().prepare(`UPDATE messages SET content = content || ?, content_segments = COALESCE(?, content_segments) WHERE id = ?`)
      .run(content, contentSegments ? JSON.stringify(contentSegments) : null, id)
  } else if (contentSegments) {
    getDb().prepare(`UPDATE messages SET content_segments = ? WHERE id = ?`)
      .run(JSON.stringify(contentSegments), id)
  }
}

export interface FullMessage {
  id: string
  session_id: string
  role: string
  content: string
  content_segments: string | null
  thinking: string | null
  tools_used: string | null
  usage_prompt: number | null
  usage_completion: number | null
  usage_total: number | null
  created_at: number
  tools: ToolActivityRow[]
}

export function getMessages(sessionId: string): FullMessage[] {
  const msgs = getDb().prepare(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId) as MessageRow[]

  if (msgs.length === 0) return []

  const msgIds = msgs.map((m) => m.id)
  const placeholders = msgIds.map(() => '?').join(',')
  const tools = getDb().prepare(
    `SELECT * FROM tool_activities WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
  ).all(...msgIds) as ToolActivityRow[]

  const toolsByMsg = new Map<string, ToolActivityRow[]>()
  for (const t of tools) {
    const arr = toolsByMsg.get(t.message_id) || []
    arr.push(t)
    toolsByMsg.set(t.message_id, arr)
  }

  return msgs.map((m) => ({
    ...m,
    tools: toolsByMsg.get(m.id) || [],
  }))
}

// ─── Tool Activities ─────────────────────────────────────────────────────────

export function insertToolActivity(messageId: string, activity: {
  type: string
  name?: string
  content: string
  callId?: string
  isError?: boolean
  subagent?: { taskId: string; label: string; status: string }
}): void {
  getDb().prepare(`
    INSERT INTO tool_activities (message_id, type, name, content, call_id, is_error, subagent_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId,
    activity.type,
    activity.name || null,
    activity.content,
    activity.callId || null,
    activity.isError ? 1 : 0,
    activity.subagent ? JSON.stringify(activity.subagent) : null,
    Date.now()
  )
}

export function insertUsageEvent(entry: {
  category: string
  action: string
  status: string
  detailsJson?: string
  sessionId?: string
  createdAt?: number
}): void {
  getDb().prepare(`
    INSERT INTO usage_events (category, action, status, details_json, session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entry.category,
    entry.action,
    entry.status,
    entry.detailsJson || '{}',
    entry.sessionId || null,
    entry.createdAt || Date.now()
  )
}

export function listUsageEvents(limit = 500): UsageEventRow[] {
  return getDb().prepare(`
    SELECT * FROM usage_events
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as UsageEventRow[]
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
