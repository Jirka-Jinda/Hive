import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  path       TEXT    NOT NULL UNIQUE,
  source     TEXT    NOT NULL CHECK(source IN ('local','git')),
  git_url    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE,
  agent_type     TEXT    NOT NULL,
  encrypted_data TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  agent_type    TEXT    NOT NULL,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  name          TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'stopped' CHECK(status IN ('running','stopped')),
  state         TEXT    NOT NULL DEFAULT 'stopped' CHECK(state IN ('working','idle','stopped')),
  branch_mode   TEXT,
  initial_branch_name TEXT,
  worktree_path TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  output     BLOB    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 index over session_logs for full-text search (plain-text representation)
CREATE VIRTUAL TABLE IF NOT EXISTS session_logs_fts USING fts5(
  text,
  log_id UNINDEXED,
  session_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS session_usage_totals (
  session_id     INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  context_tokens INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  prompt_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  total_tokens   INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repo_usage_rollups (
  repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  agent_type      TEXT    NOT NULL,
  credential_key  TEXT    NOT NULL,
  credential_id   INTEGER,
  credential_name TEXT    NOT NULL,
  context_tokens  INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (repo_id, agent_type, credential_key)
);

CREATE TABLE IF NOT EXISTS md_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT    NOT NULL CHECK(scope IN ('central','repo','session')),
  repo_id    INTEGER REFERENCES repos(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  path       TEXT    NOT NULL,
  type       TEXT    NOT NULL CHECK(type IN ('documentation','skill','tool','instruction','prompt','other')),
  content    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS md_file_revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  md_file_id      INTEGER NOT NULL REFERENCES md_files(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  content         TEXT    NOT NULL,
  author_source   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (md_file_id, revision_number)
);

-- Repo-level central MD file references (default context for all sessions in a repo)
CREATE TABLE IF NOT EXISTS repo_md_refs (
  repo_id    INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  md_file_id INTEGER NOT NULL REFERENCES md_files(id) ON DELETE CASCADE,
  PRIMARY KEY (repo_id, md_file_id)
);

-- Session-level MD file references (per-session context overrides)
CREATE TABLE IF NOT EXISTS session_md_refs (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  md_file_id INTEGER NOT NULL REFERENCES md_files(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, md_file_id)
);

-- Automated task scheduler
CREATE TABLE IF NOT EXISTS automation_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  md_file_id  INTEGER NOT NULL REFERENCES md_files(id) ON DELETE CASCADE,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  cron        TEXT    NOT NULL,
  params      TEXT    NOT NULL DEFAULT '{}',
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_started_at  TEXT,
  last_run_at TEXT,
  last_run_finished_at TEXT,
  last_run_duration_ms INTEGER,
  last_run_status      TEXT,
  last_error           TEXT,
  last_output_summary  TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_task_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  trigger        TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  started_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT,
  duration_ms    INTEGER,
  error_message  TEXT,
  output_summary TEXT
);

CREATE TABLE IF NOT EXISTS change_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type         TEXT    NOT NULL,
  scope              TEXT,
  repo_id            INTEGER REFERENCES repos(id) ON DELETE CASCADE,
  session_id         INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  md_file_id         INTEGER REFERENCES md_files(id) ON DELETE SET NULL,
  automation_task_id INTEGER REFERENCES automation_tasks(id) ON DELETE SET NULL,
  path               TEXT,
  title              TEXT    NOT NULL,
  summary            TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Application error log (errors / unhandled exceptions)
CREATE TABLE IF NOT EXISTS app_error_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT NOT NULL,
  stack      TEXT,
  context    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User action log (major user-initiated events)
CREATE TABLE IF NOT EXISTS user_action_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const MD_FILE_INDEX_SCHEMA = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_md_files_central_path
  ON md_files(path)
  WHERE scope = 'central';

CREATE UNIQUE INDEX IF NOT EXISTS idx_md_files_repo_path
  ON md_files(repo_id, path)
  WHERE scope = 'repo' AND repo_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_md_files_session_path
  ON md_files(session_id, path)
  WHERE scope = 'session' AND session_id IS NOT NULL;
`;

export const OBSERVABILITY_INDEX_SCHEMA = `
CREATE INDEX IF NOT EXISTS idx_md_file_revisions_file_revision
  ON md_file_revisions(md_file_id, revision_number DESC);

CREATE INDEX IF NOT EXISTS idx_automation_task_runs_task_started
  ON automation_task_runs(task_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_events_created
  ON change_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_events_repo_session
  ON change_events(repo_id, session_id, created_at DESC);
`;
