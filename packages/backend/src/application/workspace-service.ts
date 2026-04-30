import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { AGENT_ADAPTERS } from '../services/agents';
import type { CredentialStore } from '../services/credential-store';
import type { MdFileManager } from '../services/mdfile-manager';
import { killProcessAndWait } from '../services/process-manager';
import { RepoManager } from '../services/repo-manager';
import type { GitHistoryEntry, GitWorktreeStatus, Repo } from '../services/repo-manager';
import { SessionStore } from '../services/session-store';
import type { Session, SessionBranchMode, SessionWithGitStatus } from '../services/session-store';
import type { SettingsService } from '../services/settings-service';
import { discoverRepoMdFiles } from '../utils/repo-md-discovery';
import type { MdFile } from '../services/mdfile-manager';
import type { LogService } from '../services/log-service';
import {
  AGENT_MD_DIR,
  ensureAgentDir,
  getAgentDir,
  normalizeMarkdownRelativePath,
  readAgentMarkdownFiles,
  toAgentRelativePath,
  toRepoAgentPath,
} from '../utils/agent-md-files';

export interface SessionBranchAvailability {
  name: string;
  in_use: boolean;
  worktree_path: string | null;
  is_main_worktree: boolean;
  session_id: number | null;
  session_name: string | null;
  disabled_reason: string | null;
}

export interface AgentMdWatchRoot {
  repoId: number;
  path: string;
}

export interface SessionAgentFile {
  agentRelativePath: string;
  repoRelativePath: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WorkspaceService {
  private readonly repoManager: RepoManager;
  private readonly sessionStore: SessionStore;
  private readonly credentialStore: CredentialStore;
  private readonly repoLocks = new Map<number, Promise<void>>();
  private readonly suppressedAgentMdWatchRoots = new Set<string>();
  private agentMdWatchRootsChanged?: () => void;

  constructor(
    db: Database.Database,
    private readonly mdFileManager: MdFileManager,
    private readonly settingsService: SettingsService,
    credentialStore?: CredentialStore,
    repoManager?: RepoManager,
    sessionStore?: SessionStore,
    private readonly logService?: LogService,
  ) {
    this.repoManager = repoManager ?? new RepoManager(db, settingsService);
    this.sessionStore = sessionStore ?? new SessionStore(db);
    this.credentialStore = credentialStore ?? (() => { throw new Error('CredentialStore is required'); })();
  }

  listRepos() {
    return this.repoManager.list();
  }

  setAgentMdWatchRootsChangedHandler(handler: (() => void) | null): void {
    this.agentMdWatchRootsChanged = handler ?? undefined;
  }

  listAgentMdWatchRoots(): AgentMdWatchRoot[] {
    const roots: AgentMdWatchRoot[] = [];
    for (const repo of this.repoManager.list()) {
      if (!this.suppressedAgentMdWatchRoots.has(this.normalizePath(repo.path))) {
        roots.push({ repoId: repo.id, path: repo.path });
      }
      for (const session of this.sessionStore.list(repo.id)) {
        if (session.worktree_path && !this.suppressedAgentMdWatchRoots.has(this.normalizePath(session.worktree_path))) {
          roots.push({ repoId: repo.id, path: session.worktree_path });
        }
      }
    }
    return roots;
  }

  discoverRepos() {
    return this.repoManager.discoverRepos();
  }

  getRepo(id: number) {
    return this.repoManager.get(id);
  }

  updateRepo(id: number, input: { name: string }) {
    this.repoManager.get(id);
    return this.repoManager.rename(id, input.name);
  }

  async createRepo(input: { path?: string; gitUrl?: string; name?: string }) {
    let repo;
    if (input.gitUrl) {
      repo = await this.repoManager.addGit(input.gitUrl, input.name);
    } else if (input.path) {
      repo = await this.repoManager.addLocal(input.path, input.name);
    } else {
      throw new Error('path or gitUrl is required');
    }

    this.mdFileManager.importDiscoveredRepoFiles(repo.id, discoverRepoMdFiles(repo.path));
    this.logService?.logUserAction('add_repo', `Added repo "${repo.name}" at ${repo.path}`);
    this.notifyAgentMdWatchRootsChanged();
    return repo;
  }

  /**
   * Re-discovers md files on disk for the given repo root and imports any
   * new/changed files into the DB. Session worktree files are NOT merged back
   * here — they are managed separately via promoteSessionAgentFile.
   * After updating the DB, syncs all repo agent files downstream to every
   * session worktree.
   */
  rediscoverRepoMdFiles(repoId: number): void {
    const repo = this.repoManager.get(repoId);

    const currentAgentPaths = new Set<string>();
    for (const file of readAgentMarkdownFiles(repo.path)) {
      currentAgentPaths.add(file.repoRelativePath);
    }

    const discovered = discoverRepoMdFiles(repo.path);
    const isAgentFile = (path: string) => path.toLowerCase().startsWith(`${AGENT_MD_DIR}/`);
    const nonAgentFiles = discovered.filter((file) => !isAgentFile(file.path));
    const agentFiles = discovered.filter((file) => isAgentFile(file.path));
    if (nonAgentFiles.length > 0) {
      this.mdFileManager.importDiscoveredRepoFiles(repoId, nonAgentFiles);
    }
    if (agentFiles.length > 0) {
      this.mdFileManager.importDiscoveredRepoFiles(repoId, agentFiles);
    }
    this.mdFileManager.pruneMissingRepoAgentFiles(repoId, currentAgentPaths);

    // Propagate changes downstream to all session worktrees.
    void this.syncRepoFilesToAllWorktrees(repoId);
  }

  deleteRepo(id: number, deleteFromDisk = false): Promise<void> {
    return this.withRepoLock(id, async () => {
      const repo = this.repoManager.get(id);
      const sessions = this.sessionStore.list(id);
      const releaseWatchRoots = await this.suppressAgentMdWatchRoots([
        repo.path,
        ...sessions.map((session) => session.worktree_path).filter((path): path is string => Boolean(path)),
      ]);
      let completed = false;

      try {
        for (const session of sessions) {
          await killProcessAndWait(session.id);
          if (repo.is_git_repo && session.worktree_path) {
            await this.repoManager.removeSessionWorktree(repo, session.worktree_path);
          }
        }
        if (deleteFromDisk) {
          this.repoManager.deleteFromDisk(id);
        } else {
          this.repoManager.delete(id);
        }
        this.mdFileManager.deleteRepoFiles(id);
        this.logService?.logUserAction('delete_repo', `Deleted repo "${repo.name}"`);
        completed = true;
        releaseWatchRoots();
        this.notifyAgentMdWatchRootsChanged();
      } finally {
        if (!completed) releaseWatchRoots();
      }
    });
  }

  async reconcileGitWorktrees(): Promise<void> {
    const repos = this.repoManager.list().filter((repo) => repo.is_git_repo);
    for (const repo of repos) {
      const worktreePaths = this.sessionStore
        .list(repo.id)
        .map((session) => session.worktree_path)
        .filter((worktreePath): worktreePath is string => Boolean(worktreePath));
      await this.withRepoLock(repo.id, () => this.repoManager.reconcileManagedWorktrees(repo, worktreePaths));
    }
  }

  async listSessions(repoId: number): Promise<SessionWithGitStatus[]> {
    const repo = this.repoManager.get(repoId);
    const sessions = this.sessionStore.list(repoId);
    return Promise.all(sessions.map((session) => this.toSessionView(session, repo)));
  }

  async updateSession(repoId: number, sessionId: number, input: { name: string }): Promise<SessionWithGitStatus> {
    const repo = this.repoManager.get(repoId);
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }

    return this.toSessionView(this.sessionStore.update(sessionId, { name: input.name }), repo);
  }

  restartSession(repoId: number, sessionId: number): Promise<SessionWithGitStatus> {
    return this.withRepoLock(repoId, async () => {
      const repo = this.repoManager.get(repoId);
      const session = this.sessionStore.get(sessionId);
      if (session.repo_id !== repoId) {
        throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
      }

      await killProcessAndWait(sessionId);
      this.sessionStore.clearLogs(sessionId);
      this.sessionStore.setStatus(sessionId, 'stopped');
      this.sessionStore.setState(sessionId, 'stopped');
      return this.toSessionView(this.sessionStore.get(sessionId), repo);
    });
  }

  createSession(input: {
    repoId: number;
    name: string;
    agentType: string;
    credentialId?: number;
    branchMode?: SessionBranchMode;
    branchName?: string;
  }): Promise<SessionWithGitStatus> {
    return this.withRepoLock(input.repoId, async () => {
      const repo = this.repoManager.get(input.repoId);

      if (!AGENT_ADAPTERS[input.agentType]) {
        throw new Error(`Unknown agent type: ${input.agentType}`);
      }

      if (input.credentialId !== undefined) {
        const credential = this.credentialStore.get(input.credentialId);
        if (credential.agent_type !== input.agentType) {
          throw new Error('Credential profile does not match the selected agent');
        }
      }

      let branchMode: SessionBranchMode | null = null;
      let initialBranchName: string | null = null;

      if (repo.is_git_repo) {
        if (!input.branchMode) {
          throw new Error('branchMode is required for git repositories');
        }
        branchMode = input.branchMode;
        if (branchMode !== 'root') {
          if (!input.branchName?.trim()) {
            throw new Error('branchMode and branchName are required for git repositories');
          }
          initialBranchName = await this.repoManager.validateBranchName(repo, input.branchName);
        }
      }

      const session = this.sessionStore.create({
        repoId: input.repoId,
        agentType: input.agentType,
        name: input.name.trim(),
        credentialId: input.credentialId,
        branchMode,
        initialBranchName,
      });
      let createdWorktreePath: string | null = null;

      try {
        if (repo.is_git_repo && branchMode && branchMode !== 'root' && initialBranchName) {
          createdWorktreePath = await this.repoManager.createSessionWorktree(
            repo,
            session.id,
            branchMode,
            initialBranchName,
          );
          this.syncRepoFilesToWorktree(repo.id, createdWorktreePath);
          const updated = this.sessionStore.updateGitMetadata(session.id, { worktreePath: createdWorktreePath });
          this.logService?.logUserAction(
            'create_session',
            `Created session "${session.name}" (${input.agentType}) in repo "${repo.name}" on branch "${initialBranchName}"`,
          );
          this.notifyAgentMdWatchRootsChanged();
          return this.toSessionView(updated, repo);
        }

        this.logService?.logUserAction(
          'create_session',
          `Created session "${session.name}" (${input.agentType}) in repo "${repo.name}"${branchMode === 'root' ? ' on the repo root' : ''}`,
        );
        this.notifyAgentMdWatchRootsChanged();
        return this.toSessionView(session, repo);
      } catch (error) {
        if (createdWorktreePath) {
          try {
            await this.repoManager.removeSessionWorktree(repo, createdWorktreePath);
          } catch {
            // Best effort cleanup before removing the dangling session row.
          }
        }
        this.sessionStore.delete(session.id);
        throw error;
      }
    });
  }

  deleteSession(repoId: number, sessionId: number): Promise<void> {
    return this.withRepoLock(repoId, async () => {
      const repo = this.repoManager.get(repoId);
      const session = this.sessionStore.get(sessionId);
      if (session.repo_id !== repoId) {
        throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
      }

      const releaseWatchRoots = await this.suppressAgentMdWatchRoots(
        session.worktree_path ? [session.worktree_path] : [],
      );
      let completed = false;

      try {
        await killProcessAndWait(sessionId);
        if (repo.is_git_repo && session.worktree_path) {
          await this.repoManager.removeSessionWorktree(repo, session.worktree_path);
        }
        this.sessionStore.delete(sessionId);
        this.logService?.logUserAction(
          'delete_session',
          `Deleted session "${session.name}" from repo "${repo.name}"`,
        );
        completed = true;
        releaseWatchRoots();
        this.notifyAgentMdWatchRootsChanged();
      } finally {
        if (!completed) releaseWatchRoots();
      }
    });
  }

  async listGitBranches(repoId: number, query?: string): Promise<SessionBranchAvailability[]> {
    const repo = this.repoManager.get(repoId);
    if (!repo.is_git_repo) return [];

    const [branches, occupancy, sessions] = await Promise.all([
      this.repoManager.listLocalBranches(repo, query),
      this.repoManager.listBranchOccupancy(repo),
      this.listSessions(repoId),
    ]);

    const sessionsByWorktree = new Map<string, SessionWithGitStatus>();
    for (const session of sessions) {
      if (!session.worktree_path) continue;
      sessionsByWorktree.set(this.normalizePath(session.worktree_path), session);
    }

    return branches.map((branch) => {
      const usage = occupancy.get(branch);
      const session = usage?.worktree_path
        ? sessionsByWorktree.get(this.normalizePath(usage.worktree_path)) ?? null
        : null;
      const disabledReason = !usage
        ? null
        : usage.is_main_worktree
          ? 'Checked out in the repo root worktree'
          : session
            ? `Already in use by session ${session.name}`
            : 'Already checked out in another worktree';

      return {
        name: branch,
        in_use: Boolean(usage),
        worktree_path: usage?.worktree_path ?? null,
        is_main_worktree: usage?.is_main_worktree ?? false,
        session_id: session?.id ?? null,
        session_name: session?.name ?? null,
        disabled_reason: disabledReason,
      } satisfies SessionBranchAvailability;
    });
  }

  async getGitStatus(repoId: number, sessionId?: number): Promise<GitWorktreeStatus | null> {
    const repo = this.repoManager.get(repoId);
    if (!repo.is_git_repo) return null;

    const session = sessionId ? this.getSessionForRepo(repoId, sessionId) : null;
    return this.repoManager.getGitStatus(repo, session?.worktree_path ?? null);
  }

  async getGitHistory(repoId: number, sessionId?: number, limit?: number): Promise<GitHistoryEntry[]> {
    const repo = this.repoManager.get(repoId);
    if (!repo.is_git_repo) return [];

    const session = sessionId ? this.getSessionForRepo(repoId, sessionId) : null;
    return this.repoManager.getHistory(repo, session?.worktree_path ?? null, limit ?? 40);
  }

  private normalizePath(path: string): string {
    const normalized = resolve(path);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private notifyAgentMdWatchRootsChanged(): void {
    this.agentMdWatchRootsChanged?.();
  }

  private async suppressAgentMdWatchRoots(paths: readonly string[]): Promise<() => void> {
    const normalizedPaths = paths.map((path) => this.normalizePath(path));
    if (normalizedPaths.length === 0) return () => {};

    for (const path of normalizedPaths) {
      this.suppressedAgentMdWatchRoots.add(path);
    }
    this.notifyAgentMdWatchRootsChanged();
    await sleep(100);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const path of normalizedPaths) {
        this.suppressedAgentMdWatchRoots.delete(path);
      }
      this.notifyAgentMdWatchRootsChanged();
    };
  }

  /**
   * Lists `.agent/` files in a session's worktree that are NOT tracked as
   * repo-scoped MD files. These are files created by the agent during the
   * session and can be promoted to the repo via promoteSessionAgentFile.
   */
  listSessionAgentFiles(repoId: number, sessionId: number): SessionAgentFile[] {
    const session = this.getSessionForRepo(repoId, sessionId);
    if (!session.worktree_path) return [];

    const worktreeFiles = readAgentMarkdownFiles(session.worktree_path);
    if (worktreeFiles.length === 0) return [];

    const repoAgentPaths = new Set<string>(
      this.mdFileManager.list('repo', repoId).map((f) => {
        try { return toAgentRelativePath(f.path).toLowerCase(); } catch { return null; }
      }).filter((p): p is string => p !== null),
    );

    return worktreeFiles
      .filter((f) => !repoAgentPaths.has(f.agentRelativePath.toLowerCase()))
      .map(({ agentRelativePath, repoRelativePath }) => ({ agentRelativePath, repoRelativePath }));
  }

  /**
   * Promotes a session agent file to a repo-scoped MD file. The file is
   * written to the repo root `.agent/` directory (for persistence) and added
   * to the DB. The worktree copy is left untouched. No immediate downstream
   * sync is triggered — the file will be pushed to other worktrees on the
   * next natural sync event.
   */
  async promoteSessionAgentFile(repoId: number, sessionId: number, agentRelativePath: string): Promise<MdFile> {
    const session = this.getSessionForRepo(repoId, sessionId);
    if (!session.worktree_path) throw new Error('Session has no worktree');

    const normalized = normalizeMarkdownRelativePath(agentRelativePath);
    const worktreeAgentDir = getAgentDir(session.worktree_path);
    const fullPath = resolve(worktreeAgentDir, normalized);

    // Security: ensure resolved path stays within the .agent dir.
    const rel = relative(worktreeAgentDir, fullPath);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Invalid agent file path');
    }

    if (!existsSync(fullPath)) throw new Error(`Session file not found: ${agentRelativePath}`);
    const content = readFileSync(fullPath, 'utf8');
    const repoPath = toRepoAgentPath(normalized);

    const filename = normalized.split('/').pop()!.toLowerCase();
    let type: MdFile['type'] = 'other';
    if (filename.includes('skill')) type = 'skill';
    else if (filename.includes('tool')) type = 'tool';
    else if (filename.includes('prompt')) type = 'prompt';
    else if (filename.includes('instruction') || filename.includes('copilot') || filename.includes('agent')) type = 'instruction';

    const repo = this.repoManager.get(repoId);

    // Write to repo root .agent/ so the file survives rediscovery cycles.
    // Suppress the repo-root watcher so this write does not immediately
    // trigger a downstream sync to all worktrees.
    const releaseWatch = await this.suppressAgentMdWatchRoots([repo.path]);
    try {
      const repoAgentDir = ensureAgentDir(repo.path);
      const repoTargetPath = resolve(repoAgentDir, normalized);
      mkdirSync(dirname(repoTargetPath), { recursive: true });
      writeFileSync(repoTargetPath, content, 'utf8');

      const results = this.mdFileManager.importDiscoveredRepoFiles(repoId, [{ path: repoPath, content, type }]);
      return results[0]!;
    } finally {
      releaseWatch();
    }
  }

  /**
   * Syncs all repo-scoped MD files downstream to all session worktrees.
   * Suppresses worktree watch roots during the write to avoid re-entrant
   * discovery cycles.
   */
  async syncRepoFilesToAllWorktrees(repoId: number): Promise<void> {
    const sessions = this.sessionStore.list(repoId);
    const worktreePaths = sessions
      .map((s) => s.worktree_path)
      .filter((p): p is string => Boolean(p))
      .filter((p) => this.normalizePath(p) !== this.normalizePath(this.repoManager.get(repoId).path));

    if (worktreePaths.length === 0) return;

    const releaseWatch = await this.suppressAgentMdWatchRoots(worktreePaths);
    try {
      for (const worktreePath of worktreePaths) {
        this.syncRepoFilesToWorktree(repoId, worktreePath);
      }
    } finally {
      releaseWatch();
    }
  }

  /**
   * Deletes a repo-scoped MD file from all session worktrees. Called when
   * a repo file is deleted via the API so worktrees stay in sync.
   */
  deleteRepoFileFromAllWorktrees(repoId: number, filePath: string): void {
    let agentRelativePath: string;
    try {
      agentRelativePath = toAgentRelativePath(filePath);
    } catch {
      return;
    }

    const sessions = this.sessionStore.list(repoId);
    for (const session of sessions) {
      if (!session.worktree_path) continue;
      if (this.normalizePath(session.worktree_path) === this.normalizePath(this.repoManager.get(repoId).path)) continue;
      try {
        const targetPath = resolve(getAgentDir(session.worktree_path), agentRelativePath);
        if (existsSync(targetPath)) unlinkSync(targetPath);
      } catch (error) {
        console.warn('[WorkspaceService] Failed to delete repo file from worktree', {
          repoId, worktreePath: session.worktree_path, filePath, error,
        });
      }
    }
  }

  private syncRepoFilesToWorktree(repoId: number, worktreePath: string): void {
    const files = this.mdFileManager.list('repo', repoId);
    if (files.length === 0) return;

    let agentDir: string;
    try {
      agentDir = ensureAgentDir(worktreePath);
    } catch (error) {
      console.warn('[WorkspaceService] Failed to create worktree .agent directory', { worktreePath, error });
      return;
    }

    const writtenTargets = new Set<string>();
    for (const file of files) {
      try {
        const agentRelativePath = toAgentRelativePath(file.path);
        const targetPath = resolve(agentDir, agentRelativePath);
        const targetKey = this.normalizePath(targetPath);
        if (writtenTargets.has(targetKey)) continue;
        const { content } = this.mdFileManager.read(file.id);
        mkdirSync(dirname(targetPath), { recursive: true });
        if (!existsSync(targetPath) || readFileSync(targetPath, 'utf8') !== content) {
          writeFileSync(targetPath, content, 'utf8');
        }
        writtenTargets.add(targetKey);
      } catch (error) {
        console.warn('[WorkspaceService] Failed to sync repo md file to worktree .agent', {
          repoId, worktreePath, path: file.path, error,
        });
      }
    }
  }

  private getSessionForRepo(repoId: number, sessionId: number): Session {
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }
    return session;
  }

  private async toSessionView(session: Session, repo?: Repo): Promise<SessionWithGitStatus> {
    const currentRepo = repo ?? this.repoManager.get(session.repo_id);
    const base: SessionWithGitStatus = {
      ...session,
      current_branch: null,
      head_ref: null,
      is_detached: false,
    };

    if (!currentRepo.is_git_repo) {
      return base;
    }

    try {
      const status = await this.repoManager.getGitStatus(currentRepo, session.worktree_path ?? null);
      return {
        ...base,
        current_branch: status.branch,
        head_ref: status.head_ref,
        is_detached: status.is_detached,
      };
    } catch (error) {
      if (session.worktree_path) {
        console.warn('[WorkspaceService] Failed to resolve git status for session worktree', {
          sessionId: session.id,
          worktreePath: session.worktree_path,
          error,
        });
      }

      return {
        ...base,
        current_branch: session.initial_branch_name,
        head_ref: session.initial_branch_name,
      };
    }
  }

  private async withRepoLock<T>(repoId: number, task: () => Promise<T> | T): Promise<T> {
    const previous = this.repoLocks.get(repoId) ?? Promise.resolve();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => pending);
    this.repoLocks.set(repoId, next);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.repoLocks.get(repoId) === next) {
        this.repoLocks.delete(repoId);
      }
    }
  }
}
