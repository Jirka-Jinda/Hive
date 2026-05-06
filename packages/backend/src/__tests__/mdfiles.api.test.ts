import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { req, setupApiTestApp, testPaths } from './api-test-support';

const getApp = setupApiTestApp();

describe('MD Files API', () => {
  let fileId = 0;
  let repoId = 0;
  let repoPath = '';
  let sessionId = 0;
  let otherRepoId = 0;
  let otherRepoPath = '';

  beforeAll(async () => {
    repoPath = join(testPaths.root, 'mdfiles-repo');
    mkdirSync(repoPath, { recursive: true });

    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'md-repo' },
    });
    repoId = (await res.json()).id;

    const sessionRes = await req(getApp(), `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: { name: 'md-session', agentType: 'claude' },
    });
    sessionId = (await sessionRes.json()).id;

    otherRepoPath = join(testPaths.root, 'mdfiles-other-repo');
    mkdirSync(otherRepoPath, { recursive: true });

    const otherRes = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: otherRepoPath, name: 'md-other-repo' },
    });
    otherRepoId = (await otherRes.json()).id;
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

  it('POST /api/mdfiles — 201 creating a session draft file', async () => {
    const res = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'session',
        sessionId,
        filename: 'branch-notes.md',
        content: '# Branch Notes',
        type: 'other',
      },
    });
    expect(res.status).toBe(201);
    const file = await res.json();
    expect(file.scope).toBe('session');
    expect(file.session_id).toBe(sessionId);
    expect(file.repo_id).toBe(repoId);
  });

  it('GET /api/mdfiles?scope=session&sessionId=:id — includes session files created via API', async () => {
    const res = await req(getApp(), `/api/mdfiles?scope=session&sessionId=${sessionId}`);
    expect(res.status).toBe(200);
    const files = await res.json() as { path: string; scope: string; session_id: number }[];
    expect(files.some((file) => file.scope === 'session' && file.session_id === sessionId && file.path === 'branch-notes.md')).toBe(true);
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

  it('GET /api/mdfiles/:id/revisions — lists saved revisions newest first', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}/revisions`);
    expect(res.status).toBe(200);

    const revisions = await res.json() as Array<{ revision_number: number; content: string }>;
    expect(revisions.map((revision) => revision.revision_number)).toEqual([2, 1]);
    expect(revisions[0]?.content).toBe('# Updated\n\nNew content.');
    expect(revisions[1]?.content).toBe('# My Skill\n\nHello world.');
  });

  it('POST /api/mdfiles/:id/revisions/:rid/restore — restores a previous revision', async () => {
    const revisionsRes = await req(getApp(), `/api/mdfiles/${fileId}/revisions`);
    const revisions = await revisionsRes.json() as Array<{ id: number; revision_number: number }>;
    const originalRevision = revisions.find((revision) => revision.revision_number === 1);

    expect(originalRevision).toBeDefined();

    const restoreRes = await req(getApp(), `/api/mdfiles/${fileId}/revisions/${originalRevision!.id}/restore`, {
      method: 'POST',
    });
    expect(restoreRes.status).toBe(200);

    const readRes = await req(getApp(), `/api/mdfiles/${fileId}`);
    expect((await readRes.json()).content).toBe('# My Skill\n\nHello world.');
  });

  it('PUT /api/mdfiles/:id — renames the file and auto-appends .md', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}`, {
      method: 'PUT',
      body: { filename: 'renamed-mdfiles-api' },
    });
    expect(res.status).toBe(200);

    const file = await res.json();
    expect(file.id).toBe(fileId);
    expect(file.path).toMatch(/renamed-mdfiles-api\.md$/);

    const readRes = await req(getApp(), `/api/mdfiles/${fileId}`);
    const updated = await readRes.json();
    expect(updated.path).toMatch(/renamed-mdfiles-api\.md$/);
  });

  it('PUT /api/mdfiles/:id — updates scope and type in place', async () => {
    const res = await req(getApp(), `/api/mdfiles/${fileId}`, {
      method: 'PUT',
      body: { scope: 'repo', repoPath, type: 'tool' },
    });
    expect(res.status).toBe(200);

    const file = await res.json();
    expect(file.id).toBe(fileId);
    expect(file.scope).toBe('repo');
    expect(file.repo_id).toBe(repoId);
    expect(file.type).toBe('tool');

    const repoFilesRes = await req(getApp(), `/api/mdfiles?scope=repo&repoId=${repoId}`);
    const repoFiles = await repoFilesRes.json();
    expect(repoFiles.some((item: { id: number }) => item.id === fileId)).toBe(true);

    const centralFilesRes = await req(getApp(), '/api/mdfiles?scope=central');
    const centralFiles = await centralFilesRes.json();
    expect(centralFiles.some((item: { id: number }) => item.id === fileId)).toBe(false);
  });

  it('PUT /api/mdfiles/:id — removes repo refs from other repos when scope changes to repo', async () => {
    const createRes = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: 'cross-repo-ref.md', content: '# Shared', type: 'instruction' },
    });
    const crossRepoFileId = (await createRes.json()).id as number;

    const linkRes = await req(getApp(), `/api/repos/${otherRepoId}/md-refs`, {
      method: 'PUT',
      body: { mdFileIds: [crossRepoFileId] },
    });
    expect(linkRes.status).toBe(200);

    const moveRes = await req(getApp(), `/api/mdfiles/${crossRepoFileId}`, {
      method: 'PUT',
      body: { scope: 'repo', repoPath, type: 'instruction' },
    });
    expect(moveRes.status).toBe(200);

    const otherRepoRefsRes = await req(getApp(), `/api/repos/${otherRepoId}/md-refs`);
    const otherRepoRefs = await otherRepoRefsRes.json();
    expect(otherRepoRefs.some((item: { id: number }) => item.id === crossRepoFileId)).toBe(false);
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

  it('POST /api/mdfiles — 400 when session scope is missing sessionId', async () => {
    const res = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'session', filename: 'session-file', content: 'x', type: 'other' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sessionid is required/i);
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