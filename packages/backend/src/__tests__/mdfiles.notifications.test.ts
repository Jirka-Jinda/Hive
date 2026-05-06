import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { migrate } from '../db/migrate';
import { mdfilesRouter } from '../routes/mdfiles';
import { reposRouter } from '../routes/repos';
import { MdFileManager } from '../services/mdfile-manager';
import { SettingsService } from '../services/settings-service';
import { SessionStore } from '../services/session-store';
import { RepoManager } from '../services/repo-manager';
import { CredentialStore } from '../services/credential-store';
import { MdRefService } from '../services/md-ref-service';
import { WorkspaceService } from '../application/workspace-service';
import { LogService } from '../services/log-service';
import { req, testPaths } from './api-test-support';

describe('MD Files notifications', () => {
  let db: Database.Database;
  let app: Hono;
  const notificationBus = {
    emitMdFilesChanged: vi.fn(),
  };

  beforeEach(() => {
    notificationBus.emitMdFilesChanged.mockReset();
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);

    const mdMgr = new MdFileManager(db);
    const settingsService = new SettingsService();
    const sessionStore = new SessionStore(db);
    const repoManager = new RepoManager(db, settingsService);
    const credentialStore = new CredentialStore(db);
    const mdRefService = new MdRefService(db);
    const workspace = new WorkspaceService(db, mdMgr, settingsService, credentialStore, repoManager, sessionStore);
    const logService = new LogService(db);

    app = new Hono();
    app.route('/api/repos', reposRouter(workspace, mdRefService));
    app.route('/api/mdfiles', mdfilesRouter(mdMgr, workspace, logService, notificationBus as any));
  });

  it('emits a session-scoped notification when creating a session file', async () => {
    const repoPath = join(testPaths.root, `notify-repo-${Date.now()}`);
    mkdirSync(repoPath, { recursive: true });

    const repoRes = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'notify-repo' },
    });
    const repo = await repoRes.json() as { id: number };

    const sessionRes = await req(app, `/api/repos/${repo.id}/sessions`, {
      method: 'POST',
      body: { name: 'notify-session', agentType: 'claude' },
    });
    const session = await sessionRes.json() as { id: number };

    const res = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'session',
        sessionId: session.id,
        filename: 'draft.md',
        content: '# Draft',
        type: 'other',
      },
    });

    expect(res.status).toBe(201);
    expect(notificationBus.emitMdFilesChanged).toHaveBeenCalledWith({
      scope: 'session',
      repoId: repo.id,
      sessionId: session.id,
    });
  });

  it('emits both old and new scope notifications when moving a session file to repo scope', async () => {
    const repoPath = join(testPaths.root, `notify-move-repo-${Date.now()}`);
    mkdirSync(repoPath, { recursive: true });

    const repoRes = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'notify-move-repo' },
    });
    const repo = await repoRes.json() as { id: number };

    const sessionRes = await req(app, `/api/repos/${repo.id}/sessions`, {
      method: 'POST',
      body: { name: 'notify-move-session', agentType: 'claude' },
    });
    const session = await sessionRes.json() as { id: number };

    const createRes = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'session',
        sessionId: session.id,
        filename: 'draft.md',
        content: '# Draft',
        type: 'other',
      },
    });
    const file = await createRes.json() as { id: number };

    notificationBus.emitMdFilesChanged.mockClear();

    const moveRes = await req(app, `/api/mdfiles/${file.id}`, {
      method: 'PUT',
      body: {
        scope: 'repo',
        repoPath,
      },
    });

    expect(moveRes.status).toBe(200);
    expect(notificationBus.emitMdFilesChanged).toHaveBeenNthCalledWith(1, {
      scope: 'session',
      repoId: repo.id,
      sessionId: session.id,
    });
    expect(notificationBus.emitMdFilesChanged).toHaveBeenNthCalledWith(2, {
      scope: 'repo',
      repoId: repo.id,
    });
  });
});