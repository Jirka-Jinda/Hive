import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const { TEST_DATA_DIR } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { join: pJoin } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  return { TEST_DATA_DIR: mkdtempSync(pJoin(tmpdir(), 'aw-usage-test-')) };
});

vi.mock('../utils/config', () => ({
  Config: {
    DATA_DIR: TEST_DATA_DIR,
    PROJECT_ROOT: TEST_DATA_DIR,
    REPOS_DIR: './repos',
    MASTER_PASSWORD: 'test-master-password-1234',
    PORT: 3001,
    NODE_ENV: 'test',
    STATIC_DIR: './public',
  },
}));

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { migrate } from '../db/migrate';
import { RepoManager } from '../services/repo-manager';
import { SettingsService } from '../services/settings-service';
import { SessionStore } from '../services/session-store';
import { CredentialStore } from '../services/credential-store';
import { WorkspaceService } from '../application/workspace-service';
import { MdFileManager } from '../services/mdfile-manager';
import { UsageService } from '../services/usage-service';
import { TokenCounterService } from '../services/token-counter-service';
import { createTokenUsageNode } from '../pipeline/nodes/token-usage.node';
import { usageRouter } from '../routes/usage';

async function req(app: Hono, path: string, options?: { method?: string; body?: unknown }) {
  const init: RequestInit = { method: options?.method ?? 'GET' };
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return app.request(`http://localhost${path}`, init);
}

describe('Usage analytics', () => {
  let db: Database.Database;
  let repoManager: RepoManager;
  let sessionStore: SessionStore;
  let credentialStore: CredentialStore;
  let workspace: WorkspaceService;
  let usageService: UsageService;
  let tokenCounter: TokenCounterService;
  let app: Hono;
  let repoId = 0;
  let sessionId = 0;
  let credentialId = 0;

  beforeAll(() => {
    mkdirSync(join(TEST_DATA_DIR, 'central'), { recursive: true });
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);

    const mdMgr = new MdFileManager(db);
    const settingsService = new SettingsService();
    repoManager = new RepoManager(db, settingsService);
    sessionStore = new SessionStore(db);
    credentialStore = new CredentialStore(db);
    workspace = new WorkspaceService(db, mdMgr, settingsService, credentialStore, repoManager, sessionStore);
    usageService = new UsageService(db);
    tokenCounter = new TokenCounterService();

    const appInstance = new Hono();
    appInstance.route('/api/usage', usageRouter(usageService, repoManager));
    app = appInstance;
  });

  afterAll(() => {
    db.close();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('ignores the initial agent intro output and counts later usage via the API', async () => {
    const repo = await repoManager.addLocal(TEST_DATA_DIR, 'usage-repo');
    repoId = repo.id;

    const credential = credentialStore.create('usage-credential', 'claude', { envVars: { ANTHROPIC_API_KEY: 'secret' } });
    credentialId = credential.id;

    const session = await workspace.createSession({
      repoId,
      name: 'usage-session',
      agentType: 'claude',
      credentialId,
    });
    sessionId = session.id;

    const node = createTokenUsageNode(sessionStore, usageService, tokenCounter);

    const startupText = 'System context for the session.';
    const introText = 'Hello, I am your agent assistant.';
    const inputText = 'Summarize the repo state.';
    const outputText = 'Here is the summary from the agent.';

    await node.transform(startupText, { sessionId, repoId, phase: 'session-start' });
    await node.transform(introText, { sessionId, repoId, phase: 'agent-output' });
    await node.transform(inputText, { sessionId, repoId, phase: 'user-input' });
    await node.transform(outputText, { sessionId, repoId, phase: 'agent-output' });

    const summary = usageService.getSummary(repoId);

    expect(summary.totals.context_tokens).toBe(await tokenCounter.count(startupText));
    expect(summary.totals.input_tokens).toBe(await tokenCounter.count(inputText));
    expect(summary.totals.output_tokens).toBe(await tokenCounter.count(outputText));
    expect(summary.totals.output_tokens).not.toBe(await tokenCounter.count(introText) + await tokenCounter.count(outputText));
    expect(summary.totals.prompt_tokens).toBe(summary.totals.context_tokens + summary.totals.input_tokens);
    expect(summary.totals.total_tokens).toBe(summary.totals.prompt_tokens + summary.totals.output_tokens);
    expect(summary.sessions).toHaveLength(1);
    expect(summary.sessions[0]?.session_id).toBe(sessionId);
    expect(summary.by_agent[0]?.agent_type).toBe('claude');
    expect(summary.by_credential[0]?.credential_id).toBe(credentialId);
    expect(summary.by_credential[0]?.credential_name).toBe('usage-credential');

    const res = await req(app, `/api/usage?repoId=${repoId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repo_id).toBe(repoId);
    expect(body.totals.total_tokens).toBe(summary.totals.total_tokens);
  });

  it('deletes session totals but preserves repo-wide rollups', () => {
    const beforeDelete = usageService.getSummary(repoId);
    expect(beforeDelete.sessions.some((row) => row.session_id === sessionId)).toBe(true);
    expect(beforeDelete.totals.total_tokens).toBeGreaterThan(0);

    workspace.deleteSession(repoId, sessionId);

    const afterDelete = usageService.getSummary(repoId);
    expect(afterDelete.sessions.some((row) => row.session_id === sessionId)).toBe(false);
    expect(afterDelete.totals.total_tokens).toBe(beforeDelete.totals.total_tokens);
  });

  it('removes repo-wide rollups when the repo is deleted', () => {
    const beforeDelete = usageService.getSummary(repoId);
    expect(beforeDelete.totals.total_tokens).toBeGreaterThan(0);

    workspace.deleteRepo(repoId);

    const afterDelete = usageService.getSummary();
    expect(afterDelete.totals.total_tokens).toBe(0);
    expect(afterDelete.by_agent).toHaveLength(0);
    expect(afterDelete.by_credential).toHaveLength(0);
  });
});