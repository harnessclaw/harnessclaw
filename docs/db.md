# SQLite Schema

## Overview

- Database path: `~/.harnessclaw/db/harnessclaw.db`
- Driver: `better-sqlite3`
- PRAGMA:
  - `journal_mode = WAL`
  - `foreign_keys = ON`

## Tables

### `config_documents`

Stores application configuration documents. Engine configuration is file-based and is not persisted in SQLite.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `scope` | `TEXT` | `PRIMARY KEY`, `CHECK (scope IN ('app', 'engine'))` | Configuration domain. Current application usage only writes `app` |
| `storage_format` | `TEXT` | `NOT NULL`, `CHECK (storage_format IN ('json', 'yaml'))` | Serialization format of `payload_text` |
| `schema_version` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK (schema_version >= 1)` | Document schema version |
| `payload_text` | `TEXT` | `NOT NULL` | Serialized config payload |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |
| `updated_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

### `sessions`

Stores chat session metadata.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `session_id` | `TEXT` | `PRIMARY KEY` | Session identifier |
| `title` | `TEXT` | `NOT NULL DEFAULT ''` | Session title |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |
| `updated_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

### `messages`

Stores message bodies and usage metadata for each session.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Message identifier |
| `session_id` | `TEXT` | `NOT NULL`, `FOREIGN KEY -> sessions(session_id) ON DELETE CASCADE` | Owning session |
| `role` | `TEXT` | `NOT NULL` | Message role |
| `content` | `TEXT` | `NOT NULL DEFAULT ''` | Final or incremental text content |
| `content_segments` | `TEXT` |  | JSON-encoded streamed segments |
| `thinking` | `TEXT` |  | Model reasoning text if present |
| `tools_used` | `TEXT` |  | JSON-encoded tool list |
| `usage_prompt` | `INTEGER` |  | Prompt token count |
| `usage_completion` | `INTEGER` |  | Completion token count |
| `usage_total` | `INTEGER` |  | Total token count |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

Indexes:

- `idx_messages_session (session_id, created_at)`

Compatibility migrations:

- Add `content_segments` when missing.

### `tool_activities`

Stores tool calls and tool results linked to a message.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | Activity row identifier |
| `message_id` | `TEXT` | `NOT NULL`, `FOREIGN KEY -> messages(id) ON DELETE CASCADE` | Owning message |
| `type` | `TEXT` | `NOT NULL` | Activity type |
| `name` | `TEXT` |  | Tool name |
| `content` | `TEXT` | `NOT NULL DEFAULT ''` | Activity payload |
| `call_id` | `TEXT` |  | Tool call identifier |
| `is_error` | `INTEGER` | `DEFAULT 0` | Boolean flag stored as 0/1 |
| `subagent_json` | `TEXT` |  | JSON-encoded subagent metadata |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

Indexes:

- `idx_tools_message (message_id)`

Compatibility migrations:

- Add `subagent_json` when missing.

### `usage_events`

Stores runtime analytics and operational events.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | Event row identifier |
| `category` | `TEXT` | `NOT NULL` | Event category |
| `action` | `TEXT` | `NOT NULL` | Event action |
| `status` | `TEXT` | `NOT NULL` | Event status |
| `details_json` | `TEXT` | `NOT NULL DEFAULT '{}'` | JSON-encoded metadata |
| `session_id` | `TEXT` |  | Related session if any |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

Indexes:

- `idx_usage_events_created_at (created_at DESC)`

### `skill_repositories`

Stores configured external skill repositories.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Repository identifier |
| `name` | `TEXT` | `NOT NULL` | Display name |
| `provider` | `TEXT` | `NOT NULL DEFAULT 'github'` | Repository provider |
| `repo_url` | `TEXT` | `NOT NULL` | Canonical repository URL |
| `owner` | `TEXT` | `NOT NULL` | Repository owner |
| `repo` | `TEXT` | `NOT NULL` | Repository name |
| `branch` | `TEXT` | `NOT NULL` | Tracked branch |
| `base_path` | `TEXT` | `NOT NULL DEFAULT ''` | Base path within repository |
| `proxy_enabled` | `INTEGER` | `NOT NULL DEFAULT 0` | Whether repository fetching uses a proxy |
| `proxy_protocol` | `TEXT` | `NOT NULL DEFAULT 'http'` | Proxy protocol (`http` / `https` / `socks5`) |
| `proxy_host` | `TEXT` | `NOT NULL DEFAULT ''` | Proxy hostname |
| `proxy_port` | `TEXT` | `NOT NULL DEFAULT ''` | Proxy port |
| `enabled` | `INTEGER` | `NOT NULL DEFAULT 1` | Boolean flag stored as 0/1 |
| `last_discovered_at` | `INTEGER` |  | Last discovery timestamp |
| `last_error` | `TEXT` |  | Last discovery error |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |
| `updated_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

Indexes:

- `idx_skill_repositories_enabled (enabled, updated_at DESC)`
- `idx_skill_repositories_repo_branch_path UNIQUE (repo_url, branch, base_path)`

Compatibility migrations:

- Add `proxy_enabled`, `proxy_protocol`, `proxy_host`, `proxy_port`, `proxy_username`, `proxy_password` when missing.
  Runtime currently only uses `proxy_enabled`, `proxy_protocol`, `proxy_host`, `proxy_port`.

### `skill_discoveries`

Stores skill metadata discovered from external repositories.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `key` | `TEXT` | `PRIMARY KEY` | Discovery key |
| `repo_id` | `TEXT` | `NOT NULL`, `FOREIGN KEY -> skill_repositories(id) ON DELETE CASCADE` | Owning repository |
| `repo_name` | `TEXT` | `NOT NULL` | Repository display name |
| `repo_url` | `TEXT` | `NOT NULL` | Repository URL |
| `owner` | `TEXT` | `NOT NULL` | Repository owner |
| `repo` | `TEXT` | `NOT NULL` | Repository name |
| `branch` | `TEXT` | `NOT NULL` | Branch |
| `skill_path` | `TEXT` | `NOT NULL` | Path to the discovered skill |
| `directory_name` | `TEXT` | `NOT NULL` | Skill directory name |
| `name` | `TEXT` | `NOT NULL` | Skill display name |
| `description` | `TEXT` | `NOT NULL DEFAULT ''` | Skill description |
| `allowed_tools` | `TEXT` | `NOT NULL DEFAULT ''` | Serialized allowed tool list |
| `has_references` | `INTEGER` | `NOT NULL DEFAULT 0` | Boolean flag stored as 0/1 |
| `has_templates` | `INTEGER` | `NOT NULL DEFAULT 0` | Boolean flag stored as 0/1 |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |
| `updated_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

Indexes:

- `idx_skill_discoveries_repo_id (repo_id, name)`

### `installed_skills`

Stores installed skills and their upstream source metadata.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Installed skill identifier |
| `name` | `TEXT` | `NOT NULL` | Skill display name |
| `description` | `TEXT` | `NOT NULL DEFAULT ''` | Skill description |
| `allowed_tools` | `TEXT` | `NOT NULL DEFAULT ''` | Serialized allowed tool list |
| `has_references` | `INTEGER` | `NOT NULL DEFAULT 0` | Boolean flag stored as 0/1 |
| `has_templates` | `INTEGER` | `NOT NULL DEFAULT 0` | Boolean flag stored as 0/1 |
| `source_key` | `TEXT` |  | Source discovery key |
| `source_repo_id` | `TEXT` | `FOREIGN KEY -> skill_repositories(id) ON DELETE SET NULL` | Source repository id |
| `source_repo_name` | `TEXT` |  | Source repository display name |
| `source_repo_url` | `TEXT` |  | Source repository URL |
| `source_branch` | `TEXT` |  | Source branch |
| `source_path` | `TEXT` |  | Source path |
| `created_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |
| `updated_at` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |

Indexes:

- `idx_installed_skills_source_key UNIQUE (source_key)`

## Relationships

- `messages.session_id -> sessions.session_id`
- `tool_activities.message_id -> messages.id`
- `skill_discoveries.repo_id -> skill_repositories.id`
- `installed_skills.source_repo_id -> skill_repositories.id`

## Configuration Storage Notes

- Application config is stored in `config_documents.scope = 'app'` as JSON text.
- Engine config remains file-based at `~/.harnessclaw/harnessclaw-engine.yaml`.
- Legacy `~/.harnessclaw/harnessclaw.json` is treated as a one-time migration source when the app config row is missing.
- If an older build has already written `config_documents.scope = 'engine'`, startup migrates that row back to `~/.harnessclaw/harnessclaw-engine.yaml` and deletes the SQLite row.
