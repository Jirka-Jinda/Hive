import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import simpleGit from 'simple-git';
import type Database from 'better-sqlite3';
import { Config } from '../utils/config';
import type { SettingsService } from './settings-service';
import type { SessionBranchMode } from './session-store';

export interface Repo {
  id: number;
  name: string;
  path: string;
  source: 'local' | 'git';
  git_url: string | null;
  created_at: string;
  session_count: number;
  is_git_repo: boolean;
}

export interface GitWorktreeStatus {
  branch: string | null;
  head_ref: string | null;
  is_detached: boolean;
  worktree_path: string;
  repo_path: string;
}

export interface GitHistoryEntry {
  hash: string;
  short_hash: string;
  subject: string;
  author_name: string;
  authored_at: string;
  refs: string[];
}

export interface GitBranchOccupancy {
  name: string;
  in_use: boolean;
  worktree_path: string | null;
  is_main_worktree: boolean;
}

interface RepoRow {
  id: number;
  name: string;
  path: string;
  source: 'local' | 'git';
  git_url: string | null;
  created_at: string;
  session_count: number;
}

interface GitWorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
  isMainWorktree: boolean;
  isDetached: boolean;
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

  private normalizePath(path: string): string {
    const normalized = resolve(path);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private ensureGitRepo(repo: Repo): void {
    if (!repo.is_git_repo) {
      throw new Error(`Repo ${repo.id} is not a git repository`);
    }
  }

  private getManagedWorktreeRoot(repoId: number): string {
    // Keep managed worktree paths short enough for deep Windows repos.
    return resolve(Config.DATA_DIR, 'wt', String(repoId));
  }

  private getLegacyManagedWorktreeRoot(repoId: number): string {
    return resolve(Config.DATA_DIR, 'worktrees', String(repoId));
  }

  private getManagedWorktreeRoots(repoId: number): string[] {
    return [this.getManagedWorktreeRoot(repoId), this.getLegacyManagedWorktreeRoot(repoId)];
  }

  private buildManagedWorktreePath(repoId: number, sessionId: number): string {
    return resolve(this.getManagedWorktreeRoot(repoId), String(sessionId));
  }

  private parseWorktreeList(output: string, repoPath: string): GitWorktreeInfo[] {
    const blocks = output
      .trim()
      .split(/\r?\n\r?\n/)
      .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
      .filter((block) => block.length > 0);

    return blocks
      .map((block) => {
        const info: GitWorktreeInfo = {
          path: '',
          branch: null,
          head: null,
          isMainWorktree: false,
          isDetached: false,
        };

        for (const line of block) {
          if (line.startsWith('worktree ')) {
            info.path = line.slice('worktree '.length).trim();
            continue;
          }
          if (line.startsWith('HEAD ')) {
            info.head = line.slice('HEAD '.length).trim();
            continue;
          }
          if (line.startsWith('branch ')) {
            const branchRef = line.slice('branch '.length).trim();
            info.branch = branchRef.replace(/^refs\/heads\//, '');
            continue;
          }
          if (line === 'detached') {
            info.isDetached = true;
          }
        }

        info.isMainWorktree = this.normalizePath(info.path) === this.normalizePath(repoPath);
        return info;
      })
      .filter((info) => info.path);
  }

  async validateBranchName(repo: Repo, branchName: string): Promise<string> {
    this.ensureGitRepo(repo);
    const trimmed = branchName.trim();
    if (!trimmed) {
      throw new Error('Branch name is required');
    }

    try {
      await simpleGit(repo.path).raw(['check-ref-format', '--branch', trimmed]);
    } catch {
      throw new Error(`Invalid branch name: ${trimmed}`);
    }

    return trimmed;
  }

  async listLocalBranches(repo: Repo, query?: string): Promise<string[]> {
    this.ensureGitRepo(repo);
    const summary = await simpleGit(repo.path).branchLocal();
    const needle = query?.trim().toLowerCase() ?? '';

    return summary.all
      .filter((branch) => !needle || branch.toLowerCase().includes(needle))
      .sort((left, right) => left.localeCompare(right));
  }

  async listWorktrees(repo: Repo): Promise<GitWorktreeInfo[]> {
    this.ensureGitRepo(repo);
    const output = await simpleGit(repo.path).raw(['worktree', 'list', '--porcelain']);
    return this.parseWorktreeList(output, repo.path);
  }

  async listBranchOccupancy(repo: Repo): Promise<Map<string, GitBranchOccupancy>> {
    const occupancy = new Map<string, GitBranchOccupancy>();
    const worktrees = await this.listWorktrees(repo);
    for (const worktree of worktrees) {
      if (!worktree.branch) continue;
      occupancy.set(worktree.branch, {
        name: worktree.branch,
        in_use: true,
        worktree_path: resolve(worktree.path),
        is_main_worktree: worktree.isMainWorktree,
      });
    }
    return occupancy;
  }

  async createSessionWorktree(
    repo: Repo,
    sessionId: number,
    branchMode: SessionBranchMode,
    branchName: string,
  ): Promise<string> {
    this.ensureGitRepo(repo);
    const normalizedBranch = await this.validateBranchName(repo, branchName);
    const git = simpleGit(repo.path);

    await git.raw(['worktree', 'prune']);

    const localBranches = await git.branchLocal();
    const branchExists = localBranches.all.includes(normalizedBranch);
    const occupancy = await this.listBranchOccupancy(repo);
    const branchInUse = occupancy.get(normalizedBranch);

    if (branchMode === 'new' && branchExists) {
      throw new Error(`Branch \"${normalizedBranch}\" already exists`);
    }
    if (branchMode === 'existing' && !branchExists) {
      throw new Error(`Branch \"${normalizedBranch}\" does not exist locally`);
    }
    if (branchInUse) {
      throw new Error(`Branch \"${normalizedBranch}\" is already checked out in ${branchInUse.worktree_path}`);
    }

    const worktreePath = this.buildManagedWorktreePath(repo.id, sessionId);
    mkdirSync(dirname(worktreePath), { recursive: true });
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }

    try {
      if (branchMode === 'new') {
        await git.raw(['worktree', 'add', '-b', normalizedBranch, worktreePath, 'HEAD']);
      } else {
        await git.raw(['worktree', 'add', worktreePath, normalizedBranch]);
      }
    } catch (error) {
      try {
        await git.raw(['worktree', 'remove', '--force', worktreePath]);
      } catch {
        if (existsSync(worktreePath)) {
          rmSync(worktreePath, { recursive: true, force: true });
        }
      }

      if (branchMode === 'new' && !branchExists) {
        try {
          await git.raw(['branch', '-D', normalizedBranch]);
        } catch {
          // Best effort rollback only.
        }
      }

      try {
        await git.raw(['worktree', 'prune']);
      } catch {
        // Best effort cleanup only.
      }

      throw error;
    }

    return resolve(worktreePath);
  }

  async removeSessionWorktree(repo: Repo, worktreePath: string | null): Promise<void> {
    this.ensureGitRepo(repo);
    if (!worktreePath) return;

    const resolvedPath = resolve(worktreePath);
    const git = simpleGit(repo.path);

    try {
      await git.raw(['worktree', 'remove', '--force', resolvedPath]);
    } catch {
      if (existsSync(resolvedPath)) {
        rmSync(resolvedPath, { recursive: true, force: true });
      }
    }

    try {
      await git.raw(['worktree', 'prune']);
    } catch {
      // Best effort cleanup only.
    }
  }

  async reconcileManagedWorktrees(repo: Repo, activeWorktreePaths: string[]): Promise<void> {
    this.ensureGitRepo(repo);
    const managedRoots = this.getManagedWorktreeRoots(repo.id).filter((managedRoot, index, roots) => {
      return roots.indexOf(managedRoot) === index && existsSync(managedRoot);
    });
    if (managedRoots.length === 0) return;

    const active = new Set(activeWorktreePaths.map((path) => this.normalizePath(path)));
    const git = simpleGit(repo.path);

    try {
      await git.raw(['worktree', 'prune']);
    } catch {
      // Best effort cleanup only.
    }

    for (const managedRoot of managedRoots) {
      for (const entry of readdirSync(managedRoot)) {
        const fullPath = resolve(managedRoot, entry);
        if (!statSync(fullPath).isDirectory()) continue;
        if (active.has(this.normalizePath(fullPath))) continue;
        await this.removeSessionWorktree(repo, fullPath);
      }
    }
  }

  resolveWorkingDirectory(repo: Repo, worktreePath?: string | null): string {
    return worktreePath ? resolve(worktreePath) : repo.path;
  }

  async getGitStatus(repo: Repo, worktreePath?: string | null): Promise<GitWorktreeStatus> {
    this.ensureGitRepo(repo);
    const targetPath = this.resolveWorkingDirectory(repo, worktreePath);
    if (!existsSync(targetPath)) {
      throw new Error(`Git worktree path does not exist: ${targetPath}`);
    }

    const git = simpleGit(targetPath);
    const branch = (await git.raw(['branch', '--show-current'])).trim();
    const headRef = branch || (await git.revparse(['--short', 'HEAD'])).trim();

    return {
      branch: branch || null,
      head_ref: headRef || null,
      is_detached: branch.length === 0,
      worktree_path: targetPath,
      repo_path: repo.path,
    };
  }

  async getHistory(repo: Repo, worktreePath?: string | null, limit = 40): Promise<GitHistoryEntry[]> {
    this.ensureGitRepo(repo);
    const targetPath = this.resolveWorkingDirectory(repo, worktreePath);
    if (!existsSync(targetPath)) {
      throw new Error(`Git worktree path does not exist: ${targetPath}`);
    }

    const git = simpleGit(targetPath);
    const safeLimit = String(Math.max(1, Math.min(limit ?? 40, 100)));
    const format = ['%H', '%h', '%an', '%aI', '%s', '%D'].join('%x1f') + '%x1e';
    const output = await git.raw(['log', `--max-count=${safeLimit}`, `--pretty=format:${format}`]);

    return output
      .split('\x1e')
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const [hash, shortHash, authorName, authoredAt, subject, refs] = row.split('\x1f');
        return {
          hash,
          short_hash: shortHash,
          author_name: authorName,
          authored_at: authoredAt,
          subject,
          refs: (refs ?? '')
            .split(',')
            .map((ref) => ref.trim())
            .filter(Boolean),
        } satisfies GitHistoryEntry;
      });
  }

  list(): Repo[] {
    const rows = this.db.prepare(`
      SELECT
        repos.*,
        (SELECT COUNT(*) FROM sessions WHERE sessions.repo_id = repos.id) AS session_count
      FROM repos
      ORDER BY created_at DESC
    `).all() as RepoRow[];
    return rows.map((row) => this.toRepo(row));
  }

  get(id: number): Repo {
    const row = this.db.prepare(`
      SELECT
        repos.*,
        (SELECT COUNT(*) FROM sessions WHERE sessions.repo_id = repos.id) AS session_count
      FROM repos
      WHERE id = ?
    `).get(id) as RepoRow | undefined;
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
