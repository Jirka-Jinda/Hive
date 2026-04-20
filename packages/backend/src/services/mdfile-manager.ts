import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import type { CentralMdSyncService } from './central-md-sync';

export interface MdFile {
  id: number;
  scope: 'central' | 'repo';
  repo_id: number | null;
  path: string;
  type: 'skill' | 'tool' | 'instruction' | 'prompt' | 'other';
  created_at: string;
  updated_at: string;
}

function inferType(filename: string): MdFile['type'] {
  const lower = filename.toLowerCase();
  if (lower.includes('skill')) return 'skill';
  if (lower.includes('tool')) return 'tool';
  if (lower.includes('instruction') || lower.includes('copilot') || lower.includes('agent')) return 'instruction';
  return 'other';
}

/** Reject filenames that attempt directory traversal. */
function sanitizeFilename(name: string): string {
  const base = basename(name);
  if (!base || base.startsWith('.') || base.includes('/') || base.includes('\\')) {
    throw new Error('Invalid filename');
  }
  return base;
}

export class MdFileManager {
  constructor(
    private db: Database.Database,
    private sync?: CentralMdSyncService,
  ) {}

  /** Wire in sync after construction (avoids circular init with CentralMdSyncService). */
  setSyncService(sync: CentralMdSyncService): void {
    this.sync = sync;
  }

  list(scope?: string, repoId?: number): MdFile[] {
    if (scope && repoId !== undefined) {
      return this.db
        .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files WHERE scope = ? AND repo_id = ? ORDER BY path')
        .all(scope, repoId) as MdFile[];
    }
    if (scope) {
      return this.db
        .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files WHERE scope = ? ORDER BY path')
        .all(scope) as MdFile[];
    }
    return this.db
      .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files ORDER BY scope, path')
      .all() as MdFile[];
  }

  read(id: number): { file: MdFile; content: string } {
    const row = this.db
      .prepare('SELECT * FROM md_files WHERE id = ?')
      .get(id) as (MdFile & { content: string }) | undefined;
    if (!row) throw new Error(`MD file ${id} not found`);
    const { content, ...file } = row;
    return { file, content };
  }

  write(id: number, content: string): MdFile {
    const existing = this.db.prepare('SELECT id,scope,path FROM md_files WHERE id = ?').get(id) as (MdFile) | undefined;
    if (!existing) throw new Error(`MD file ${id} not found`);
    this.db
      .prepare("UPDATE md_files SET content = ?, updated_at = datetime('now') WHERE id = ?")
      .run(content, id);
    if (existing.scope === 'central') this.sync?.writeToDisk(existing.path, content);
    return this.db
      .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
      .get(id) as MdFile;
  }

  create(
    scope: 'central' | 'repo',
    repoPath: string | null,
    filename: string,
    content: string,
    type: MdFile['type'] = 'other'
  ): MdFile {
    const safeName = sanitizeFilename(filename.endsWith('.md') ? filename : `${filename}.md`);
    const inferredType = type ?? inferType(safeName);

    if (scope === 'repo' && !repoPath) {
      throw new Error('repoPath is required for repo-scoped files');
    }

    const repoRow =
      scope === 'repo' && repoPath
        ? (this.db.prepare('SELECT id FROM repos WHERE path = ?').get(repoPath) as { id: number } | undefined)
        : undefined;
    const repoId = repoRow?.id ?? null;

    if (scope === 'repo' && repoId === null) {
      throw new Error(`Repo not found for path: ${repoPath}`);
    }

    this.db
      .prepare(`
        INSERT INTO md_files (scope, repo_id, path, type, content) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(scope, path) DO UPDATE SET content = excluded.content, updated_at = datetime('now'), type = excluded.type
      `)
      .run(scope, repoId, safeName, inferredType, content);

    if (scope === 'central') this.sync?.writeToDisk(safeName, content);

    return this.db
      .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files WHERE scope = ? AND path = ?')
      .get(scope, safeName) as MdFile;
  }

  delete(id: number): void {
    const row = this.db.prepare('SELECT id,scope,path FROM md_files WHERE id = ?').get(id) as MdFile | undefined;
    if (!row) throw new Error(`MD file ${id} not found`);
    const result = this.db.prepare('DELETE FROM md_files WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`MD file ${id} not found`);
    if (row.scope === 'central') this.sync?.deleteFromDisk(row.path);
  }
}