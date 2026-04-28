import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import type { CentralMdSyncService } from './central-md-sync';
import type { DiscoveredRepoMdFile } from '../utils/repo-md-discovery';

export interface MdFile {
  id: number;
  scope: 'central' | 'repo';
  repo_id: number | null;
  path: string;
  type: 'skill' | 'tool' | 'instruction' | 'prompt' | 'other';
  created_at: string;
  updated_at: string;
}

export interface MdFileUpdate {
  content?: string;
  scope?: MdFile['scope'];
  repoPath?: string | null;
  filename?: string;
  type?: MdFile['type'];
}

function inferType(filename: string): MdFile['type'] {
  const lower = filename.toLowerCase();
  if (lower.includes('skill')) return 'skill';
  if (lower.includes('tool')) return 'tool';
  if (lower.includes('prompt')) return 'prompt';
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

function normalizeRepoStoredPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Invalid repo file path');
  }
  return normalized;
}

type MdFileRow = MdFile & { content: string };

export class MdFileManager {
  constructor(
    private db: Database.Database,
    private sync?: CentralMdSyncService,
  ) {}

  /** Wire in sync after construction (avoids circular init with CentralMdSyncService). */
  setSyncService(sync: CentralMdSyncService): void {
    this.sync = sync;
  }

  private getRepoIdByPath(repoPath: string): number {
    const repoRow = this.db.prepare('SELECT id FROM repos WHERE path = ?').get(repoPath) as { id: number } | undefined;
    if (!repoRow) {
      throw new Error(`Repo not found for path: ${repoPath}`);
    }
    return repoRow.id;
  }

  private getRow(id: number): MdFileRow {
    const row = this.db.prepare('SELECT * FROM md_files WHERE id = ?').get(id) as MdFileRow | undefined;
    if (!row) throw new Error(`MD file ${id} not found`);
    return row;
  }

  private findByScopePath(scope: MdFile['scope'], path: string, repoId: number | null, excludeId?: number): MdFileRow | undefined {
    if (scope === 'central') {
      return (excludeId === undefined
        ? this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND path = ?').get(scope, path)
        : this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND path = ? AND id <> ?').get(scope, path, excludeId)) as MdFileRow | undefined;
    }

    if (repoId === null) {
      throw new Error('repoId is required for repo-scoped files');
    }

    return (excludeId === undefined
      ? this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND repo_id = ? AND path = ?').get(scope, repoId, path)
      : this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND repo_id = ? AND path = ? AND id <> ?').get(scope, repoId, path, excludeId)) as MdFileRow | undefined;
  }

  private persist(scope: MdFile['scope'], repoId: number | null, path: string, content: string, type: MdFile['type']): MdFile {
    const existing = this.findByScopePath(scope, path, repoId);

    if (existing) {
      this.db
        .prepare("UPDATE md_files SET content = ?, type = ?, updated_at = datetime('now') WHERE id = ?")
        .run(content, type, existing.id);
      if (scope === 'central') this.sync?.writeToDisk(path, content);
      return this.db
        .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
        .get(existing.id) as MdFile;
    }

    const result = this.db
      .prepare('INSERT INTO md_files (scope, repo_id, path, type, content) VALUES (?, ?, ?, ?, ?)')
      .run(scope, repoId, path, type, content);

    if (scope === 'central') this.sync?.writeToDisk(path, content);

    return this.db
      .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
      .get(result.lastInsertRowid as number) as MdFile;
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
    const row = this.getRow(id);
    const { content, ...file } = row;
    return { file, content };
  }

  write(id: number, content: string): MdFile {
    return this.update(id, { content });
  }

  update(id: number, changes: MdFileUpdate): MdFile {
    const existing = this.getRow(id);

    const nextScope = changes.scope ?? existing.scope;
    const nextType = changes.type ?? existing.type;
    const nextContent = changes.content ?? existing.content;
    const requestedFilename = changes.filename?.trim();
    const nextPath = requestedFilename !== undefined
      ? sanitizeFilename(requestedFilename.endsWith('.md') ? requestedFilename : `${requestedFilename}.md`)
      : existing.path;

    let nextRepoId: number | null;
    if (nextScope === 'central') {
      nextRepoId = null;
    } else if (changes.repoPath) {
      nextRepoId = this.getRepoIdByPath(changes.repoPath);
    } else if (existing.scope === 'repo' && existing.repo_id !== null) {
      nextRepoId = existing.repo_id;
    } else {
      throw new Error('repoPath is required for repo-scoped files');
    }

    const conflict = this.findByScopePath(nextScope, nextPath, nextRepoId, id);
    if (conflict) {
      throw new Error(`An MD file named ${nextPath} already exists in the target scope`);
    }

    this.db
      .prepare("UPDATE md_files SET scope = ?, repo_id = ?, path = ?, type = ?, content = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nextScope, nextRepoId, nextPath, nextType, nextContent, id);

    if (nextScope === 'repo' && nextRepoId !== null && (existing.scope !== 'repo' || existing.repo_id !== nextRepoId)) {
      this.db.prepare('DELETE FROM repo_md_refs WHERE md_file_id = ? AND repo_id <> ?').run(id, nextRepoId);
      this.db.prepare(`
        DELETE FROM session_md_refs
        WHERE md_file_id = ?
          AND session_id IN (SELECT id FROM sessions WHERE repo_id <> ?)
      `).run(id, nextRepoId);
    }

    if (existing.scope === 'central' && (nextScope !== 'central' || existing.path !== nextPath)) {
      this.sync?.deleteFromDisk(existing.path);
    }
    if (
      nextScope === 'central' &&
      (existing.scope !== 'central' || existing.content !== nextContent || existing.path !== nextPath)
    ) {
      this.sync?.writeToDisk(nextPath, nextContent);
    }

    return this.db
      .prepare('SELECT id,scope,repo_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
      .get(id) as MdFile;
  }

  create(
    scope: 'central' | 'repo',
    repoPath: string | null,
    filename: string,
    content: string,
    type?: MdFile['type']
  ): MdFile {
    const safeName = sanitizeFilename(filename.endsWith('.md') ? filename : `${filename}.md`);
    const inferredType = type ?? inferType(safeName);

    if (scope === 'repo' && !repoPath) {
      throw new Error('repoPath is required for repo-scoped files');
    }

    const repoId = scope === 'repo' && repoPath ? this.getRepoIdByPath(repoPath) : null;
    return this.persist(scope, repoId, safeName, content, inferredType);
  }

  importDiscoveredRepoFiles(repoId: number, files: readonly DiscoveredRepoMdFile[]): MdFile[] {
    const importFiles = this.db.transaction((rows: readonly DiscoveredRepoMdFile[]) => {
      return rows.map((row) => this.persist('repo', repoId, normalizeRepoStoredPath(row.path), row.content, row.type));
    });

    return importFiles(files);
  }

  deleteRepoFiles(repoId: number): void {
    this.db.prepare("DELETE FROM md_files WHERE scope = 'repo' AND repo_id = ?").run(repoId);
  }

  delete(id: number): void {
    const row = this.db.prepare('SELECT id,scope,path FROM md_files WHERE id = ?').get(id) as MdFile | undefined;
    if (!row) throw new Error(`MD file ${id} not found`);
    const result = this.db.prepare('DELETE FROM md_files WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`MD file ${id} not found`);
    if (row.scope === 'central') this.sync?.deleteFromDisk(row.path);
  }
}
