import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { req, setupApiTestApp, testPaths } from './api-test-support';

const getApp = setupApiTestApp();

describe('Automation API', () => {
  let repoId = 0;
  let sessionId = 0;
  let mdFileId = 0;
  let taskId = 0;

  beforeAll(async () => {
    const repoPath = join(testPaths.root, 'automation-api-repo');
    mkdirSync(repoPath, { recursive: true });

    const repoRes = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'automation-repo' },
    });
    repoId = (await repoRes.json()).id;

    const sessionRes = await req(getApp(), `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: { name: 'automation-session', agentType: 'claude' },
    });
    sessionId = (await sessionRes.json()).id;

    const mdFileRes = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: 'automation-template-api', content: 'Run this template', type: 'prompt' },
    });
    mdFileId = (await mdFileRes.json()).id;
  });

  it('GET /api/automation — returns an array', async () => {
    const res = await req(getApp(), '/api/automation');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/automation — creates a scheduled task', async () => {
    const res = await req(getApp(), '/api/automation', {
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
    const res = await req(getApp(), '/api/automation', {
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
    const res = await req(getApp(), `/api/automation/${taskId}/pause`, { method: 'PUT' });
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(0);
  });

  it('PUT /api/automation/:id/resume — re-enables a task', async () => {
    const res = await req(getApp(), `/api/automation/${taskId}/resume`, { method: 'PUT' });
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(1);
  });

  it('PUT /api/automation/:id/pause — 404 for unknown task', async () => {
    const res = await req(getApp(), '/api/automation/99999/pause', { method: 'PUT' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/automation/:id — deletes a task', async () => {
    const res = await req(getApp(), `/api/automation/${taskId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DELETE /api/automation/:id — 404 for unknown task', async () => {
    const res = await req(getApp(), '/api/automation/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});