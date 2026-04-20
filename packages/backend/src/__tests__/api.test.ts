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
import { MdFileManager } from '../services/mdfile-manager';
import { SettingsService } from '../services/settings-service';
import { SessionStore } from '../services/session-store';
import { RepoManager } from '../services/repo-manager';
import { CredentialStore } from '../services/credential-store';
import { MdRefService } from '../services/md-ref-service';
import { WorkspaceService } from '../application/workspace-service';

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

  const app = new Hono();
  app.get('/api/health', (c) =>
    c.json({ status: 'ok', timestamp: new Date().toISOString() })
  );
  app.route('/api/repos', reposRouter(workspace, mdRefService));
  app.route('/api/credentials', credentialsRouter(credentialStore));
  app.route('/api/agents', agentsRouter());
  app.route('/api/mdfiles', mdfilesRouter(mdMgr));
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

  it('includes chatgpt and copilot agents', async () => {
    const res = await req(app, '/api/agents');
    const ids = (await res.json()).map((a: { id: string }) => a.id);
    expect(ids).toContain('chatgpt');
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
    repoId = repo.id;
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
    expect(repos.some((r: { id: number }) => r.id === repoId)).toBe(true);
  });

  // ── Sessions ─────────────────────────────────────────────────────────────
  describe('Sessions', () => {
    let sessionId = 0;

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
