import type Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { AGENT_ADAPTERS } from '../services/agents';
import type { CredentialStore } from '../services/credential-store';
import type { MdFileManager } from '../services/mdfile-manager';
import { killProcess } from '../services/process-manager';
import { RepoManager } from '../services/repo-manager';
import type { GitHistoryEntry, GitWorktreeStatus, Repo } from '../services/repo-manager';
import { SessionStore } from '../services/session-store';
import type { Session, SessionBranchMode, SessionWithGitStatus } from '../services/session-store';
import type { SettingsService } from '../services/settings-service';
import { discoverRepoMdFiles } from '../utils/repo-md-discovery';
import type { LogService } from '../services/log-service';

export interface SessionBranchAvailability {
  name: string;
  in_use: boolean;
  worktree_path: string | null;
  is_main_worktree: boolean;
  session_id: number | null;
  session_name: string | null;
  disabled_reason: string | null;
}

export class WorkspaceService {
  private readonly repoManager: RepoManager;
  private readonly sessionStore: SessionStore;
  private readonly credentialStore: CredentialStore;
  private readonly repoLocks = new Map<number, Promise<void>>();

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
    return repo;
  }

  deleteRepo(id: number, deleteFromDisk = false): Promise<void> {
    return this.withRepoLock(id, async () => {
      const repo = this.repoManager.get(id);
      const sessions = this.sessionStore.list(id);
      for (const session of sessions) {
        killProcess(session.id);
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

      killProcess(sessionId);
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
        if (!input.branchMode || !input.branchName?.trim()) {
          throw new Error('branchMode and branchName are required for git repositories');
        }
        branchMode = input.branchMode;
        initialBranchName = await this.repoManager.validateBranchName(repo, input.branchName);
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
        if (repo.is_git_repo && branchMode && initialBranchName) {
          createdWorktreePath = await this.repoManager.createSessionWorktree(
            repo,
            session.id,
            branchMode,
            initialBranchName,
          );
          const updated = this.sessionStore.updateGitMetadata(session.id, { worktreePath: createdWorktreePath });
          this.logService?.logUserAction(
            'create_session',
            `Created session "${session.name}" (${input.agentType}) in repo "${repo.name}" on branch "${initialBranchName}"`,
          );
          return this.toSessionView(updated, repo);
        }

        this.logService?.logUserAction(
          'create_session',
          `Created session "${session.name}" (${input.agentType}) in repo "${repo.name}"`,
        );
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

      killProcess(sessionId);
      if (repo.is_git_repo && session.worktree_path) {
        await this.repoManager.removeSessionWorktree(repo, session.worktree_path);
      }
      this.sessionStore.delete(sessionId);
      this.logService?.logUserAction(
        'delete_session',
        `Deleted session "${session.name}" from repo "${repo.name}"`,
      );
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
