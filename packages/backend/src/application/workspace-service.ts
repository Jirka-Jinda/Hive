import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { AGENT_ADAPTERS } from '../services/agents';
import type { CredentialStore } from '../services/credential-store';
import type { MdFileManager } from '../services/mdfile-manager';
import { killProcessAndWait } from '../services/process-manager';
import { RepoManager } from '../services/repo-manager';
import type { GitChangedFile, GitFileDiff, GitHistoryEntry, GitWorktreeStatus, Repo } from '../services/repo-manager';
import { SessionStore } from '../services/session-store';
import type { Session, SessionBranchMode, SessionWithGitStatus } from '../services/session-store';
import type { SettingsService } from '../services/settings-service';
import { discoverRepoMdFiles } from '../utils/repo-md-discovery';
import type { MdFile } from '../services/mdfile-manager';
import type { LogService } from '../services/log-service';
import {
  AGENT_MD_DIR,
  AGENT_MD_DIR_ALIASES,
  ensureAgentDir,
  getAgentDirNameFromRepoRelativePath,
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
  is_remote: boolean;
}

export interface AgentMdWatchRoot {
  repoId: number;
  path: string;
}

export interface SessionAgentFile {
  agentRelativePath: string;
  repoRelativePath: string;
}

export interface MdRediscoverySummary {
  repoChanged: boolean;
  sessionChangedIds: number[];
}

interface RepoMdFileSnapshot {
  path: string;
  content: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferAgentMdType(path: string): MdFile['type'] {
  const lower = path.toLowerCase();
  if (lower.includes('skill')) return 'skill';
  if (lower.includes('tool')) return 'tool';
  if (lower.includes('prompt')) return 'prompt';
  if (lower.includes('instruction') || lower.includes('copilot') || lower.includes('agent')) return 'instruction';
  return 'other';
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
   * Re-discovers md files on disk for the given repo root and its session
   * worktrees. Repo-scoped files stay repo-scoped; unknown worktree-local
   * files are captured as session-scoped drafts for the owning session.
   */
  rediscoverRepoMdFiles(repoId: number): MdRediscoverySummary {
    const repo = this.repoManager.get(repoId);
    const repoBefore = this.snapshotScopeDigest('repo', repoId);

    const discovered = discoverRepoMdFiles(repo.path);
    const isAgentFile = (path: string) => path.toLowerCase().startsWith(`${AGENT_MD_DIR}/`) || path.toLowerCase().startsWith('.agents/');
    const nonAgentFiles = discovered.filter((file) => !isAgentFile(file.path));
    const agentFiles = discovered.filter((file) => isAgentFile(file.path));
    if (nonAgentFiles.length > 0) {
      this.mdFileManager.importDiscoveredRepoFiles(repoId, nonAgentFiles);
    }
    if (agentFiles.length > 0) {
      this.mdFileManager.importDiscoveredRepoFiles(repoId, agentFiles);
    }

    const repoAgentPaths = new Set(readAgentMarkdownFiles(repo.path).map((file) => file.repoRelativePath));
    this.mdFileManager.pruneMissingRepoAgentFiles(repoId, repoAgentPaths);
    const sessionChangedIds = this.rediscoverSessionMdFiles(repoId);
    const repoChanged = repoBefore !== this.snapshotScopeDigest('repo', repoId);

    // Propagate changes downstream to all session worktrees.
    void this.syncRepoFilesToAllWorktrees(repoId).catch((error) => {
      console.warn('[WorkspaceService] Failed to sync repo files after rediscovery', { repoId, error });
    });

    return { repoChanged, sessionChangedIds };
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

  async listSessions(repoId: number, includeArchived = false): Promise<SessionWithGitStatus[]> {
    const repo = this.repoManager.get(repoId);
    const sessions = this.sessionStore.list(repoId, includeArchived);
    return Promise.all(sessions.map((session) => this.toSessionView(session, repo)));
  }

  reorderSessions(repoId: number, orderedIds: number[]): void {
    this.repoManager.get(repoId); // validates repo exists
    this.sessionStore.reorder(repoId, orderedIds);
  }

  async gitCommit(repoId: number, sessionId: number | undefined, message: string): Promise<{ commit: string }> {
    const repo = this.repoManager.get(repoId);
    const worktreePath = sessionId !== undefined
      ? this.sessionStore.get(sessionId).worktree_path
      : null;
    const commit = await this.repoManager.commitChanges(repo, worktreePath, message);
    this.logService?.logUserAction('git_commit', `Committed in repo "${repo.name}"${sessionId !== undefined ? ` (session ${sessionId})` : ''}: ${message.slice(0, 80)}`);
    return { commit };
  }

  async gitPush(repoId: number, sessionId: number | undefined, remote?: string, branch?: string): Promise<void> {
    const repo = this.repoManager.get(repoId);
    const worktreePath = sessionId !== undefined
      ? this.sessionStore.get(sessionId).worktree_path
      : null;
    await this.repoManager.pushBranch(repo, worktreePath, remote, branch);
    this.logService?.logUserAction('git_push', `Pushed in repo "${repo.name}"${sessionId !== undefined ? ` (session ${sessionId})` : ''}`);
  }

  async gitFetchAndPull(repoId: number, sessionId: number | undefined, remote?: string, branch?: string): Promise<{ ok: boolean }> {
    const repo = this.repoManager.get(repoId);
    const worktreePath = sessionId !== undefined
      ? this.sessionStore.get(sessionId).worktree_path
      : null;
    await this.repoManager.fetchAndPull(repo, worktreePath, remote, branch);
    this.logService?.logUserAction('git_fetch_pull', `Fetched and pulled in repo "${repo.name}"${sessionId !== undefined ? ` (session ${sessionId})` : ''}`);
    return { ok: true };
  }

  async gitFetchRemotes(repoId: number): Promise<void> {
    const repo = this.repoManager.get(repoId);
    await this.repoManager.fetchRemotes(repo);
  }

  searchSessionLogs(repoId: number, sessionId: number, query: string): { snippet: string; log_id: number }[] {
    this.repoManager.get(repoId); // validates repo exists
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    return this.sessionStore.searchLogs(sessionId, query);
  }

  getSession(repoId: number, sessionId: number): Session {
    this.repoManager.get(repoId); // validates repo exists
    return this.getSessionForRepo(repoId, sessionId);
  }

  async updateSession(repoId: number, sessionId: number, input: { name: string }): Promise<SessionWithGitStatus> {
    const repo = this.repoManager.get(repoId);
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }

    return this.toSessionView(this.sessionStore.update(sessionId, { name: input.name }), repo);
  }

  async archiveSession(repoId: number, sessionId: number): Promise<SessionWithGitStatus> {
    const repo = this.repoManager.get(repoId);
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }
    return this.toSessionView(this.sessionStore.archive(sessionId), repo);
  }

  async unarchiveSession(repoId: number, sessionId: number): Promise<SessionWithGitStatus> {
    const repo = this.repoManager.get(repoId);
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }
    return this.toSessionView(this.sessionStore.unarchive(sessionId), repo);
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
          const worktree = await this.repoManager.createSessionWorktree(
            repo,
            session.id,
            branchMode,
            initialBranchName,
          );
          createdWorktreePath = typeof worktree === 'string' ? worktree : worktree.path;
          const resolvedInitialBranchName = typeof worktree === 'string' ? initialBranchName : worktree.branch;
          const repoFiles = this.snapshotRepoMdFiles(repo.id);
          if (repoFiles.length > 0) this.syncRepoFilesToWorktree(repo.id, createdWorktreePath, repoFiles);
          const updated = this.sessionStore.updateGitMetadata(session.id, {
            initialBranchName: resolvedInitialBranchName,
            worktreePath: createdWorktreePath,
          });
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

    const [localBranches, remoteBranches, occupancy, sessions] = await Promise.all([
      this.repoManager.listLocalBranches(repo, query),
      this.repoManager.listRemoteBranches(repo, query),
      this.repoManager.listBranchOccupancy(repo),
      this.listSessions(repoId),
    ]);

    const localBranchSet = new Set(localBranches);
    // Remote branches that have no local counterpart
    const remoteOnlyBranches = remoteBranches.filter((rb) => !localBranchSet.has(rb.localName));
    const branches: Array<{ name: string; is_remote: boolean }> = [
      ...localBranches.map((b) => ({ name: b, is_remote: false })),
      ...remoteOnlyBranches.map((rb) => ({ name: rb.fullName, is_remote: true })),
    ];

    const sessionsByWorktree = new Map<string, SessionWithGitStatus>();
    for (const session of sessions) {
      if (!session.worktree_path) continue;
      sessionsByWorktree.set(this.normalizePath(session.worktree_path), session);
    }

    return branches.map(({ name: branch, is_remote }) => {
      const localName = is_remote ? branch.replace(/^[^/]+\//, '') : branch;
      const usage = occupancy.get(is_remote ? localName : branch);
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
        is_remote,
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

  async getChangedFiles(repoId: number, sessionId?: number): Promise<GitChangedFile[]> {
    const repo = this.repoManager.get(repoId);
    if (!repo.is_git_repo) return [];

    const session = sessionId ? this.getSessionForRepo(repoId, sessionId) : null;
    return this.repoManager.getChangedFiles(repo, session?.worktree_path ?? null);
  }

  async getFileDiff(repoId: number, filePath: string, sessionId?: number): Promise<GitFileDiff> {
    const repo = this.repoManager.get(repoId);
    const session = sessionId ? this.getSessionForRepo(repoId, sessionId) : null;
    return this.repoManager.getFileDiff(repo, filePath, session?.worktree_path ?? null);
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
     * Compatibility shim for the old session agent-files API. Returns current
     * session-scoped MD files for the selected session.
   */
  listSessionAgentFiles(repoId: number, sessionId: number): SessionAgentFile[] {
      this.getSessionForRepo(repoId, sessionId);
      return this.mdFileManager.list('session', undefined, sessionId).map((file) => {
        const agentRelativePath = toAgentRelativePath(file.path);
        return {
          agentRelativePath,
          repoRelativePath: toRepoAgentPath(agentRelativePath),
        };
      });
  }

  /**
   * Compatibility shim for the old session agent-files promote API. Session
   * files now become repo-scoped via a normal scope change.
   */
  async promoteSessionAgentFile(repoId: number, sessionId: number, agentRelativePath: string): Promise<MdFile> {
    const normalized = normalizeMarkdownRelativePath(agentRelativePath);
    const repo = this.repoManager.get(repoId);
    const sessionFile = this.mdFileManager
      .list('session', undefined, sessionId)
      .find((file) => toAgentRelativePath(file.path).toLowerCase() === normalized.toLowerCase());
    if (!sessionFile) throw new Error(`Session file not found: ${agentRelativePath}`);

    const updated = this.mdFileManager.update(sessionFile.id, { scope: 'repo', repoPath: repo.path });
    this.deleteSessionFileFromWorktree(sessionId, sessionFile.path);
    await this.syncRepoFilesToAllWorktrees(repoId);
    return updated;
  }

  /**
   * Syncs all repo-scoped MD files downstream to all session worktrees.
   * Suppresses worktree watch roots during the write to avoid re-entrant
   * discovery cycles.
   */
  async syncRepoFilesToAllWorktrees(repoId: number): Promise<void> {
    const repo = this.repoManager.get(repoId);
    const sessions = this.sessionStore.list(repoId);
    const worktreePaths = sessions
      .map((s) => s.worktree_path)
      .filter((p): p is string => Boolean(p))
      .filter((p) => this.normalizePath(p) !== this.normalizePath(repo.path));

    if (worktreePaths.length === 0) return;

    const files = this.snapshotRepoMdFiles(repoId);
    if (files.length === 0) return;

    const releaseWatch = await this.suppressAgentMdWatchRoots(worktreePaths);
    try {
      for (const worktreePath of worktreePaths) {
        this.syncRepoFilesToWorktree(repoId, worktreePath, files);
      }
    } finally {
      releaseWatch();
    }
  }

  async syncSessionFilesToWorktree(sessionId: number): Promise<void> {
    const session = this.sessionStore.get(sessionId);
    if (!session.worktree_path) return;

    const files = this.snapshotSessionMdFiles(sessionId);
    const releaseWatch = await this.suppressAgentMdWatchRoots([session.worktree_path]);
    try {
      this.syncSessionFilesSnapshotToWorktree(session.worktree_path, files);
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

    const repo = this.repoManager.get(repoId);

    // Delete from the main repo's agent dirs so rediscovery doesn't re-import the old path.
    for (const agentDirName of AGENT_MD_DIR_ALIASES) {
      try {
        const targetPath = resolve(repo.path, toRepoAgentPath(agentRelativePath, agentDirName));
        if (existsSync(targetPath)) unlinkSync(targetPath);
      } catch (error) {
        console.warn('[WorkspaceService] Failed to delete repo file from main repo agent dir', {
          repoId, repoPath: repo.path, filePath, agentDirName, error,
        });
      }
    }

    const sessions = this.sessionStore.list(repoId);
    for (const session of sessions) {
      if (!session.worktree_path) continue;
      if (this.normalizePath(session.worktree_path) === this.normalizePath(repo.path)) continue;
      for (const agentDirName of AGENT_MD_DIR_ALIASES) {
        try {
          const targetPath = resolve(session.worktree_path, toRepoAgentPath(agentRelativePath, agentDirName));
          if (existsSync(targetPath)) unlinkSync(targetPath);
        } catch (error) {
          console.warn('[WorkspaceService] Failed to delete repo file from worktree', {
            repoId, worktreePath: session.worktree_path, filePath, agentDirName, error,
          });
        }
      }
    }
  }

  deleteSessionFileFromWorktree(sessionId: number, filePath: string): void {
    const session = this.sessionStore.get(sessionId);
    if (!session.worktree_path) return;

    let agentRelativePath: string;
    try {
      agentRelativePath = toAgentRelativePath(filePath);
    } catch {
      return;
    }

    for (const agentDirName of AGENT_MD_DIR_ALIASES) {
      try {
        const targetPath = resolve(session.worktree_path, toRepoAgentPath(agentRelativePath, agentDirName));
        if (existsSync(targetPath)) unlinkSync(targetPath);
      } catch (error) {
        console.warn('[WorkspaceService] Failed to delete session file from worktree', {
          sessionId,
          worktreePath: session.worktree_path,
          filePath,
          agentDirName,
          error,
        });
      }
    }
  }

  private syncRepoFilesToWorktree(repoId: number, worktreePath: string, files: readonly RepoMdFileSnapshot[]): void {
    try {
      ensureAgentDir(worktreePath);
    } catch (error) {
      console.warn('[WorkspaceService] Failed to create worktree .agent directory', { worktreePath, error });
      return;
    }

    const writtenTargets = new Set<string>();
    for (const file of files) {
      try {
        const agentRelativePath = toAgentRelativePath(file.path);
        const agentDirName = getAgentDirNameFromRepoRelativePath(file.path) ?? AGENT_MD_DIR;
        const targetPath = resolve(worktreePath, toRepoAgentPath(agentRelativePath, agentDirName));
        const targetKey = this.normalizePath(targetPath);
        if (writtenTargets.has(targetKey)) continue;
        mkdirSync(dirname(targetPath), { recursive: true });
        if (!existsSync(targetPath) || readFileSync(targetPath, 'utf8') !== file.content) {
          writeFileSync(targetPath, file.content, 'utf8');
        }
        writtenTargets.add(targetKey);
      } catch (error) {
        console.warn('[WorkspaceService] Failed to sync repo md file to worktree .agent', {
          repoId, worktreePath, path: file.path, error,
        });
      }
    }
  }

  private syncSessionFilesSnapshotToWorktree(worktreePath: string, files: readonly RepoMdFileSnapshot[]): void {
    try {
      ensureAgentDir(worktreePath);
    } catch (error) {
      console.warn('[WorkspaceService] Failed to create worktree .agent directory for session files', { worktreePath, error });
      return;
    }

    const writtenTargets = new Set<string>();
    for (const file of files) {
      try {
        const agentRelativePath = toAgentRelativePath(file.path);
        const targetPath = resolve(worktreePath, toRepoAgentPath(agentRelativePath, AGENT_MD_DIR));
        const targetKey = this.normalizePath(targetPath);
        if (writtenTargets.has(targetKey)) continue;

        for (const agentDirName of AGENT_MD_DIR_ALIASES) {
          const aliasPath = resolve(worktreePath, toRepoAgentPath(agentRelativePath, agentDirName));
          if (this.normalizePath(aliasPath) !== targetKey && existsSync(aliasPath)) {
            unlinkSync(aliasPath);
          }
        }

        mkdirSync(dirname(targetPath), { recursive: true });
        if (!existsSync(targetPath) || readFileSync(targetPath, 'utf8') !== file.content) {
          writeFileSync(targetPath, file.content, 'utf8');
        }
        writtenTargets.add(targetKey);
      } catch (error) {
        console.warn('[WorkspaceService] Failed to sync session md file to worktree .agent', {
          worktreePath,
          path: file.path,
          error,
        });
      }
    }
  }

  private snapshotRepoMdFiles(repoId: number): RepoMdFileSnapshot[] {
    return this.mdFileManager.list('repo', repoId).map((file) => ({
      path: file.path,
      content: this.mdFileManager.read(file.id).content,
    }));
  }

  private snapshotSessionMdFiles(sessionId: number): RepoMdFileSnapshot[] {
    return this.mdFileManager.list('session', undefined, sessionId).map((file) => ({
      path: file.path,
      content: this.mdFileManager.read(file.id).content,
    }));
  }

  private snapshotScopeDigest(scope: 'repo', ownerId: number): string;
  private snapshotScopeDigest(scope: 'session', ownerId: number): string;
  private snapshotScopeDigest(scope: 'repo' | 'session', ownerId: number): string {
    const files = scope === 'repo'
      ? this.mdFileManager.list('repo', ownerId)
      : this.mdFileManager.list('session', undefined, ownerId);

    return files
      .map((file) => {
        const { content } = this.mdFileManager.read(file.id);
        return `${file.id}|${file.scope}|${file.repo_id ?? ''}|${file.session_id ?? ''}|${file.path}|${file.type}|${content}`;
      })
      .join('\u0000');
  }

  private rediscoverSessionMdFiles(repoId: number): number[] {
    const repoFilesByAgentPath = new Map<string, MdFile>();
    for (const file of this.mdFileManager.list('repo', repoId)) {
      try {
        repoFilesByAgentPath.set(toAgentRelativePath(file.path).toLowerCase(), file);
      } catch {
        // Skip invalid markdown paths.
      }
    }

    const changedSessionIds: number[] = [];

    for (const session of this.sessionStore.list(repoId)) {
      if (!session.worktree_path) continue;

      const before = this.snapshotScopeDigest('session', session.id);

      const worktreeFiles = readAgentMarkdownFiles(session.worktree_path);
      const sessionFiles: Array<{ path: string; content: string; type: MdFile['type'] }> = [];

      for (const file of worktreeFiles) {
        const repoFile = repoFilesByAgentPath.get(file.agentRelativePath.toLowerCase());
        if (repoFile) {
          const current = this.mdFileManager.read(repoFile.id);
          if (current.content !== file.content || repoFile.type !== inferAgentMdType(file.agentRelativePath)) {
            this.mdFileManager.update(repoFile.id, {
              content: file.content,
              type: inferAgentMdType(file.agentRelativePath),
            });
          }
          continue;
        }

        sessionFiles.push({
          path: file.agentRelativePath,
          content: file.content,
          type: inferAgentMdType(file.agentRelativePath),
        });
      }

      if (sessionFiles.length > 0) {
        this.mdFileManager.importDiscoveredSessionFiles(session.id, sessionFiles);
      }
      this.mdFileManager.pruneMissingSessionFiles(session.id, new Set(sessionFiles.map((file) => file.path)));

      if (before !== this.snapshotScopeDigest('session', session.id)) {
        changedSessionIds.push(session.id);
      }
    }

    return changedSessionIds;
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
