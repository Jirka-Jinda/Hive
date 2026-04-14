import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, basename } from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import { Config } from '../utils/config';
import { resolve } from 'node:path';

export interface MdFile {
  id: number;
  scope: 'central' | 'repo';
  repo_id: number | null;
  path: string;
  type: 'skill' | 'tool' | 'instruction' | 'other';
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
  private centralDir: string;
  private readonly repoWatchers = new Map<number, FSWatcher>();
  private readonly centralWatcher: FSWatcher;

  constructor(private db: Database.Database) {
    this.centralDir = resolve(Config.DATA_DIR, 'central');
    mkdirSync(this.centralDir, { recursive: true });
    this.centralWatcher = this.createWatcher(this.centralDir, 'central', null);
  }

  private upsert(scope: 'central' | 'repo', filePath: string, repoId: number | null): void {
    const type = inferType(basename(filePath));
    this.db
      .prepare(`
        INSERT INTO md_files (scope, repo_id, path, type) VALUES (?, ?, ?, ?)
        ON CONFLICT(scope, path) DO UPDATE SET updated_at = datetime('now'), type = excluded.type
      `)
      .run(scope, repoId, filePath, type);
  }

  private createWatcher(dir: string, scope: 'central' | 'repo', repoId: number | null): FSWatcher {
    return chokidar
      .watch(dir, { ignoreInitial: false, persistent: true, depth: 3 })
      .on('add', (p) => { if (extname(p) === '.md') this.upsert(scope, p, repoId); })
      .on('change', (p) => { if (extname(p) === '.md') this.upsert(scope, p, repoId); })
      .on('unlink', (p) => {
        this.db.prepare('DELETE FROM md_files WHERE path = ?').run(p);
      });
  }

  watchRepo(repoId: number, repoPath: string): void {
    if (this.repoWatchers.has(repoId)) return;
    const aiDir = join(repoPath, '.ai');
    const watcher = this.createWatcher(aiDir, 'repo', repoId);
    this.repoWatchers.set(repoId, watcher);
  }

  unwatchRepo(repoId: number): void {
    const watcher = this.repoWatchers.get(repoId);
    if (!watcher) return;
    void watcher.close();
    this.repoWatchers.delete(repoId);
  }

  list(scope?: string, repoId?: number): MdFile[] {
    if (scope && repoId !== undefined) {
      return this.db
        .prepare('SELECT * FROM md_files WHERE scope = ? AND repo_id = ? ORDER BY path')
        .all(scope, repoId) as MdFile[];
    }
    if (scope) {
      return this.db
        .prepare('SELECT * FROM md_files WHERE scope = ? ORDER BY path')
        .all(scope) as MdFile[];
    }
    return this.db.prepare('SELECT * FROM md_files ORDER BY scope, path').all() as MdFile[];
  }

  read(id: number): { file: MdFile; content: string } {
    const file = this.db.prepare('SELECT * FROM md_files WHERE id = ?').get(id) as MdFile | undefined;
    if (!file) throw new Error(`MD file ${id} not found`);
    const content = readFileSync(file.path, 'utf8');
    return { file, content };
  }

  write(id: number, content: string): MdFile {
    const file = this.db.prepare('SELECT * FROM md_files WHERE id = ?').get(id) as MdFile | undefined;
    if (!file) throw new Error(`MD file ${id} not found`);
    writeFileSync(file.path, content, 'utf8');
    this.db.prepare("UPDATE md_files SET updated_at = datetime('now') WHERE id = ?").run(id);
    return this.db.prepare('SELECT * FROM md_files WHERE id = ?').get(id) as MdFile;
  }

  create(
    scope: 'central' | 'repo',
    repoPath: string | null,
    filename: string,
    content: string,
    type: MdFile['type'] = 'other'
  ): MdFile {
    const safeName = sanitizeFilename(filename.endsWith('.md') ? filename : `${filename}.md`);
    if (scope === 'repo' && !repoPath) {
      throw new Error('repoPath is required for repo-scoped files');
    }
    const dir = scope === 'central' ? this.centralDir : join(repoPath!, '.ai');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, safeName);
    writeFileSync(filePath, content, 'utf8');
    const repoRow =
      scope === 'repo' && repoPath
        ? this.db.prepare('SELECT id FROM repos WHERE path = ?').get(repoPath) as { id: number } | undefined
        : undefined;
    const repoId = repoRow?.id ?? null;
    if (scope === 'repo' && repoId === null) {
      throw new Error(`Repo not found for path: ${repoPath}`);
    }
    this.db
      .prepare(`
        INSERT INTO md_files (scope, repo_id, path, type) VALUES (?, ?, ?, ?)
        ON CONFLICT(scope, path) DO UPDATE SET updated_at = datetime('now'), type = excluded.type
      `)
      .run(scope, repoId, filePath, type);
    return this.db.prepare('SELECT * FROM md_files WHERE path = ?').get(filePath) as MdFile;
  }

  delete(id: number): void {
    const file = this.db.prepare('SELECT * FROM md_files WHERE id = ?').get(id) as MdFile | undefined;
    if (!file) throw new Error(`MD file ${id} not found`);
    if (existsSync(file.path)) unlinkSync(file.path);
    this.db.prepare('DELETE FROM md_files WHERE id = ?').run(id);
  }
}
