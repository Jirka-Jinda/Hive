import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import simpleGit from 'simple-git';
import type Database from 'better-sqlite3';
import { Config } from '../utils/config';
import type { SettingsService } from './settings-service';

export interface Repo {
  id: number;
  name: string;
  path: string;
  source: 'local' | 'git';
  git_url: string | null;
  created_at: string;
  is_git_repo: boolean;
}

interface RepoRow {
  id: number;
  name: string;
  path: string;
  source: 'local' | 'git';
  git_url: string | null;
  created_at: string;
}

export class RepoManager {
  constructor(
    private db: Database.Database,
    private readonly settings: SettingsService,
  ) {}

  private toRepo(row: RepoRow): Repo {
    return {
      ...row,
      is_git_repo: existsSync(resolve(row.path, '.git')),
    };
  }

  list(): Repo[] {
    const rows = this.db.prepare('SELECT * FROM repos ORDER BY created_at DESC').all() as RepoRow[];
    return rows.map((row) => this.toRepo(row));
  }

  get(id: number): Repo {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow | undefined;
    if (!row) throw new Error(`Repo ${id} not found`);
    return this.toRepo(row);
  }

  rename(id: number, name: string): Repo {
    const nextName = name.trim();
    if (!nextName) throw new Error('Repo name is required');

    const result = this.db.prepare('UPDATE repos SET name = ? WHERE id = ?').run(nextName, id);
    if (result.changes === 0) throw new Error(`Repo ${id} not found`);

    return this.get(id);
  }

  async addLocal(repoPath: string, name?: string): Promise<Repo> {
    const absPath = resolve(repoPath);
    if (!existsSync(absPath)) throw new Error(`Path does not exist: ${absPath}`);
    if (!statSync(absPath).isDirectory()) {
      throw new Error(`Path is not a directory: ${absPath}`);
    }
    const repoName = name?.trim() || absPath.split(/[/\\]/).pop() || absPath;
    const result = this.db
      .prepare('INSERT INTO repos (name, path, source) VALUES (?, ?, ?)')
      .run(repoName, absPath, 'local');
    return this.get(result.lastInsertRowid as number);
  }

  async addGit(gitUrl: string, name?: string): Promise<Repo> {
    const baseName = name?.trim() || gitUrl.split('/').pop()?.replace(/\.git$/, '') || 'repo';
    const reposDir = resolve(this.settings.load().reposDir);
    mkdirSync(reposDir, { recursive: true });
    // Ensure unique clone directory
    let cloneDir = resolve(reposDir, baseName);
    let counter = 1;
    while (existsSync(cloneDir)) {
      cloneDir = resolve(reposDir, `${baseName}-${counter++}`);
    }
    const repoName = cloneDir.split(/[/\\]/).pop()!;
    await simpleGit().clone(gitUrl, cloneDir);
    const result = this.db
      .prepare('INSERT INTO repos (name, path, source, git_url) VALUES (?, ?, ?, ?)')
      .run(repoName, cloneDir, 'git', gitUrl);
    return this.get(result.lastInsertRowid as number);
  }

  /** Returns all subdirectories of reposDir that contain a .git folder. */
  discoverRepos(): { name: string; path: string }[] {
    const reposDir = resolve(this.settings.load().reposDir);
    if (!existsSync(reposDir)) return [];
    return readdirSync(reposDir)
      .map((entry) => ({ name: entry, path: resolve(reposDir, entry) }))
      .filter(
        ({ path }) =>
          statSync(path).isDirectory() && existsSync(resolve(path, '.git')),
      );
  }

  delete(id: number): void {
    const result = this.db.prepare('DELETE FROM repos WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`Repo ${id} not found`);
  }

  deleteFromDisk(id: number): void {
    const repo = this.get(id);
    this.delete(id);
    if (existsSync(repo.path)) {
      rmSync(repo.path, { recursive: true, force: true });
    }
  }
}
