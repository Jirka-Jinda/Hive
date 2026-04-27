import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { req, setupApiTestApp, testPaths } from './api-test-support';

const getApp = setupApiTestApp();

describe('Settings API', () => {
  it('GET /api/settings — returns current settings', async () => {
    const res = await req(getApp(), '/api/settings');
    expect(res.status).toBe(200);
    const settings = await res.json();
    expect(settings.reposDir).toBe(join(testPaths.root, 'repos'));
    expect(settings.centralMdDir).toBe(join(testPaths.root, 'central'));
  });

  it('PUT /api/settings — updates reposDir, centralMdDir and auth settings', async () => {
    const nextReposDir = join(testPaths.root, 'alt-repos');
    const nextCentralMdDir = join(testPaths.root, 'alt-central');
    const res = await req(getApp(), '/api/settings', {
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

    const readBack = await req(getApp(), '/api/settings');
    expect(readBack.status).toBe(200);
    const persisted = await readBack.json();
    expect(persisted.reposDir).toBe(nextReposDir);
    expect(persisted.centralMdDir).toBe(nextCentralMdDir);
    expect(persisted.auth).toEqual({ enabled: true, pin: 'MTIzNA==' });
  });
});

describe('Pipeline API', () => {
  it('GET /api/pipeline — lists registered nodes', async () => {
    const res = await req(getApp(), '/api/pipeline');
    expect(res.status).toBe(200);
    const nodes = await res.json();
    expect(nodes.some((node: { id: string }) => node.id === 'token-usage')).toBe(true);
  });

  it('PUT /api/pipeline/:id — toggles a node', async () => {
    const res = await req(getApp(), '/api/pipeline/token-usage', {
      method: 'PUT',
      body: { enabled: false },
    });
    expect(res.status).toBe(200);
    const nodes = await res.json();
    expect(nodes.find((node: { id: string; enabled: boolean }) => node.id === 'token-usage')?.enabled).toBe(false);
  });

  it('PUT /api/pipeline/:id — 400 when enabled is not boolean', async () => {
    const res = await req(getApp(), '/api/pipeline/token-usage', {
      method: 'PUT',
      body: { enabled: 'nope' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/must be a boolean/i);
  });

  it('PUT /api/pipeline/:id — 404 for unknown node', async () => {
    const res = await req(getApp(), '/api/pipeline/missing-node', {
      method: 'PUT',
      body: { enabled: true },
    });
    expect(res.status).toBe(404);
  });
});

describe('Usage API', () => {
  let repoId = 0;

  beforeAll(async () => {
    const repoPath = join(testPaths.root, 'usage-api-repo');
    mkdirSync(repoPath, { recursive: true });
    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'usage-repo' },
    });
    repoId = (await res.json()).id;
  });

  it('GET /api/usage — returns a summary envelope', async () => {
    const res = await req(getApp(), '/api/usage');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repo_id).toBeNull();
    expect(body).toHaveProperty('totals');
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(Array.isArray(body.by_agent)).toBe(true);
    expect(Array.isArray(body.by_credential)).toBe(true);
  });

  it('GET /api/usage?repoId=:id — scopes the summary to a repo', async () => {
    const res = await req(getApp(), `/api/usage?repoId=${repoId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).repo_id).toBe(repoId);
  });

  it('GET /api/usage?repoId=:id — 404 for non-existent repo', async () => {
    const res = await req(getApp(), '/api/usage?repoId=99999');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/repo 99999 not found/i);
  });
});

describe('Tools API', () => {
  it('GET /api/tools — returns tool install status for all agents', async () => {
    const res = await req(getApp(), '/api/tools');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(typeof body.anyMissing).toBe('boolean');
    expect(body.tools.length).toBeGreaterThan(0);
  });
});