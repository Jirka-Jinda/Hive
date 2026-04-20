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
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  output     BLOB    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS md_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT    NOT NULL CHECK(scope IN ('central','repo')),
  repo_id    INTEGER REFERENCES repos(id) ON DELETE CASCADE,
  path       TEXT    NOT NULL,
  type       TEXT    NOT NULL CHECK(type IN ('skill','tool','instruction','prompt','other')),
  content    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope, path)
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
  last_run_at TEXT,
  next_run_at TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;
