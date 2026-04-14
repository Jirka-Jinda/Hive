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
}
