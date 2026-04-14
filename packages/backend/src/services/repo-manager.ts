import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
}

export class RepoManager {
  constructor(
    private db: Database.Database,
    private readonly settings: SettingsService,
  ) {}

  list(): Repo[] {
    return this.db.prepare('SELECT * FROM repos ORDER BY created_at DESC').all() as Repo[];
  }

  get(id: number): Repo {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as Repo | undefined;
    if (!row) throw new Error(`Repo ${id} not found`);
    return row;
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
    const repoName = name?.trim() || gitUrl.split('/').pop()?.replace(/\.git$/, '') || 'repo';
    const reposDir = resolve(this.settings.load().reposDir);
    mkdirSync(reposDir, { recursive: true });
    const cloneDir = resolve(reposDir, repoName);
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
}
