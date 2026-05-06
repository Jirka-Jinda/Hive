import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { req, setupApiTestApp, testPaths } from './api-test-support';

const getApp = setupApiTestApp();

describe('Changes API', () => {
  let repoId = 0;
  let repoPath = '';
  let sessionId = 0;
  let taskId = 0;

  beforeAll(async () => {
    repoPath = join(testPaths.root, 'changes-api-repo');
    mkdirSync(repoPath, { recursive: true });

    const repoRes = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'changes-repo' },
    });
    repoId = (await repoRes.json()).id as number;

    const sessionRes = await req(getApp(), `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: { name: 'changes-session', agentType: 'claude' },
    });
    sessionId = (await sessionRes.json()).id as number;
  });

  it('records markdown create and update events in the change feed', async () => {
    const createRes = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'repo', repoPath, filename: 'changes-notes.md', content: '# Initial', type: 'instruction' },
    });
    expect(createRes.status).toBe(201);
    const fileId = (await createRes.json()).id as number;

    const updateRes = await req(getApp(), `/api/mdfiles/${fileId}`, {
      method: 'PUT',
      body: { content: '# Updated' },
    });
    expect(updateRes.status).toBe(200);

    const changesRes = await req(getApp(), `/api/changes?repoId=${repoId}`);
    expect(changesRes.status).toBe(200);
    const changes = await changesRes.json() as Array<{ event_type: string; title: string }>;
    expect(changes.some((event) => event.event_type === 'mdfile-created' && /Created changes-notes.md/.test(event.title))).toBe(true);
    expect(changes.some((event) => event.event_type === 'mdfile-updated' && /Updated changes-notes.md/.test(event.title))).toBe(true);
  });

  it('records restore events in the change feed', async () => {
    const createRes = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'repo', repoPath, filename: 'restore-notes.md', content: '# v1', type: 'instruction' },
    });
    const fileId = (await createRes.json()).id as number;

    const updateRes = await req(getApp(), `/api/mdfiles/${fileId}`, {
      method: 'PUT',
      body: { content: '# v2' },
    });
    expect(updateRes.status).toBe(200);

    const revisionsRes = await req(getApp(), `/api/mdfiles/${fileId}/revisions`);
    const revisions = await revisionsRes.json() as Array<{ id: number; content: string }>;
    const firstRevision = revisions.find((revision) => revision.content === '# v1');
    expect(firstRevision).toBeTruthy();

    const restoreRes = await req(getApp(), `/api/mdfiles/${fileId}/revisions/${firstRevision!.id}/restore`, {
      method: 'POST',
    });
    expect(restoreRes.status).toBe(200);

    const changesRes = await req(getApp(), `/api/changes?repoId=${repoId}`);
    expect(changesRes.status).toBe(200);
    const changes = await changesRes.json() as Array<{ event_type: string; title: string }>;
    expect(changes.some((event) => event.event_type === 'mdfile-restored' && /Restored restore-notes.md/.test(event.title))).toBe(true);
  });

  it('rejects invalid change-feed limits', async () => {
    const zeroLimitRes = await req(getApp(), '/api/changes?limit=0');
    expect(zeroLimitRes.status).toBe(400);

    const hugeLimitRes = await req(getApp(), '/api/changes?limit=5000');
    expect(hugeLimitRes.status).toBe(400);
  });

  it('records automation failures in the change feed', async () => {
    const mdFileRes = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: { scope: 'central', filename: 'changes-automation.md', content: 'Run me', type: 'prompt' },
    });
    const mdFileId = (await mdFileRes.json()).id as number;

    const taskRes = await req(getApp(), '/api/automation', {
      method: 'POST',
      body: { name: 'Changes Task', md_file_id: mdFileId, session_id: sessionId, cron: '0 * * * *' },
    });
    taskId = (await taskRes.json()).id as number;

    const runRes = await req(getApp(), `/api/automation/${taskId}/run`, { method: 'POST' });
    expect(runRes.status).toBe(200);

    const changesRes = await req(getApp(), `/api/changes?sessionId=${sessionId}`);
    expect(changesRes.status).toBe(200);
    const changes = await changesRes.json() as Array<{ event_type: string; title: string }>;
    expect(changes.some((event) => event.event_type === 'automation-failed' && /Changes Task/.test(event.title))).toBe(true);
  });
});
