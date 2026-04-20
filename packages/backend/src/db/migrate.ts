import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { SCHEMA } from './schema';

export function migrate(db: Database.Database): void {
  db.exec(SCHEMA);

  // Add state column to sessions if it doesn't exist yet (existing DBs)
  const sessionCols = db.pragma('table_info(sessions)') as { name: string }[];
  if (!sessionCols.some((c) => c.name === 'state')) {
    db.exec("ALTER TABLE sessions ADD COLUMN state TEXT NOT NULL DEFAULT 'stopped'");
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

  // Migrate type CHECK constraint to include 'prompt' (SQLite requires table recreation)
  // We use a pragmatic approach: insert a test row to detect the old constraint,
  // then recreate the table if needed.
  try {
    db.exec("INSERT INTO md_files (scope,path,type,content) VALUES ('central','__probe__','prompt','') ON CONFLICT(scope,path) DO UPDATE SET content=content");
    db.exec("DELETE FROM md_files WHERE path='__probe__' AND scope='central'");
  } catch {
    // Old constraint — recreate the table to expand the CHECK
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE IF NOT EXISTS md_files_new (
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
      INSERT INTO md_files_new SELECT * FROM md_files;
      DROP TABLE md_files;
      ALTER TABLE md_files_new RENAME TO md_files;
      PRAGMA foreign_keys = ON;
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
        last_run_at TEXT,
        next_run_at TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
}