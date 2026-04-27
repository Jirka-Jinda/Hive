import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Hoist setup BEFORE vi.mock factories run ──────────────────────────────
const { TEST_DATA_DIR } = vi.hoisted(() => {
  // Must use require() — static imports aren't available yet at hoist time
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { join: pJoin } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  return { TEST_DATA_DIR: mkdtempSync(pJoin(tmpdir(), 'aw-backend-test-')) };
});

// Mock Config so services/routes use our temp dir instead of the real data dir
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

// ── Imports (resolved after mock is in place) ─────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────

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
  app.get('/api/health', (c) =>
    c.json({ status: 'ok', timestamp: new Date().toISOString() })
  );
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

async function req(
  app: Hono,
  path: string,
  options?: { method?: string; body?: unknown }
) {
  const init: RequestInit = { method: options?.method ?? 'GET' };
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return app.request(`http://localhost${path}`, init);
}

// ── Shared test instance ──────────────────────────────────────────────────
let app: Hono;

beforeAll(() => {
  mkdirSync(join(TEST_DATA_DIR, 'central'), { recursive: true });
  app = makeTestApp();
});

afterAll(() => {
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════
// Health
// ══════════════════════════════════════════════════════════════════════════
describe('GET /api/health', () => {
  it('returns 200 with ok status', async () => {
    const res = await req(app, '/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Agents
// ══════════════════════════════════════════════════════════════════════════
describe('GET /api/agents', () => {
  it('returns 200 with a non-empty agent list', async () => {
    const res = await req(app, '/api/agents');
    expect(res.status).toBe(200);
    const agents = await res.json();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });

  it('each agent has id, name, command, installed, credentialFields', async () => {
    const res = await req(app, '/api/agents');
    for (const agent of await res.json()) {
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('command');
      expect(typeof agent.installed).toBe('boolean');
      expect(Array.isArray(agent.credentialFields)).toBe(true);
    }
  });

  it('includes the claude agent with ANTHROPIC_API_KEY field', async () => {
    const res = await req(app, '/api/agents');
    const claude = (await res.json()).find((a: { id: string }) => a.id === 'claude');
    expect(claude).toBeDefined();
    expect(claude.credentialFields).toHaveLength(1);
    expect(claude.credentialFields[0].key).toBe('ANTHROPIC_API_KEY');
    expect(claude.credentialFields[0].secret).toBe(true);
  });

  it('includes codex and copilot agents', async () => {
    const res = await req(app, '/api/agents');
    const ids = (await res.json()).map((a: { id: string }) => a.id);
    expect(ids).toContain('codex');
    expect(ids).toContain('copilot');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Repos
// ══════════════════════════════════════════════════════════════════════════
describe('Repos API', () => {
  let repoId = 0;

  it('GET /api/repos — returns array', async () => {
    const res = await req(app, '/api/repos');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/repos — 400 when neither path nor gitUrl provided', async () => {
    const res = await req(app, '/api/repos', {
      method: 'POST',
      body: { name: 'no-path' },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('POST /api/repos — 400 for non-existent local path', async () => {
    const res = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: '/does-not-exist-xyzzy-12345' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not exist/i);
  });

  it('POST /api/repos — 201 for valid local path', async () => {
    const res = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: TEST_DATA_DIR, name: 'test-repo' },
    });
    expect(res.status).toBe(201);
    const repo = await res.json();
    expect(repo.id).toBeGreaterThan(0);
    expect(repo.name).toBe('test-repo');
    expect(repo.source).toBe('local');
    expect(repo.git_url).toBeNull();
    expect(repo.is_git_repo).toBe(false);
    repoId = repo.id;
  });

  it('GET /api/repos/:id — returns the created repo', async () => {
    const res = await req(app, `/api/repos/${repoId}`);
    expect(res.status).toBe(200);
    const repo = await res.json();
    expect(repo.id).toBe(repoId);
    expect(repo.name).toBe('test-repo');
  });

  it('GET /api/repos/:id — 404 for unknown repo', async () => {
    const res = await req(app, '/api/repos/99999');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/repo 99999 not found/i);
  });

  it('POST /api/repos — 400 for file path instead of directory', async () => {
    const filePath = join(TEST_DATA_DIR, 'not-a-directory.txt');
    writeFileSync(filePath, 'hello', 'utf8');

    const res = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: filePath, name: 'bad-repo' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a directory/i);
  });

  it('GET /api/repos — newly created repo is in the list', async () => {
    const res = await req(app, '/api/repos');
    const repos = await res.json();
    expect(repos.some((r: { id: number; is_git_repo: boolean }) => r.id === repoId && r.is_git_repo === false)).toBe(true);
  });

  it('PUT /api/repos/:id — updates repo name', async () => {
    const res = await req(app, `/api/repos/${repoId}`, {
      method: 'PUT',
      body: { name: 'renamed-repo' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('renamed-repo');
  });

  it('PUT /api/repos/:id — 400 when name is blank', async () => {
    const res = await req(app, `/api/repos/${repoId}`, {
      method: 'PUT',
      body: { name: '   ' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name is required/i);
  });

  it('GET /api/repos/discovered — returns repos with a .git directory under reposDir', async () => {
    const discoveredRoot = join(TEST_DATA_DIR, 'repos', 'discovered-repo', '.git');
    mkdirSync(discoveredRoot, { recursive: true });

    const res = await req(app, '/api/repos/discovered');
    expect(res.status).toBe(200);
    const repos = await res.json();
    expect(repos.some((repo: { name: string }) => repo.name === 'discovered-repo')).toBe(true);
  });

  // ── Sessions ─────────────────────────────────────────────────────────────
  describe('Sessions', () => {
    let sessionId = 0;
    let repoMdFileId = 0;
    let sessionMdFileId = 0;

    it('GET /api/repos/:id/sessions — returns empty array', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions`);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(0);
    });

    it('POST /api/repos/:id/sessions — 400 when name is missing', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { agentType: 'claude' },
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/repos/:id/sessions — 400 when agentType is missing', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { name: 'my-session' },
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/repos/:id/sessions — 201 with valid body', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { name: 'dev session', agentType: 'claude' },
      });
      expect(res.status).toBe(201);
      const session = await res.json();
      expect(session.id).toBeGreaterThan(0);
      expect(session.name).toBe('dev session');
      expect(session.agent_type).toBe('claude');
      expect(session.status).toBe('stopped');
      expect(session.repo_id).toBe(repoId);
      sessionId = session.id;
    });

    it('POST /api/repos/:id/sessions — 400 when credential belongs to a different agent', async () => {
      const credRes = await req(app, '/api/credentials', {
        method: 'POST',
        body: {
          name: 'copilot-only',
          agentType: 'copilot',
          data: { envVars: {} },
        },
      });
      expect(credRes.status).toBe(201);
      const credential = await credRes.json();

      const res = await req(app, `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { name: 'bad credential match', agentType: 'claude', credentialId: credential.id },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/does not match/i);
    });

    it('POST /api/repos/:id/sessions — 400 for unknown agent type', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { name: 'bad session', agentType: 'unknown-agent' },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/unknown agent type/i);
    });

    it('GET /api/repos/:id/sessions — session appears in list', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions`);
      const sessions = await res.json();
      expect(sessions.some((s: { id: number }) => s.id === sessionId)).toBe(true);
    });

    it('GET /api/repos/:id/md-refs — returns empty repo refs initially', async () => {
      const res = await req(app, `/api/repos/${repoId}/md-refs`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('GET /api/repos/:id/sessions/:sid/md-refs — returns empty session refs initially', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions/${sessionId}/md-refs`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('PUT repo and session md-refs — stores references', async () => {
      const repoFileRes = await req(app, '/api/mdfiles', {
        method: 'POST',
        body: { scope: 'central', filename: 'repo-context', content: '# Repo Context', type: 'instruction' },
      });
      expect(repoFileRes.status).toBe(201);
      repoMdFileId = (await repoFileRes.json()).id;

      const sessionFileRes = await req(app, '/api/mdfiles', {
        method: 'POST',
        body: { scope: 'central', filename: 'session-context', content: '# Session Context', type: 'instruction' },
      });
      expect(sessionFileRes.status).toBe(201);
      sessionMdFileId = (await sessionFileRes.json()).id;

      const repoRefRes = await req(app, `/api/repos/${repoId}/md-refs`, {
        method: 'PUT',
        body: { mdFileIds: [repoMdFileId] },
      });
      expect(repoRefRes.status).toBe(200);
      expect((await repoRefRes.json()).ok).toBe(true);

      const sessionRefRes = await req(app, `/api/repos/${repoId}/sessions/${sessionId}/md-refs`, {
        method: 'PUT',
        body: { mdFileIds: [sessionMdFileId] },
      });
      expect(sessionRefRes.status).toBe(200);
      expect((await sessionRefRes.json()).ok).toBe(true);

      const repoRefs = await req(app, `/api/repos/${repoId}/md-refs`);
      expect((await repoRefs.json()).map((file: { id: number }) => file.id)).toEqual([repoMdFileId]);

      const sessionRefs = await req(app, `/api/repos/${repoId}/sessions/${sessionId}/md-refs`);
      expect((await sessionRefs.json()).map((file: { id: number }) => file.id)).toEqual([sessionMdFileId]);
    });

    it('PUT /api/repos/:id/sessions/:sid — updates session name', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions/${sessionId}`, {
        method: 'PUT',
        body: { name: 'renamed session' },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).name).toBe('renamed session');
    });

    it('PUT /api/repos/:id/sessions/:sid — 400 when name is blank', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions/${sessionId}`, {
        method: 'PUT',
        body: { name: '  ' },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/name is required/i);
    });

    it('POST /api/repos/:id/sessions/:sid/inject — 404 when session is not running', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions/${sessionId}/inject`, {
        method: 'POST',
        body: { text: 'hello' },
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/not running/i);
    });

    it('POST /api/repos/:id/sessions/:sid/restart — resets session to stopped', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions/${sessionId}/restart`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const session = await res.json();
      expect(session.status).toBe('stopped');
      expect(session.state).toBe('stopped');
    });

    it('POST /api/repos/:id/sessions/:sid/restart — 404 for mismatched repo/session pair', async () => {
      mkdirSync(join(TEST_DATA_DIR, 'other-repo'), { recursive: true });
      const otherRepoRes = await req(app, '/api/repos', {
        method: 'POST',
        body: { path: join(TEST_DATA_DIR, 'other-repo'), name: 'other-repo' },
      });
      expect(otherRepoRes.status).toBe(201);
      const otherRepoId = (await otherRepoRes.json()).id;

      const res = await req(app, `/api/repos/${otherRepoId}/sessions/${sessionId}/restart`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/does not belong to repo/i);

      await req(app, `/api/repos/${otherRepoId}`, { method: 'DELETE' });
    });

    it('DELETE /api/repos/:id/sessions/:sid — 200 with ok', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it('GET /api/repos/:id/sessions — session gone after delete', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions`);
      const sessions = await res.json();
      expect(sessions.some((s: { id: number }) => s.id === sessionId)).toBe(false);
    });

    it('DELETE /api/repos/:id/sessions/:sid — 404 for non-existent session', async () => {
      const res = await req(app, `/api/repos/${repoId}/sessions/99999`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  it('DELETE /api/repos/:id — 200 with ok', async () => {
    const res = await req(app, `/api/repos/${repoId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DELETE /api/repos/:id — 404 when repo does not exist', async () => {
    const res = await req(app, '/api/repos/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('GET /api/repos — repo is gone after delete', async () => {
    const res = await req(app, '/api/repos');
    const repos = await res.json();
    expect(repos.some((r: { id: number }) => r.id === repoId)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Credentials
// ══════════════════════════════════════════════════════════════════════════
describe('Credentials API', () => {
  let credId = 0;

  it('GET /api/credentials — returns array', async () => {
    const res = await req(app, '/api/credentials');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/credentials — 400 when name is empty', async () => {
    const res = await req(app, '/api/credentials', {
      method: 'POST',
      body: { name: '', agentType: 'claude', data: { envVars: {} } },
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/credentials — 400 when agentType is missing', async () => {
    const res = await req(app, '/api/credentials', {
      method: 'POST',
      body: { name: 'cred', data: { envVars: {} } },
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/credentials — 201 with valid body', async () => {
    const res = await req(app, '/api/credentials', {
      method: 'POST',
      body: {
        name: 'my-claude-key',
        agentType: 'claude',
        data: { envVars: { ANTHROPIC_API_KEY: 'sk-test-1234' } },
      },
    });
    expect(res.status).toBe(201);
    const cred = await res.json();
    expect(cred.id).toBeGreaterThan(0);
    expect(cred.name).toBe('my-claude-key');
    expect(cred.agent_type).toBe('claude');
    // Sensitive data must never be returned
    expect(cred.encrypted_data).toBeUndefined();
    credId = cred.id;
  });

  it('GET /api/credentials — credential appears in list', async () => {
    const res = await req(app, '/api/credentials');
    const creds = await res.json();
    expect(creds.some((c: { id: number }) => c.id === credId)).toBe(true);
  });

  it('PUT /api/credentials/:id — updates name and agent type metadata', async () => {
    const res = await req(app, `/api/credentials/${credId}`, {
      method: 'PUT',
      body: {
        name: 'updated-credential',
        agentType: 'claude',
        data: { envVars: { ANTHROPIC_API_KEY: 'sk-updated' } },
      },
    });
    expect(res.status).toBe(200);
    const credential = await res.json();
    expect(credential.id).toBe(credId);
    expect(credential.name).toBe('updated-credential');
    expect(credential.agent_type).toBe('claude');
  });

  it('PUT /api/credentials/:id — 400 when required fields are missing', async () => {
    const res = await req(app, `/api/credentials/${credId}`, {
      method: 'PUT',
      body: { name: '', agentType: 'claude', data: { envVars: {} } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name and agentType are required/i);
  });

  it('PUT /api/credentials/:id — 404 for non-existent credential', async () => {
    const res = await req(app, '/api/credentials/99999', {
      method: 'PUT',
      body: { name: 'missing', agentType: 'claude', data: { envVars: {} } },
    });
    expect(res.status).toBe(404);
  });

  it('list response never includes encrypted_data', async () => {
    const res = await req(app, '/api/credentials');
    for (const c of await res.json()) {
      expect(c.encrypted_data).toBeUndefined();
    }
  });

  it('DELETE /api/credentials/:id — 200 with ok', async () => {
    const res = await req(app, `/api/credentials/${credId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DELETE /api/credentials/:id — 404 when credential does not exist', async () => {
    const res = await req(app, '/api/credentials/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('GET /api/credentials — credential gone after delete', async () => {
    const res = await req(app, '/api/credentials');
    const creds = await res.json();
    expect(creds.some((c: { id: number }) => c.id === credId)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MD Files
// ══════════════════════════════════════════════════════════════════════════
describe('MD Files API', () => {
  let fileId = 0;
  let repoId = 0;
  let repoPath = '';

  beforeAll(async () => {
    repoPath = join(TEST_DATA_DIR, 'md-repo');
    mkdirSync(repoPath, { recursive: true });

    const res = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'md-repo' },
    });
    repoId = (await res.json()).id;
  });

  it('GET /api/mdfiles — returns array', async () => {
    const res = await req(app, '/api/mdfiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/mdfiles — 201 creating a central skill file', async () => {
    const res = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'central',
        filename: 'my-skill',
        content: '# My Skill\n\nHello world.',
        type: 'skill',
      },
    });
    expect(res.status).toBe(201);
    const file = await res.json();
    expect(file.id).toBeGreaterThan(0);
    expect(file.scope).toBe('central');
    expect(file.type).toBe('skill');
    expect(file.path).toMatch(/my-skill\.md$/);
    fileId = file.id;
  });

  it('GET /api/mdfiles/:id — returns file with content', async () => {
    const res = await req(app, `/api/mdfiles/${fileId}`);
    expect(res.status).toBe(200);
    const file = await res.json();
    expect(file.id).toBe(fileId);
    expect(file.content).toBe('# My Skill\n\nHello world.');
  });

  it('GET /api/mdfiles?scope=central — filters by scope', async () => {
    const res = await req(app, '/api/mdfiles?scope=central');
    expect(res.status).toBe(200);
    const files = await res.json();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f: { scope: string }) => f.scope === 'central')).toBe(true);
  });

  it('GET /api/mdfiles?scope=repo&repoId=:id — includes repo files created via API', async () => {
    // Create a repo-scoped file via the API
    const createRes = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'repo', repoPath, filename: 'repo-notes.md', content: '# Repo Notes', type: 'other' },
    });
    expect(createRes.status).toBe(201);

    const res = await req(app, `/api/mdfiles?scope=repo&repoId=${repoId}`);
    expect(res.status).toBe(200);
    const files = await res.json();
    expect(files.some((file: { path: string }) => file.path.endsWith('repo-notes.md'))).toBe(true);
  });

  it('PUT /api/mdfiles/:id — updates content on disk and DB', async () => {
    const res = await req(app, `/api/mdfiles/${fileId}`, {
      method: 'PUT',
      body: { content: '# Updated\n\nNew content.' },
    });
    expect(res.status).toBe(200);
    const file = await res.json();
    expect(file.id).toBe(fileId);
  });

  it('GET /api/mdfiles/:id — reflects updated content after PUT', async () => {
    const res = await req(app, `/api/mdfiles/${fileId}`);
    expect((await res.json()).content).toBe('# Updated\n\nNew content.');
  });

  it('POST /api/mdfiles — auto-appends .md extension when missing', async () => {
    const res = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: 'no-ext', content: 'hi', type: 'other' },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).path).toMatch(/\.md$/);
  });

  it('POST /api/mdfiles — keeps .md when already present', async () => {
    const res = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'central',
        filename: 'explicit.md',
        content: 'content',
        type: 'other',
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).path).toMatch(/explicit\.md$/);
  });

  it('POST /api/mdfiles — 400 for dot-prefixed filename (.hidden)', async () => {
    const res = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: '.hidden', content: 'x', type: 'other' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid filename/i);
  });

  it('POST /api/mdfiles — 400 when repo scope is missing repoPath', async () => {
    const res = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'repo', filename: 'repo-file', content: 'x', type: 'other' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/repopath is required/i);
  });

  it('GET /api/mdfiles/:id — 404 for non-existent id', async () => {
    const res = await req(app, '/api/mdfiles/99999');
    expect(res.status).toBe(404);
  });

  it('PUT /api/mdfiles/:id — 404 for non-existent id', async () => {
    const res = await req(app, '/api/mdfiles/99999', {
      method: 'PUT',
      body: { content: 'nope' },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/mdfiles/:id — 200 with ok', async () => {
    const res = await req(app, `/api/mdfiles/${fileId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('GET /api/mdfiles/:id — 404 after delete', async () => {
    const res = await req(app, `/api/mdfiles/${fileId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/mdfiles/:id — 404 for non-existent id', async () => {
    const res = await req(app, '/api/mdfiles/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Settings
// ══════════════════════════════════════════════════════════════════════════
describe('Settings API', () => {
  it('GET /api/settings — returns current settings', async () => {
    const res = await req(app, '/api/settings');
    expect(res.status).toBe(200);
    const settings = await res.json();
    expect(settings.reposDir).toBe(join(TEST_DATA_DIR, 'repos'));
    expect(settings.centralMdDir).toBe(join(TEST_DATA_DIR, 'central'));
  });

  it('PUT /api/settings — updates reposDir, centralMdDir and auth settings', async () => {
    const nextReposDir = join(TEST_DATA_DIR, 'alt-repos');
    const nextCentralMdDir = join(TEST_DATA_DIR, 'alt-central');
    const res = await req(app, '/api/settings', {
      method: 'PUT',
      body: {
        reposDir: nextReposDir,
        centralMdDir: nextCentralMdDir,
        auth: { enabled: true, pin: 'MTIzNA==' },
      },
    });
    expect(res.status).toBe(200);
    const settings = await res.json();
    expect(settings.reposDir).toBe(nextReposDir);
    expect(settings.centralMdDir).toBe(nextCentralMdDir);
    expect(settings.auth).toEqual({ enabled: true, pin: 'MTIzNA==' });

    const readBack = await req(app, '/api/settings');
    expect(readBack.status).toBe(200);
    const persisted = await readBack.json();
    expect(persisted.reposDir).toBe(nextReposDir);
    expect(persisted.centralMdDir).toBe(nextCentralMdDir);
    expect(persisted.auth).toEqual({ enabled: true, pin: 'MTIzNA==' });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Pipeline
// ══════════════════════════════════════════════════════════════════════════
describe('Pipeline API', () => {
  it('GET /api/pipeline — lists registered nodes', async () => {
    const res = await req(app, '/api/pipeline');
    expect(res.status).toBe(200);
    const nodes = await res.json();
    expect(nodes.some((node: { id: string }) => node.id === 'token-usage')).toBe(true);
  });

  it('PUT /api/pipeline/:id — toggles a node', async () => {
    const res = await req(app, '/api/pipeline/token-usage', {
      method: 'PUT',
      body: { enabled: false },
    });
    expect(res.status).toBe(200);
    const nodes = await res.json();
    expect(nodes.find((node: { id: string; enabled: boolean }) => node.id === 'token-usage')?.enabled).toBe(false);
  });

  it('PUT /api/pipeline/:id — 400 when enabled is not boolean', async () => {
    const res = await req(app, '/api/pipeline/token-usage', {
      method: 'PUT',
      body: { enabled: 'nope' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/must be a boolean/i);
  });

  it('PUT /api/pipeline/:id — 404 for unknown node', async () => {
    const res = await req(app, '/api/pipeline/missing-node', {
      method: 'PUT',
      body: { enabled: true },
    });
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Usage
// ══════════════════════════════════════════════════════════════════════════
describe('Usage API', () => {
  let repoId = 0;

  beforeAll(async () => {
    const repoPath = join(TEST_DATA_DIR, 'usage-repo');
    mkdirSync(repoPath, { recursive: true });
    const res = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'usage-repo' },
    });
    repoId = (await res.json()).id;
  });

  it('GET /api/usage — returns a summary envelope', async () => {
    const res = await req(app, '/api/usage');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repo_id).toBeNull();
    expect(body).toHaveProperty('totals');
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(Array.isArray(body.by_agent)).toBe(true);
    expect(Array.isArray(body.by_credential)).toBe(true);
  });

  it('GET /api/usage?repoId=:id — scopes the summary to a repo', async () => {
    const res = await req(app, `/api/usage?repoId=${repoId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).repo_id).toBe(repoId);
  });

  it('GET /api/usage?repoId=:id — 404 for non-existent repo', async () => {
    const res = await req(app, '/api/usage?repoId=99999');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/repo 99999 not found/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Tools
// ══════════════════════════════════════════════════════════════════════════
describe('Tools API', () => {
  it('GET /api/tools — returns tool install status for all agents', async () => {
    const res = await req(app, '/api/tools');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(typeof body.anyMissing).toBe('boolean');
    expect(body.tools.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Automation
// ══════════════════════════════════════════════════════════════════════════
describe('Automation API', () => {
  let repoId = 0;
  let sessionId = 0;
  let mdFileId = 0;
  let taskId = 0;

  beforeAll(async () => {
    const repoPath = join(TEST_DATA_DIR, 'automation-repo');
    mkdirSync(repoPath, { recursive: true });

    const repoRes = await req(app, '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'automation-repo' },
    });
    repoId = (await repoRes.json()).id;

    const sessionRes = await req(app, `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: { name: 'automation-session', agentType: 'claude' },
    });
    sessionId = (await sessionRes.json()).id;

    const mdFileRes = await req(app, '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: 'automation-template', content: 'Run this template', type: 'prompt' },
    });
    mdFileId = (await mdFileRes.json()).id;
  });

  it('GET /api/automation — returns an array', async () => {
    const res = await req(app, '/api/automation');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/automation — creates a scheduled task', async () => {
    const res = await req(app, '/api/automation', {
      method: 'POST',
      body: {
        name: 'Daily summary',
        md_file_id: mdFileId,
        session_id: sessionId,
        cron: '0 * * * *',
        params: { audience: 'team' },
      },
    });
    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task.name).toBe('Daily summary');
    expect(task.enabled).toBe(1);
    taskId = task.id;
  });

  it('POST /api/automation — 400 for invalid cron', async () => {
    const res = await req(app, '/api/automation', {
      method: 'POST',
      body: {
        name: 'Bad cron',
        md_file_id: mdFileId,
        session_id: sessionId,
        cron: 'not-a-cron',
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid cron/i);
  });

  it('PUT /api/automation/:id/pause — disables a task', async () => {
    const res = await req(app, `/api/automation/${taskId}/pause`, { method: 'PUT' });
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(0);
  });

  it('PUT /api/automation/:id/resume — re-enables a task', async () => {
    const res = await req(app, `/api/automation/${taskId}/resume`, { method: 'PUT' });
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(1);
  });

  it('PUT /api/automation/:id/pause — 404 for unknown task', async () => {
    const res = await req(app, '/api/automation/99999/pause', { method: 'PUT' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/automation/:id — deletes a task', async () => {
    const res = await req(app, `/api/automation/${taskId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DELETE /api/automation/:id — 404 for unknown task', async () => {
    const res = await req(app, '/api/automation/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
