import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { MD_FILE_INDEX_SCHEMA, OBSERVABILITY_INDEX_SCHEMA, SCHEMA } from './schema';
import { normalizeTerminalText } from '../utils/terminal-text';

function normalizeLogSearchText(output: Buffer | string): string {
  const raw = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  return normalizeTerminalText(raw)
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
}

export function migrate(db: Database.Database): void {
  db.exec(SCHEMA);

  // Add missing session columns for existing DBs.
  const sessionCols = db.pragma('table_info(sessions)') as { name: string }[];
  if (!sessionCols.some((c) => c.name === 'state')) {
    db.exec("ALTER TABLE sessions ADD COLUMN state TEXT NOT NULL DEFAULT 'stopped'");
  }
  if (!sessionCols.some((c) => c.name === 'branch_mode')) {
    db.exec('ALTER TABLE sessions ADD COLUMN branch_mode TEXT');
  }
  if (!sessionCols.some((c) => c.name === 'initial_branch_name')) {
    db.exec('ALTER TABLE sessions ADD COLUMN initial_branch_name TEXT');
  }
  if (!sessionCols.some((c) => c.name === 'worktree_path')) {
    db.exec('ALTER TABLE sessions ADD COLUMN worktree_path TEXT');
  }
  if (!sessionCols.some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }
  if (!sessionCols.some((c) => c.name === 'archived_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN archived_at TEXT');
  }

  // Add content column if it doesn't exist yet (existing DBs)
  const cols = db.pragma('table_info(md_files)') as { name: string }[];
  if (!cols.some((c) => c.name === 'content')) {
    db.exec("ALTER TABLE md_files ADD COLUMN content TEXT NOT NULL DEFAULT ''");
    // Seed content from disk for any existing rows
    const rows = db.prepare('SELECT id, path FROM md_files').all() as { id: number; path: string }[];
    const update = db.prepare("UPDATE md_files SET content = ? WHERE id = ?");
    for (const row of rows) {
      try {
        if (existsSync(row.path)) {
          update.run(readFileSync(row.path, 'utf-8'), row.id);
        }
      } catch { /* skip unreadable files */ }
    }
  }

  const mdFilesTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='md_files'").get() as
    | { sql: string | null }
    | undefined;
  const tableSql = mdFilesTable?.sql ?? '';
  const needsMdFilesRebuild =
    /UNIQUE\s*\(\s*scope\s*,\s*path\s*\)/i.test(tableSql) ||
    !tableSql.includes("'prompt'") ||
    !tableSql.includes("'documentation'") ||
    !tableSql.includes("'session'") ||
    !cols.some((c) => c.name === 'session_id');

  if (needsMdFilesRebuild) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP INDEX IF EXISTS idx_md_files_central_path;
      DROP INDEX IF EXISTS idx_md_files_repo_path;
      DROP INDEX IF EXISTS idx_md_files_session_path;
      CREATE TABLE IF NOT EXISTS md_files_new (
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
      INSERT INTO md_files_new (id, scope, repo_id, session_id, path, type, content, created_at, updated_at)
      SELECT id, scope, repo_id, NULL, path, type, content, created_at, updated_at FROM md_files;
      DROP TABLE md_files;
      ALTER TABLE md_files_new RENAME TO md_files;
      PRAGMA foreign_keys = ON;
    `);
  }

  db.exec(MD_FILE_INDEX_SCHEMA);

  const mdFileRevisionsTable = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='md_file_revisions'"
  ).get()) as { name: string } | undefined;
  if (!mdFileRevisionsTable) {
    db.exec(`
      CREATE TABLE md_file_revisions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        md_file_id      INTEGER NOT NULL REFERENCES md_files(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL,
        content         TEXT    NOT NULL,
        author_source   TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (md_file_id, revision_number)
      )
    `);
  }

  // Add automation_tasks table for existing DBs
  const taskTable = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='automation_tasks'"
  ).get()) as { name: string } | undefined;
  if (!taskTable) {
    db.exec(`
      CREATE TABLE automation_tasks (
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
      )
    `);
  }

  const automationCols = db.pragma('table_info(automation_tasks)') as { name: string }[];
  if (!automationCols.some((c) => c.name === 'last_run_started_at')) {
    db.exec('ALTER TABLE automation_tasks ADD COLUMN last_run_started_at TEXT');
  }
  if (!automationCols.some((c) => c.name === 'last_run_finished_at')) {
    db.exec('ALTER TABLE automation_tasks ADD COLUMN last_run_finished_at TEXT');
  }
  if (!automationCols.some((c) => c.name === 'last_run_duration_ms')) {
    db.exec('ALTER TABLE automation_tasks ADD COLUMN last_run_duration_ms INTEGER');
  }
  if (!automationCols.some((c) => c.name === 'last_run_status')) {
    db.exec('ALTER TABLE automation_tasks ADD COLUMN last_run_status TEXT');
  }
  if (!automationCols.some((c) => c.name === 'last_error')) {
    db.exec('ALTER TABLE automation_tasks ADD COLUMN last_error TEXT');
  }
  if (!automationCols.some((c) => c.name === 'last_output_summary')) {
    db.exec('ALTER TABLE automation_tasks ADD COLUMN last_output_summary TEXT');
  }
  if (!automationCols.some((c) => c.name === 'consecutive_failures')) {
    db.exec('ALTER TABLE automation_tasks ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0');
  }

  const automationRunsTable = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='automation_task_runs'"
  ).get()) as { name: string } | undefined;
  if (!automationRunsTable) {
    db.exec(`
      CREATE TABLE automation_task_runs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id        INTEGER NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
        trigger        TEXT    NOT NULL,
        status         TEXT    NOT NULL,
        started_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        finished_at    TEXT,
        duration_ms    INTEGER,
        error_message  TEXT,
        output_summary TEXT
      )
    `);
  }

  const changeEventsTable = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='change_events'"
  ).get()) as { name: string } | undefined;
  if (!changeEventsTable) {
    db.exec(`
      CREATE TABLE change_events (
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
      )
    `);
  }

  db.exec(OBSERVABILITY_INDEX_SCHEMA);

  // Create or rebuild the FTS5 index for session log search on existing DBs.
  // Older builds used a contentless FTS table, which does not preserve
  // UNINDEXED metadata columns for filtering/snippets.
  const ftsTable = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='session_logs_fts'"
  ).get()) as { sql: string | null } | undefined;
  const needsFtsRebuild = !ftsTable || /content\s*=\s*''/i.test(ftsTable.sql ?? '');
  if (needsFtsRebuild) {
    db.exec(`
      DROP TABLE IF EXISTS session_logs_fts;
      CREATE VIRTUAL TABLE session_logs_fts USING fts5(
        text,
        log_id UNINDEXED,
        session_id UNINDEXED,
        tokenize='unicode61'
      )
    `);

    const rows = db.prepare('SELECT id, session_id, output FROM session_logs ORDER BY id ASC').all() as {
      id: number;
      session_id: number;
      output: Buffer | string;
    }[];
    const insert = db.prepare('INSERT INTO session_logs_fts (text, log_id, session_id) VALUES (?, ?, ?)');
    const backfill = db.transaction(() => {
      for (const row of rows) {
        const text = normalizeLogSearchText(row.output);
        if (text) insert.run(text, row.id, row.session_id);
      }
    });
    backfill();
  }
}
