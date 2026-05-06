import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import type { CentralMdSyncService } from './central-md-sync';
import type { DiscoveredRepoMdFile } from '../utils/repo-md-discovery';
import {
  AGENT_MD_DIR,
  AGENT_MD_DIR_ALIASES,
  getAgentDirNameFromRepoRelativePath,
  toAgentRelativePath,
  toRepoAgentPath,
} from '../utils/agent-md-files';

export interface MdFile {
  id: number;
  scope: 'central' | 'repo' | 'session';
  repo_id: number | null;
  session_id: number | null;
  path: string;
  type: 'documentation' | 'skill' | 'tool' | 'instruction' | 'prompt' | 'other';
  created_at: string;
  updated_at: string;
}

export interface MdFileRevision {
  id: number;
  md_file_id: number;
  revision_number: number;
  content: string;
  author_source: string | null;
  created_at: string;
}

export interface MdFileUpdate {
  content?: string;
  scope?: MdFile['scope'];
  repoPath?: string | null;
  sessionId?: number | null;
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

function stripAgentPrefix(path: string): string | null {
  const normalized = normalizeRepoStoredPath(path);
  return getAgentDirNameFromRepoRelativePath(normalized) ? toAgentRelativePath(normalized) : null;
}

function getRepoPathLookupCandidates(path: string): string[] {
  const normalized = normalizeRepoStoredPath(path);
  const agentRelativePath = stripAgentPrefix(normalized);
  if (!agentRelativePath) return [normalized];

  return Array.from(new Set([
    normalized,
    agentRelativePath,
    ...AGENT_MD_DIR_ALIASES.map((dirName) => toRepoAgentPath(agentRelativePath, dirName)),
  ]));
}

function toCanonicalAgentPath(path: string): string | null {
  const normalized = normalizeRepoStoredPath(path);
  const agentRelativePath = stripAgentPrefix(normalized);
  return agentRelativePath ? toRepoAgentPath(agentRelativePath) : null;
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

  private getSession(sessionId: number): { id: number; repo_id: number } {
    const row = this.db.prepare('SELECT id, repo_id FROM sessions WHERE id = ?').get(sessionId) as { id: number; repo_id: number } | undefined;
    if (!row) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return row;
  }

  private getRow(id: number): MdFileRow {
    const row = this.db.prepare('SELECT * FROM md_files WHERE id = ?').get(id) as MdFileRow | undefined;
    if (!row) throw new Error(`MD file ${id} not found`);
    return row;
  }

  private findByScopePath(
    scope: MdFile['scope'],
    path: string,
    repoId: number | null,
    sessionId: number | null,
    excludeId?: number,
  ): MdFileRow | undefined {
    if (scope === 'central') {
      return (excludeId === undefined
        ? this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND path = ?').get(scope, path)
        : this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND path = ? AND id <> ?').get(scope, path, excludeId)) as MdFileRow | undefined;
    }

    if (scope === 'repo') {
      if (repoId === null) {
        throw new Error('repoId is required for repo-scoped files');
      }

      return (excludeId === undefined
        ? this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND repo_id = ? AND path = ?').get(scope, repoId, path)
        : this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND repo_id = ? AND path = ? AND id <> ?').get(scope, repoId, path, excludeId)) as MdFileRow | undefined;
    }

    if (sessionId === null) {
      throw new Error('sessionId is required for session-scoped files');
    }

    return (excludeId === undefined
      ? this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND session_id = ? AND path = ?').get(scope, sessionId, path)
      : this.db.prepare('SELECT * FROM md_files WHERE scope = ? AND session_id = ? AND path = ? AND id <> ?').get(scope, sessionId, path, excludeId)) as MdFileRow | undefined;
  }

  private persist(
    scope: MdFile['scope'],
    repoId: number | null,
    sessionId: number | null,
    path: string,
    content: string,
    type: MdFile['type'],
  ): MdFile {
    const existing = this.findByScopePath(scope, path, repoId, sessionId);

    if (existing) {
      this.db
        .prepare("UPDATE md_files SET repo_id = ?, session_id = ?, content = ?, type = ?, updated_at = datetime('now') WHERE id = ?")
        .run(repoId, sessionId, content, type, existing.id);
      if (scope === 'central') this.sync?.writeToDisk(path, content);
      return this.db
        .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
        .get(existing.id) as MdFile;
    }

    const result = this.db
      .prepare('INSERT INTO md_files (scope, repo_id, session_id, path, type, content) VALUES (?, ?, ?, ?, ?, ?)')
      .run(scope, repoId, sessionId, path, type, content);

    if (scope === 'central') this.sync?.writeToDisk(path, content);

    return this.db
      .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
      .get(result.lastInsertRowid as number) as MdFile;
  }

  private persistDiscoveredRepoFile(repoId: number, path: string, content: string, type: MdFile['type']): MdFile {
    const normalizedPath = normalizeRepoStoredPath(path);
    const existing = getRepoPathLookupCandidates(normalizedPath)
      .map((candidate) => this.findByScopePath('repo', candidate, repoId, null))
      .find((candidate): candidate is MdFileRow => Boolean(candidate));

    if (existing) {
      this.db
        .prepare("UPDATE md_files SET repo_id = ?, session_id = NULL, content = ?, type = ?, updated_at = datetime('now') WHERE id = ?")
        .run(repoId, content, type, existing.id);
      return this.db
        .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
        .get(existing.id) as MdFile;
    }

    return this.persist('repo', repoId, null, normalizedPath, content, type);
  }

  list(scope?: string, repoId?: number, sessionId?: number): MdFile[] {
    if (scope === 'repo' && repoId !== undefined) {
      return this.db
        .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE scope = ? AND repo_id = ? ORDER BY path')
        .all(scope, repoId) as MdFile[];
    }
    if (scope === 'session' && sessionId !== undefined) {
      return this.db
        .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE scope = ? AND session_id = ? ORDER BY path')
        .all(scope, sessionId) as MdFile[];
    }
    if (scope) {
      return this.db
        .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE scope = ? ORDER BY path')
        .all(scope) as MdFile[];
    }
    return this.db
      .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files ORDER BY scope, path')
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
    let nextSessionId: number | null;
    if (nextScope === 'central') {
      nextRepoId = null;
      nextSessionId = null;
    } else if (nextScope === 'repo') {
      nextSessionId = null;
      if (changes.repoPath) {
        nextRepoId = this.getRepoIdByPath(changes.repoPath);
      } else if (existing.scope === 'repo' && existing.repo_id !== null) {
        nextRepoId = existing.repo_id;
      } else if (existing.scope === 'session' && existing.repo_id !== null) {
        nextRepoId = existing.repo_id;
      } else {
        throw new Error('repoPath is required for repo-scoped files');
      }
    } else {
      const resolvedSessionId = changes.sessionId ?? (existing.scope === 'session' ? existing.session_id : null);
      if (resolvedSessionId === null) {
        throw new Error('sessionId is required for session-scoped files');
      }
      const session = this.getSession(resolvedSessionId);
      nextRepoId = session.repo_id;
      nextSessionId = session.id;
    }

    const conflict = this.findByScopePath(nextScope, nextPath, nextRepoId, nextSessionId, id);
    if (conflict) {
      throw new Error(`An MD file named ${nextPath} already exists in the target scope`);
    }

    this.db
      .prepare("UPDATE md_files SET scope = ?, repo_id = ?, session_id = ?, path = ?, type = ?, content = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nextScope, nextRepoId, nextSessionId, nextPath, nextType, nextContent, id);

    if (nextScope === 'repo' && nextRepoId !== null && (existing.scope !== 'repo' || existing.repo_id !== nextRepoId)) {
      this.db.prepare('DELETE FROM repo_md_refs WHERE md_file_id = ? AND repo_id <> ?').run(id, nextRepoId);
      this.db.prepare(`
        DELETE FROM session_md_refs
        WHERE md_file_id = ?
          AND session_id IN (SELECT id FROM sessions WHERE repo_id <> ?)
      `).run(id, nextRepoId);
    }

    if (nextScope === 'session' && nextSessionId !== null) {
      this.db.prepare('DELETE FROM repo_md_refs WHERE md_file_id = ?').run(id);
      this.db.prepare('DELETE FROM session_md_refs WHERE md_file_id = ? AND session_id <> ?').run(id, nextSessionId);
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
      .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
      .get(id) as MdFile;
  }

  create(
    scope: 'central' | 'repo' | 'session',
    repoPath: string | null,
    filename: string,
    content: string,
    type?: MdFile['type'],
    sessionId?: number | null,
  ): MdFile {
    const safeName = sanitizeFilename(filename.endsWith('.md') ? filename : `${filename}.md`);
    const inferredType = type ?? inferType(safeName);

    if (scope === 'repo' && !repoPath) {
      throw new Error('repoPath is required for repo-scoped files');
    }

    if (scope === 'session' && sessionId == null) {
      throw new Error('sessionId is required for session-scoped files');
    }

    const session = scope === 'session' && sessionId != null ? this.getSession(sessionId) : null;
    const repoId = scope === 'repo' && repoPath
      ? this.getRepoIdByPath(repoPath)
      : scope === 'session'
        ? session?.repo_id ?? null
        : null;
    return this.persist(scope, repoId, session?.id ?? null, safeName, content, inferredType);
  }

  importDiscoveredRepoFiles(repoId: number, files: readonly DiscoveredRepoMdFile[]): MdFile[] {
    const importFiles = this.db.transaction((rows: readonly DiscoveredRepoMdFile[]) => {
      return rows.map((row) => this.persistDiscoveredRepoFile(repoId, row.path, row.content, row.type));
    });

    return importFiles(files);
  }

  importDiscoveredSessionFiles(
    sessionId: number,
    files: readonly { path: string; content: string; type: MdFile['type'] }[],
  ): MdFile[] {
    const session = this.getSession(sessionId);
    const importFiles = this.db.transaction((rows: readonly { path: string; content: string; type: MdFile['type'] }[]) => {
      return rows.map((row) => this.persist('session', session.repo_id, session.id, normalizeRepoStoredPath(row.path), row.content, row.type));
    });

    return importFiles(files);
  }

  pruneMissingRepoAgentFiles(repoId: number, currentAgentPaths: ReadonlySet<string>): boolean {
    const rows = this.db
      .prepare("SELECT id,path FROM md_files WHERE scope = 'repo' AND repo_id = ? AND (path LIKE ? OR path LIKE ?)")
      .all(repoId, `${AGENT_MD_DIR}/%`, '.agents/%') as { id: number; path: string }[];
    const currentAgentKeys = new Set(
      [...currentAgentPaths]
        .map((path) => toCanonicalAgentPath(path))
        .filter((path): path is string => path !== null),
    );
    const missing = rows.filter((row) => {
      const currentKey = toCanonicalAgentPath(row.path);
      return currentKey !== null && !currentAgentKeys.has(currentKey);
    });
    if (missing.length === 0) return false;

    const remove = this.db.transaction((ids: readonly number[]) => {
      const stmt = this.db.prepare('DELETE FROM md_files WHERE id = ?');
      for (const id of ids) stmt.run(id);
    });
    remove(missing.map((row) => row.id));
    return true;
  }

  pruneMissingSessionFiles(sessionId: number, currentPaths: ReadonlySet<string>): boolean {
    const rows = this.db
      .prepare("SELECT id,path FROM md_files WHERE scope = 'session' AND session_id = ?")
      .all(sessionId) as { id: number; path: string }[];
    const currentKeys = new Set([...currentPaths].map((path) => normalizeRepoStoredPath(path)));
    const missing = rows.filter((row) => !currentKeys.has(normalizeRepoStoredPath(row.path)));
    if (missing.length === 0) return false;

    const remove = this.db.transaction((ids: readonly number[]) => {
      const stmt = this.db.prepare('DELETE FROM md_files WHERE id = ?');
      for (const id of ids) stmt.run(id);
    });
    remove(missing.map((row) => row.id));
    return true;
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

  recordRevision(id: number, content: string, authorSource: string | null = null): MdFileRevision {
    this.getRow(id);
    const row = this.db
      .prepare('SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision_number FROM md_file_revisions WHERE md_file_id = ?')
      .get(id) as { next_revision_number: number };
    const result = this.db
      .prepare('INSERT INTO md_file_revisions (md_file_id, revision_number, content, author_source) VALUES (?, ?, ?, ?)')
      .run(id, row.next_revision_number, content, authorSource);
    return this.db
      .prepare('SELECT * FROM md_file_revisions WHERE id = ?')
      .get(result.lastInsertRowid as number) as MdFileRevision;
  }

  listRevisions(id: number): MdFileRevision[] {
    this.getRow(id);
    return this.db
      .prepare('SELECT * FROM md_file_revisions WHERE md_file_id = ? ORDER BY revision_number DESC')
      .all(id) as MdFileRevision[];
  }

  readRevision(id: number, revisionId: number): MdFileRevision {
    this.getRow(id);
    const row = this.db
      .prepare('SELECT * FROM md_file_revisions WHERE md_file_id = ? AND id = ?')
      .get(id, revisionId) as MdFileRevision | undefined;
    if (!row) throw new Error(`MD file revision ${revisionId} not found for file ${id}`);
    return row;
  }

  restoreRevision(id: number, revisionId: number): MdFile {
    const revision = this.readRevision(id, revisionId);
    const existing = this.getRow(id);
    if (existing.content === revision.content) {
      return existing;
    }

    this.update(id, { content: revision.content });
    this.recordRevision(id, revision.content, 'restore');
    return this.db
      .prepare('SELECT id,scope,repo_id,session_id,path,type,created_at,updated_at FROM md_files WHERE id = ?')
      .get(id) as MdFile;
  }
}
