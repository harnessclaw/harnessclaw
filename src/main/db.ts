import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { DB_DIR, DB_PATH } from './runtime-paths'

let db: Database.Database | null = null

export type ConfigScope = 'app' | 'engine'
export type ConfigStorageFormat = 'json' | 'yaml'

const DEFAULT_PROJECTS = [
  {
    projectId: 'release-009',
    name: 'v0.0.9 发布收口',
    description: '聚合发布说明、回归验证与异常修复，保证版本切换时上下文和产出都留在同一个项目里。',
  },
  {
    projectId: 'sidebar-refine',
    name: '侧边栏交互优化',
    description: '集中处理对话多选、边界点击区和溢出问题，避免在多个页面来回切换。',
  },
  {
    projectId: 'skills-onboarding',
    name: '技能引导整理',
    description: '整理首屏说明、仓库入口与默认流程，让新用户进入后能更快理解下一步操作。',
  },
] as const

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
    CREATE TABLE IF NOT EXISTS config_documents (
      scope          TEXT PRIMARY KEY CHECK (scope IN ('app', 'engine')),
      storage_format TEXT NOT NULL CHECK (storage_format IN ('json', 'yaml')),
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
      payload_text   TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      project_id   TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      deleted_at   INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_projects_deleted_updated
      ON projects(deleted_at, updated_at DESC);

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
      system_notice_json TEXT,
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
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id   TEXT NOT NULL,
      type         TEXT NOT NULL,
      name         TEXT,
      content      TEXT NOT NULL DEFAULT '',
      call_id      TEXT,
      is_error     INTEGER DEFAULT 0,
      duration_ms  INTEGER,
      render_hint  TEXT,
      language     TEXT,
      file_path    TEXT,
      metadata_json TEXT,
      subagent_json TEXT,
      created_at   INTEGER NOT NULL,
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

    CREATE TABLE IF NOT EXISTS skill_repositories (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      provider           TEXT NOT NULL DEFAULT 'github',
      repo_url           TEXT NOT NULL,
      owner              TEXT NOT NULL,
      repo               TEXT NOT NULL,
      branch             TEXT NOT NULL,
      base_path          TEXT NOT NULL DEFAULT '',
      proxy_enabled      INTEGER NOT NULL DEFAULT 0,
      proxy_protocol     TEXT NOT NULL DEFAULT 'http',
      proxy_host         TEXT NOT NULL DEFAULT '',
      proxy_port         TEXT NOT NULL DEFAULT '',
      proxy_username     TEXT NOT NULL DEFAULT '',
      proxy_password     TEXT NOT NULL DEFAULT '',
      enabled            INTEGER NOT NULL DEFAULT 1,
      last_discovered_at INTEGER,
      last_error         TEXT,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_skill_repositories_enabled
      ON skill_repositories(enabled, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_repositories_repo_branch_path
      ON skill_repositories(repo_url, branch, base_path);

    CREATE TABLE IF NOT EXISTS skill_discoveries (
      key            TEXT PRIMARY KEY,
      repo_id        TEXT NOT NULL,
      repo_name      TEXT NOT NULL,
      repo_url       TEXT NOT NULL,
      owner          TEXT NOT NULL,
      repo           TEXT NOT NULL,
      branch         TEXT NOT NULL,
      skill_path     TEXT NOT NULL,
      directory_name TEXT NOT NULL,
      name           TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      allowed_tools  TEXT NOT NULL DEFAULT '',
      has_references INTEGER NOT NULL DEFAULT 0,
      has_templates  INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES skill_repositories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_skill_discoveries_repo_id
      ON skill_discoveries(repo_id, name);

    CREATE TABLE IF NOT EXISTS installed_skills (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      allowed_tools   TEXT NOT NULL DEFAULT '',
      has_references  INTEGER NOT NULL DEFAULT 0,
      has_templates   INTEGER NOT NULL DEFAULT 0,
      source_key      TEXT,
      source_repo_id  TEXT,
      source_repo_name TEXT,
      source_repo_url TEXT,
      source_branch   TEXT,
      source_path     TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      FOREIGN KEY (source_repo_id) REFERENCES skill_repositories(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_skills_source_key
      ON installed_skills(source_key);
  `)

  const messageColumns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>
  const hasSystemNoticeJson = messageColumns.some((col) => col.name === 'system_notice_json')
  if (!hasSystemNoticeJson) {
    db.exec(`ALTER TABLE messages ADD COLUMN system_notice_json TEXT`)
  }
  const hasContentSegments = messageColumns.some((col) => col.name === 'content_segments')
  if (!hasContentSegments) {
    db.exec(`ALTER TABLE messages ADD COLUMN content_segments TEXT`)
  }

  const toolColumns = db.prepare(`PRAGMA table_info(tool_activities)`).all() as Array<{ name: string }>
  const ensureToolColumn = (name: string, sql: string): void => {
    if (!toolColumns.some((col) => col.name === name)) {
      db.exec(sql)
    }
  }
  ensureToolColumn('subagent_json', `ALTER TABLE tool_activities ADD COLUMN subagent_json TEXT`)
  ensureToolColumn('duration_ms', `ALTER TABLE tool_activities ADD COLUMN duration_ms INTEGER`)
  ensureToolColumn('render_hint', `ALTER TABLE tool_activities ADD COLUMN render_hint TEXT`)
  ensureToolColumn('language', `ALTER TABLE tool_activities ADD COLUMN language TEXT`)
  ensureToolColumn('file_path', `ALTER TABLE tool_activities ADD COLUMN file_path TEXT`)
  ensureToolColumn('metadata_json', `ALTER TABLE tool_activities ADD COLUMN metadata_json TEXT`)

  const repositoryColumns = db.prepare(`PRAGMA table_info(skill_repositories)`).all() as Array<{ name: string }>
  const ensureRepositoryColumn = (name: string, sql: string): void => {
    if (!repositoryColumns.some((col) => col.name === name)) {
      db.exec(sql)
    }
  }

  ensureRepositoryColumn('proxy_enabled', `ALTER TABLE skill_repositories ADD COLUMN proxy_enabled INTEGER NOT NULL DEFAULT 0`)
  ensureRepositoryColumn('proxy_protocol', `ALTER TABLE skill_repositories ADD COLUMN proxy_protocol TEXT NOT NULL DEFAULT 'http'`)
  ensureRepositoryColumn('proxy_host', `ALTER TABLE skill_repositories ADD COLUMN proxy_host TEXT NOT NULL DEFAULT ''`)
  ensureRepositoryColumn('proxy_port', `ALTER TABLE skill_repositories ADD COLUMN proxy_port TEXT NOT NULL DEFAULT ''`)
  ensureRepositoryColumn('proxy_username', `ALTER TABLE skill_repositories ADD COLUMN proxy_username TEXT NOT NULL DEFAULT ''`)
  ensureRepositoryColumn('proxy_password', `ALTER TABLE skill_repositories ADD COLUMN proxy_password TEXT NOT NULL DEFAULT ''`)

  const sessionColumns = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>
  if (!sessionColumns.some((col) => col.name === 'project_id')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT`)
  }
  if (!sessionColumns.some((col) => col.name === 'project_context_json')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN project_context_json TEXT`)
  }

  seedDefaultProjects(db)
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function upsertSession(
  sessionId: string,
  title?: string,
  options?: {
    projectId?: string
    projectContextJson?: string | null
  }
): void {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO sessions (session_id, title, project_id, project_context_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      project_id = COALESCE(excluded.project_id, sessions.project_id),
      project_context_json = COALESCE(excluded.project_context_json, sessions.project_context_json)
  `).run(
    sessionId,
    title || '',
    options?.projectId || null,
    options?.projectContextJson || null,
    now,
    now
  )
}

export function updateSessionTitle(sessionId: string, title: string): void {
  getDb().prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?`)
    .run(title, Date.now(), sessionId)
}

export interface SessionRow {
  session_id: string
  title: string
  project_id: string | null
  project_context_json: string | null
  created_at: number
  updated_at: number
}

export function listSessions(): SessionRow[] {
  return getDb().prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`).all() as SessionRow[]
}

export function getSession(sessionId: string): SessionRow | null {
  return getDb().prepare(`SELECT * FROM sessions WHERE session_id = ?`).get(sessionId) as SessionRow | null
}

function escapeSqlLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function projectContextLikePattern(projectId: string): string {
  return `%${escapeSqlLike(projectId)}%`
}

export function listProjectSessions(projectId: string): SessionRow[] {
  return getDb().prepare(`
    SELECT * FROM sessions
    WHERE project_id = ?
      OR project_context_json LIKE ? ESCAPE '\\'
    ORDER BY updated_at DESC
  `).all(projectId, projectContextLikePattern(projectId)) as SessionRow[]
}

export function deleteSession(sessionId: string): void {
  getDb().prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId)
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface ProjectRow {
  project_id: string
  name: string
  description: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export function createProject(input: {
  projectId: string
  name: string
  description?: string
}): ProjectRow {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO projects (project_id, name, description, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(
    input.projectId,
    input.name.trim(),
    input.description?.trim() || '',
    now,
    now
  )

  return getProject(input.projectId)!
}

export function getProject(projectId: string, includeDeleted = false): ProjectRow | null {
  const sql = includeDeleted
    ? `SELECT * FROM projects WHERE project_id = ?`
    : `SELECT * FROM projects WHERE project_id = ? AND deleted_at IS NULL`
  return getDb().prepare(sql).get(projectId) as ProjectRow | null
}

export function listProjects(): ProjectRow[] {
  return getDb().prepare(`
    SELECT * FROM projects
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC
  `).all() as ProjectRow[]
}

export function softDeleteProject(projectId: string): void {
  const now = Date.now()
  getDb().prepare(`
    UPDATE projects
    SET deleted_at = ?, updated_at = ?
    WHERE project_id = ? AND deleted_at IS NULL
  `).run(now, now, projectId)
}

export function softDeleteProjectWithSessions(projectId: string): { deletedSessions: number } {
  const db = getDb()
  const now = Date.now()
  return db.transaction(() => {
    db.prepare(`
      UPDATE projects
      SET deleted_at = ?, updated_at = ?
      WHERE project_id = ? AND deleted_at IS NULL
    `).run(now, now, projectId)
    const deleted = db.prepare(`
      DELETE FROM sessions
      WHERE project_id = ?
        OR project_context_json LIKE ? ESCAPE '\\'
    `).run(projectId, projectContextLikePattern(projectId))
    return { deletedSessions: deleted.changes }
  })()
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  system_notice_json: string | null
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
  duration_ms: number | null
  render_hint: string | null
  language: string | null
  file_path: string | null
  metadata_json: string | null
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

export interface ConfigDocumentRow {
  scope: ConfigScope
  storage_format: ConfigStorageFormat
  schema_version: number
  payload_text: string
  created_at: number
  updated_at: number
}

export function getConfigDocument(scope: ConfigScope): ConfigDocumentRow | null {
  return getDb().prepare(`
    SELECT scope, storage_format, schema_version, payload_text, created_at, updated_at
    FROM config_documents
    WHERE scope = ?
  `).get(scope) as ConfigDocumentRow | null
}

export function saveConfigDocument(input: {
  scope: ConfigScope
  storageFormat: ConfigStorageFormat
  payloadText: string
  schemaVersion?: number
}): void {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO config_documents (scope, storage_format, schema_version, payload_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      storage_format = excluded.storage_format,
      schema_version = excluded.schema_version,
      payload_text = excluded.payload_text,
      updated_at = excluded.updated_at
  `).run(
    input.scope,
    input.storageFormat,
    input.schemaVersion || 1,
    input.payloadText,
    now,
    now
  )
}

export function deleteConfigDocument(scope: ConfigScope): void {
  getDb().prepare(`DELETE FROM config_documents WHERE scope = ?`).run(scope)
}

export function insertMessage(msg: {
  id: string
  sessionId: string
  role: string
  content: string
  systemNotice?: Record<string, unknown>
  contentSegments?: Array<{ text: string; ts: number; subagent?: { taskId: string; label: string; status: string } }>
  thinking?: string
  createdAt: number
}): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO messages (id, session_id, role, content, system_notice_json, content_segments, thinking, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    msg.sessionId,
    msg.role,
    msg.content,
    msg.systemNotice ? JSON.stringify(msg.systemNotice) : null,
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
  const resolvedContent = contentSegments
    ? contentSegments.map((segment) => segment.text || '').join('')
    : content

  if (usage) {
    // response_end: update metadata only, don't overwrite streamed content
    if (resolvedContent) {
      getDb().prepare(`
        UPDATE messages SET content = ?, content_segments = ?, tools_used = ?, usage_prompt = ?, usage_completion = ?, usage_total = ?
        WHERE id = ?
      `).run(
        resolvedContent,
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
  } else if (contentSegments) {
    getDb().prepare(`UPDATE messages SET content = ?, content_segments = ? WHERE id = ?`)
      .run(resolvedContent, JSON.stringify(contentSegments), id)
  } else if (content) {
    getDb().prepare(`UPDATE messages SET content = content || ? WHERE id = ?`)
      .run(content, id)
  }
}

export function updateMessageSystemNotice(
  id: string,
  systemNotice: Record<string, unknown>,
  createdAt?: number,
): void {
  if (createdAt != null) {
    getDb().prepare(`
      UPDATE messages SET system_notice_json = ?, created_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(systemNotice),
      createdAt,
      id,
    )
    return
  }

  getDb().prepare(`UPDATE messages SET system_notice_json = ? WHERE id = ?`)
    .run(JSON.stringify(systemNotice), id)
}

export interface FullMessage {
  id: string
  session_id: string
  role: string
  content: string
  system_notice_json: string | null
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
  durationMs?: number
  renderHint?: string
  language?: string
  filePath?: string
  metadataJson?: string
  subagent?: { taskId: string; label: string; status: string }
}): void {
  getDb().prepare(`
    INSERT INTO tool_activities (
      message_id, type, name, content, call_id, is_error, duration_ms, render_hint, language, file_path, metadata_json, subagent_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId,
    activity.type,
    activity.name || null,
    activity.content,
    activity.callId || null,
    activity.isError ? 1 : 0,
    typeof activity.durationMs === 'number' ? activity.durationMs : null,
    activity.renderHint || null,
    activity.language || null,
    activity.filePath || null,
    activity.metadataJson || null,
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

function seedDefaultProjects(db: Database.Database): void {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM projects`).get() as { count: number }
  if (row.count > 0) return

  const now = Date.now()
  const insert = db.prepare(`
    INSERT INTO projects (project_id, name, description, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `)

  for (const project of DEFAULT_PROJECTS) {
    insert.run(project.projectId, project.name, project.description, now, now)
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
