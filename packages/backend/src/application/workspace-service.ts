import type Database from 'better-sqlite3';
import { AGENT_ADAPTERS } from '../services/agents';
import type { CredentialStore } from '../services/credential-store';
import type { MdFileManager } from '../services/mdfile-manager';
import { killProcess } from '../services/process-manager';
import { RepoManager } from '../services/repo-manager';
import { SessionStore } from '../services/session-store';
import type { SettingsService } from '../services/settings-service';

export class WorkspaceService {
  private readonly repoManager: RepoManager;
  private readonly sessionStore: SessionStore;
  private readonly credentialStore: CredentialStore;

  constructor(
    db: Database.Database,
    private readonly mdFileManager: MdFileManager,
    private readonly settingsService: SettingsService,
    credentialStore?: CredentialStore,
    repoManager?: RepoManager,
    sessionStore?: SessionStore,
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

    return repo;
  }

  deleteRepo(id: number, deleteFromDisk = false): void {
    this.repoManager.get(id);
    const sessions = this.sessionStore.list(id);
    for (const session of sessions) {
      killProcess(session.id);
    }
    if (deleteFromDisk) {
      this.repoManager.deleteFromDisk(id);
    } else {
      this.repoManager.delete(id);
    }
  }

  listSessions(repoId: number) {
    this.repoManager.get(repoId);
    return this.sessionStore.list(repoId);
  }

  updateSession(repoId: number, sessionId: number, input: { name: string }) {
    this.repoManager.get(repoId);
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }

    return this.sessionStore.update(sessionId, { name: input.name });
  }

  restartSession(repoId: number, sessionId: number) {
    this.repoManager.get(repoId);
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }

    killProcess(sessionId);
    this.sessionStore.clearLogs(sessionId);
    this.sessionStore.setStatus(sessionId, 'stopped');
    this.sessionStore.setState(sessionId, 'stopped');
    return this.sessionStore.get(sessionId);
  }

  createSession(input: {
    repoId: number;
    name: string;
    agentType: string;
    credentialId?: number;
  }) {
    this.repoManager.get(input.repoId);

    if (!AGENT_ADAPTERS[input.agentType]) {
      throw new Error(`Unknown agent type: ${input.agentType}`);
    }

    if (input.credentialId !== undefined) {
      const credential = this.credentialStore.get(input.credentialId);
      if (credential.agent_type !== input.agentType) {
        throw new Error('Credential profile does not match the selected agent');
      }
    }

    return this.sessionStore.create(
      input.repoId,
      input.agentType,
      input.name.trim(),
      input.credentialId
    );
  }

  deleteSession(repoId: number, sessionId: number): void {
    this.repoManager.get(repoId);
    const session = this.sessionStore.get(sessionId);
    if (session.repo_id !== repoId) {
      throw new Error(`Session ${sessionId} does not belong to repo ${repoId}`);
    }

    killProcess(sessionId);
    this.sessionStore.delete(sessionId);
  }
}
