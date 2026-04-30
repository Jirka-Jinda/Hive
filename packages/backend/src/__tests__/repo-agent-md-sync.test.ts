import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { WorkspaceService } from '../application/workspace-service';
import { MdFileManager } from '../services/mdfile-manager';
import { SettingsService } from '../services/settings-service';
import { SessionStore } from '../services/session-store';
import { RepoManager } from '../services/repo-manager';
import { CredentialStore } from '../services/credential-store';
import { testPaths } from './api-test-support';

describe('repo .agent markdown sync', () => {
  let db: Database.Database;
  let mdMgr: MdFileManager;
  let sessionStore: SessionStore;
  let repoManager: RepoManager;
  let workspace: WorkspaceService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);

    mdMgr = new MdFileManager(db);
    const settingsService = new SettingsService();
    sessionStore = new SessionStore(db);
    repoManager = new RepoManager(db, settingsService);
    workspace = new WorkspaceService(
      db,
      mdMgr,
      settingsService,
      new CredentialStore(db),
      repoManager,
      sessionStore,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('copies session .agent markdown into the repo root .agent folder during rediscovery', async () => {
    const repoPath = join(testPaths.root, `repo-agent-root-${Date.now()}`);
    const worktreePath = join(testPaths.root, `repo-agent-worktree-${Date.now()}`);
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(join(worktreePath, '.agent'), { recursive: true });
    writeFileSync(join(worktreePath, '.agent', 'generated.md'), '# Generated\n', 'utf8');

    const repo = await repoManager.addLocal(repoPath, 'agent-root-sync');
    sessionStore.create({
      repoId: repo.id,
      agentType: 'claude',
      name: 'Agent session',
      worktreePath,
    });

    workspace.rediscoverRepoMdFiles(repo.id);

    const copiedPath = join(repoPath, '.agent', 'generated.md');
    expect(existsSync(copiedPath)).toBe(true);
    expect(readFileSync(copiedPath, 'utf8')).toBe('# Generated\n');
    expect(mdMgr.list('repo', repo.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '.agent/generated.md' }),
      ]),
    );
  });

  it('treats a worktree .agent copy as an update to an existing repo md record', async () => {
    const repoPath = join(testPaths.root, `repo-agent-alias-${Date.now()}`);
    const worktreePath = join(testPaths.root, `repo-agent-alias-worktree-${Date.now()}`);
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(join(worktreePath, '.agent'), { recursive: true });

    const repo = await repoManager.addLocal(repoPath, 'agent-alias-sync');
    const existing = mdMgr.create('repo', repoPath, 'seed.md', '# Original\n', 'prompt');
    writeFileSync(join(worktreePath, '.agent', 'seed.md'), '# Updated from worktree\n', 'utf8');
    sessionStore.create({
      repoId: repo.id,
      agentType: 'claude',
      name: 'Agent session',
      worktreePath,
    });

    workspace.rediscoverRepoMdFiles(repo.id);

    const files = mdMgr.list('repo', repo.id);
    expect(files.filter((file) => file.path.endsWith('seed.md'))).toHaveLength(1);
    expect(files.find((file) => file.path === '.agent/seed.md')).toBeUndefined();
    expect(mdMgr.read(existing.id).content).toBe('# Updated from worktree\n');
  });

  it('lets a worktree .agent copy win over the original repo markdown during rediscovery', async () => {
    const repoPath = join(testPaths.root, `repo-agent-disk-${Date.now()}`);
    const worktreePath = join(testPaths.root, `repo-agent-disk-worktree-${Date.now()}`);
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(join(worktreePath, '.agent'), { recursive: true });
    writeFileSync(join(repoPath, 'prompt.md'), '# Original disk prompt\n', 'utf8');
    writeFileSync(join(worktreePath, '.agent', 'prompt.md'), '# Updated from worktree\n', 'utf8');

    const repo = await repoManager.addLocal(repoPath, 'agent-disk-sync');
    workspace.rediscoverRepoMdFiles(repo.id);
    const original = mdMgr.list('repo', repo.id).find((file) => file.path === 'prompt.md');
    expect(original).toBeDefined();

    sessionStore.create({
      repoId: repo.id,
      agentType: 'claude',
      name: 'Agent session',
      worktreePath,
    });

    workspace.rediscoverRepoMdFiles(repo.id);

    const files = mdMgr.list('repo', repo.id);
    expect(files.filter((file) => file.path.endsWith('prompt.md'))).toHaveLength(1);
    expect(files.find((file) => file.path === '.agent/prompt.md')).toBeUndefined();
    expect(mdMgr.read(original!.id).content).toBe('# Updated from worktree\n');
  });
});
