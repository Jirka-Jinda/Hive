import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { req, setupApiTestApp, testPaths } from './api-test-support';

const getApp = setupApiTestApp();

describe('MD Files API', () => {
  let fileId = 0;
  let repoId = 0;
  let repoPath = '';

  beforeAll(async () => {
    repoPath = join(testPaths.root, 'mdfiles-repo');
    mkdirSync(repoPath, { recursive: true });

    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'md-repo' },
    });
    repoId = (await res.json()).id;
  });

  it('GET /api/mdfiles — returns array', async () => {
    const res = await req(getApp(), '/api/mdfiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/mdfiles — 201 creating a central skill file', async () => {
    const res = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'central',
        filename: 'my-skill-mdfiles-api',
        content: '# My Skill\n\nHello world.',
        type: 'skill',
      },
    });
    expect(res.status).toBe(201);
    const file = await res.json();
    expect(file.id).toBeGreaterThan(0);
    expect(file.scope).toBe('central');
    expect(file.type).toBe('skill');
    expect(file.path).toMatch(/my-skill-mdfiles-api\.md$/);
    fileId = file.id;
  });

  it('GET /api/mdfiles/:id — returns file with content', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}`);
    expect(res.status).toBe(200);
    const file = await res.json();
    expect(file.id).toBe(fileId);
    expect(file.content).toBe('# My Skill\n\nHello world.');
  });

  it('GET /api/mdfiles?scope=central — filters by scope', async () => {
    const res = await req(getApp(), '/api/mdfiles?scope=central');
    expect(res.status).toBe(200);
    const files = await res.json();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file: { scope: string }) => file.scope === 'central')).toBe(true);
  });

  it('GET /api/mdfiles?scope=repo&repoId=:id — includes repo files created via API', async () => {
    const createRes = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'repo', repoPath, filename: 'repo-notes-mdfiles-api.md', content: '# Repo Notes', type: 'other' },
    });
    expect(createRes.status).toBe(201);

    const res = await req(getApp(), `/api/mdfiles?scope=repo&repoId=${repoId}`);
    expect(res.status).toBe(200);
    const files = await res.json();
    expect(files.some((file: { path: string }) => file.path.endsWith('repo-notes-mdfiles-api.md'))).toBe(true);
  });

  it('PUT /api/mdfiles/:id — updates content on disk and DB', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}`, {
      method: 'PUT',
      body: { content: '# Updated\n\nNew content.' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(fileId);
  });

  it('GET /api/mdfiles/:id — reflects updated content after PUT', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}`);
    expect((await res.json()).content).toBe('# Updated\n\nNew content.');
  });

  it('POST /api/mdfiles — auto-appends .md extension when missing', async () => {
    const res = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: 'no-ext-mdfiles-api', content: 'hi', type: 'other' },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).path).toMatch(/\.md$/);
  });

  it('POST /api/mdfiles — keeps .md when already present', async () => {
    const res = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'central',
        filename: 'explicit-mdfiles-api.md',
        content: 'content',
        type: 'other',
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).path).toMatch(/explicit-mdfiles-api\.md$/);
  });

  it('POST /api/mdfiles — 400 for dot-prefixed filename (.hidden)', async () => {
    const res = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: '.hidden', content: 'x', type: 'other' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid filename/i);
  });

  it('POST /api/mdfiles — 400 when repo scope is missing repoPath', async () => {
    const res = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'repo', filename: 'repo-file', content: 'x', type: 'other' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/repopath is required/i);
  });

  it('GET /api/mdfiles/:id — 404 for non-existent id', async () => {
    const res = await req(getApp(), '/api/mdfiles/99999');
    expect(res.status).toBe(404);
  });

  it('PUT /api/mdfiles/:id — 404 for non-existent id', async () => {
    const res = await req(getApp(), '/api/mdfiles/99999', {
      method: 'PUT',
      body: { content: 'nope' },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/mdfiles/:id — 200 with ok', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('GET /api/mdfiles/:id — 404 after delete', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/mdfiles/:id — 404 for non-existent id', async () => {
    const res = await req(getApp(), '/api/mdfiles/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});