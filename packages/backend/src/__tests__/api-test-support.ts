import { afterAll, beforeAll, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { TEST_DATA_DIR } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { join: pJoin } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  return { TEST_DATA_DIR: mkdtempSync(pJoin(tmpdir(), 'aw-backend-test-')) };
});

vi.mock('../utils/config', () => ({
  Config: {
    DATA_DIR: TEST_DATA_DIR,
    PROJECT_ROOT: TEST_DATA_DIR,
    REPOS_DIR: './repos',
    CENTRAL_MD_DIR: join(TEST_DATA_DIR, 'central'),
    MASTER_PASSWORD: 'test-master-password-1234',
    PORT: 3001,
    NODE_ENV: 'test',
    STATIC_DIR: './public',
  },
}));

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { migrate } from '../db/migrate';
import { reposRouter } from '../routes/repos';
import { credentialsRouter } from '../routes/credentials';
import { agentsRouter } from '../routes/agents';
import { mdfilesRouter } from '../routes/mdfiles';
import { usageRouter } from '../routes/usage';
import { settingsRouter } from '../routes/settings';
import { pipelineRouter } from '../routes/pipeline';
import { toolsRouter } from '../routes/tools';
import { automationRouter } from '../routes/automation';
import { MdFileManager } from '../services/mdfile-manager';
import { SettingsService } from '../services/settings-service';
import { SessionStore } from '../services/session-store';
import { RepoManager } from '../services/repo-manager';
import { CredentialStore } from '../services/credential-store';
import { MdRefService } from '../services/md-ref-service';
import { UsageService } from '../services/usage-service';
import { TokenCounterService } from '../services/token-counter-service';
import { AutomationService } from '../services/automation-service';
import { WorkspaceService } from '../application/workspace-service';
import { PipelineRegistry } from '../pipeline/pipeline-registry';
import { createTokenUsageNode } from '../pipeline/nodes/token-usage.node';

export const testPaths = {
  root: TEST_DATA_DIR,
  central: join(TEST_DATA_DIR, 'central'),
  reposRoot: join(TEST_DATA_DIR, 'repos'),
} as const;

function makeTestApp() {
  const db = new Database(':memory:');
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
  const usageService = new UsageService(db);
  const pipelineRegistry = new PipelineRegistry(settingsService);
  const tokenCounter = new TokenCounterService();
  const automationService = new AutomationService(db, mdMgr, sessionStore, repoManager);

  pipelineRegistry.register(createTokenUsageNode(sessionStore, usageService, tokenCounter));

  const app = new Hono();
  app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.route('/api/repos', reposRouter(workspace, mdRefService));
  app.route('/api/credentials', credentialsRouter(credentialStore));
  app.route('/api/agents', agentsRouter());
  app.route('/api/mdfiles', mdfilesRouter(mdMgr));
  app.route('/api/usage', usageRouter(usageService, repoManager));
  app.route('/api/settings', settingsRouter(settingsService));
  app.route('/api/pipeline', pipelineRouter(pipelineRegistry));
  app.route('/api/tools', toolsRouter());
  app.route('/api/automation', automationRouter(automationService));
  return app;
}

export function setupApiTestApp(): () => Hono {
  let app: Hono;

  beforeAll(() => {
    process.env.REPOS_DIR = './repos';
    delete process.env.CENTRAL_MD_DIR;
    delete process.env.PIPELINE_NODES;
    delete process.env.AUTH_SETTINGS;
    mkdirSync(testPaths.central, { recursive: true });
    app = makeTestApp();
  });

  afterAll(() => {
    delete process.env.REPOS_DIR;
    delete process.env.CENTRAL_MD_DIR;
    delete process.env.PIPELINE_NODES;
    delete process.env.AUTH_SETTINGS;
  });

  return () => app;
}

export async function req(
  app: Hono,
  path: string,
  options?: { method?: string; body?: unknown },
) {
  const init: RequestInit = { method: options?.method ?? 'GET' };
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return app.request(`http://localhost${path}`, init);
}