import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { req, setupApiTestApp, testPaths } from './api-test-support';

const getApp = setupApiTestApp();

describe('Repos API', () => {
  let repoId = 0;
  const repoPath = join(testPaths.root, 'repos-api-local');

  const seedAgentMarkdown = (targetPath: string, label: string) => {
    writeFileSync(join(targetPath, 'AGENTS.md'), `# ${label} Agents`, 'utf8');
    mkdirSync(join(targetPath, '.github'), { recursive: true });
    writeFileSync(join(targetPath, '.github', 'copilot-instructions.md'), `# ${label} Copilot`, 'utf8');
    mkdirSync(join(targetPath, '.agents', 'skills', 'review'), { recursive: true });
    writeFileSync(join(targetPath, '.agents', 'skills', 'review', 'SKILL.md'), `# ${label} Skill`, 'utf8');
    writeFileSync(join(targetPath, 'README.md'), '# Not imported', 'utf8');
  };

  it('GET /api/repos — returns array', async () => {
    const res = await req(getApp(), '/api/repos');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/repos — 400 when neither path nor gitUrl provided', async () => {
    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { name: 'no-path' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeDefined();
  });

  it('POST /api/repos — 400 for non-existent local path', async () => {
    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: '/does-not-exist-xyzzy-12345' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not exist/i);
  });

  it('POST /api/repos — 201 for valid local path', async () => {
    mkdirSync(repoPath, { recursive: true });
    seedAgentMarkdown(repoPath, 'Primary');
    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'test-repo' },
    });
    expect(res.status).toBe(201);
    const repo = await res.json();
    expect(repo.id).toBeGreaterThan(0);
    expect(repo.name).toBe('test-repo');
    expect(repo.source).toBe('local');
    expect(repo.git_url).toBeNull();
    expect(repo.session_count).toBe(0);
    expect(repo.is_git_repo).toBe(false);
    repoId = repo.id;
  });

  it('POST /api/repos — discovers repo-scoped agent markdown files', async () => {
    const res = await req(getApp(), `/api/mdfiles?scope=repo&repoId=${repoId}`);
    expect(res.status).toBe(200);
    const files = await res.json() as { path: string; type: string }[];

    expect(files.map((file) => file.path)).toEqual([
      '.agents/skills/review/SKILL.md',
      '.github/copilot-instructions.md',
      'AGENTS.md',
    ]);
    expect(files.find((file) => file.path === '.agents/skills/review/SKILL.md')?.type).toBe('skill');
    expect(files.find((file) => file.path === '.github/copilot-instructions.md')?.type).toBe('instruction');
    expect(files.some((file) => file.path === 'README.md')).toBe(false);
  });

  it('POST /api/repos — allows the same discovered path in another repo', async () => {
    const duplicateRepoPath = join(testPaths.root, 'repos-api-duplicate-agent-paths');
    mkdirSync(duplicateRepoPath, { recursive: true });
    seedAgentMarkdown(duplicateRepoPath, 'Duplicate');

    const createRes = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: duplicateRepoPath, name: 'duplicate-agent-repo' },
    });
    expect(createRes.status).toBe(201);

    const duplicateRepoId = (await createRes.json()).id as number;
    const filesRes = await req(getApp(), `/api/mdfiles?scope=repo&repoId=${duplicateRepoId}`);
    expect(filesRes.status).toBe(200);

    const files = await filesRes.json() as { path: string }[];
    expect(files.some((file) => file.path === 'AGENTS.md')).toBe(true);
  });

  it('GET /api/repos/:id — returns the created repo', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}`);
    expect(res.status).toBe(200);
    const repo = await res.json();
    expect(repo.id).toBe(repoId);
    expect(repo.name).toBe('test-repo');
    expect(repo.session_count).toBe(0);
  });

  it('GET /api/repos/:id — 404 for unknown repo', async () => {
    const res = await req(getApp(), '/api/repos/99999');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/repo 99999 not found/i);
  });

  it('POST /api/repos — 400 for file path instead of directory', async () => {
    const filePath = join(testPaths.root, 'not-a-directory.txt');
    writeFileSync(filePath, 'hello', 'utf8');

    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: filePath, name: 'bad-repo' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a directory/i);
  });

  it('GET /api/repos — newly created repo is in the list', async () => {
    const res = await req(getApp(), '/api/repos');
    const repos = await res.json();
    expect(repos.some((repo: { id: number; is_git_repo: boolean }) => repo.id === repoId && repo.is_git_repo === false)).toBe(true);
  });

  it('PUT /api/repos/:id — updates repo name', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}`, {
      method: 'PUT',
      body: { name: 'renamed-repo' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('renamed-repo');
  });

  it('PUT /api/repos/:id — 400 when name is blank', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}`, {
      method: 'PUT',
      body: { name: '   ' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name is required/i);
  });

  it('GET /api/repos/discovered — returns repos with a .git directory under reposDir', async () => {
    mkdirSync(join(testPaths.reposRoot, 'discovered-repo', '.git'), { recursive: true });
    const res = await req(getApp(), '/api/repos/discovered');
    expect(res.status).toBe(200);
    const repos = await res.json();
    expect(repos.some((repo: { name: string }) => repo.name === 'discovered-repo')).toBe(true);
  });

  it('DELETE /api/repos/:id — removes discovered repo-scoped md files', async () => {
    const cleanupRepoPath = join(testPaths.root, 'repos-api-md-cleanup');
    mkdirSync(cleanupRepoPath, { recursive: true });
    seedAgentMarkdown(cleanupRepoPath, 'Cleanup');

    const createRes = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: cleanupRepoPath, name: 'cleanup-repo' },
    });
    expect(createRes.status).toBe(201);
    const cleanupRepoId = (await createRes.json()).id as number;

    const discoveredRes = await req(getApp(), `/api/mdfiles?scope=repo&repoId=${cleanupRepoId}`);
    const discoveredFiles = await discoveredRes.json() as { id: number }[];
    expect(discoveredFiles.length).toBe(3);

    const deleteRes = await req(getApp(), `/api/repos/${cleanupRepoId}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);

    const repoFilesRes = await req(getApp(), `/api/mdfiles?scope=repo&repoId=${cleanupRepoId}`);
    expect(repoFilesRes.status).toBe(200);
    expect(await repoFilesRes.json()).toEqual([]);

    const allFilesRes = await req(getApp(), '/api/mdfiles');
    const allFiles = await allFilesRes.json() as { id: number }[];
    expect(discoveredFiles.every((file) => allFiles.every((remaining) => remaining.id !== file.id))).toBe(true);
  });

  describe('Sessions', () => {
    let sessionId = 0;
    let repoMdFileId = 0;
    let sessionMdFileId = 0;

    it('GET /api/repos/:id/sessions — returns empty array', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions`);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(0);
    });

    it('POST /api/repos/:id/sessions — 400 when name is missing', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { agentType: 'claude' },
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/repos/:id/sessions — 400 when agentType is missing', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { name: 'my-session' },
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/repos/:id/sessions — 201 with valid body', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions`, {
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

    it('GET /api/repos/:id — reflects the updated session count', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}`);
      expect(res.status).toBe(200);
      expect((await res.json()).session_count).toBe(1);
    });

    it('POST /api/repos/:id/sessions — 400 when credential belongs to a different agent', async () => {
      const credRes = await req(getApp(), '/api/credentials', {
        method: 'POST',
        body: {
          name: 'copilot-only',
          agentType: 'copilot',
          data: { envVars: {} },
        },
      });
      expect(credRes.status).toBe(201);
      const credential = await credRes.json();

      const res = await req(getApp(), `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { name: 'bad credential match', agentType: 'claude', credentialId: credential.id },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/does not match/i);
    });

    it('POST /api/repos/:id/sessions — 400 for unknown agent type', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions`, {
        method: 'POST',
        body: { name: 'bad session', agentType: 'unknown-agent' },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/unknown agent type/i);
    });

    it('GET /api/repos/:id/sessions — session appears in list', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions`);
      const sessions = await res.json();
      expect(sessions.some((session: { id: number }) => session.id === sessionId)).toBe(true);
    });

    it('GET /api/repos/:id/md-refs — returns empty repo refs initially', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/md-refs`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('GET /api/repos/:id/sessions/:sid/md-refs — returns empty session refs initially', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}/md-refs`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('PUT repo and session md-refs — stores references', async () => {
      const repoFileRes = await req(getApp(), '/api/mdfiles', {
        method: 'POST',
        body: { scope: 'central', filename: 'repo-context-repos-api', content: '# Repo Context', type: 'instruction' },
      });
      expect(repoFileRes.status).toBe(201);
      repoMdFileId = (await repoFileRes.json()).id;

      const sessionFileRes = await req(getApp(), '/api/mdfiles', {
        method: 'POST',
        body: { scope: 'central', filename: 'session-context-repos-api', content: '# Session Context', type: 'instruction' },
      });
      expect(sessionFileRes.status).toBe(201);
      sessionMdFileId = (await sessionFileRes.json()).id;

      const repoRefRes = await req(getApp(), `/api/repos/${repoId}/md-refs`, {
        method: 'PUT',
        body: { mdFileIds: [repoMdFileId] },
      });
      expect(repoRefRes.status).toBe(200);
      expect((await repoRefRes.json()).ok).toBe(true);

      const sessionRefRes = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}/md-refs`, {
        method: 'PUT',
        body: { mdFileIds: [sessionMdFileId] },
      });
      expect(sessionRefRes.status).toBe(200);
      expect((await sessionRefRes.json()).ok).toBe(true);

      const repoRefs = await req(getApp(), `/api/repos/${repoId}/md-refs`);
      expect((await repoRefs.json()).map((file: { id: number }) => file.id)).toEqual([repoMdFileId]);

      const sessionRefs = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}/md-refs`);
      expect((await sessionRefs.json()).map((file: { id: number }) => file.id)).toEqual([sessionMdFileId]);
    });

    it('PUT /api/repos/:id/sessions/:sid — updates session name', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}`, {
        method: 'PUT',
        body: { name: 'renamed session' },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).name).toBe('renamed session');
    });

    it('PUT /api/repos/:id/sessions/:sid — 400 when name is blank', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}`, {
        method: 'PUT',
        body: { name: '  ' },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/name is required/i);
    });

    it('POST /api/repos/:id/sessions/:sid/inject — 404 when session is not running', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}/inject`, {
        method: 'POST',
        body: { text: 'hello' },
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/not running/i);
    });

    it('POST /api/repos/:id/sessions/:sid/inject — 404 for mismatched repo/session pair', async () => {
      const otherRepoPath = join(testPaths.root, 'repos-api-inject-other-repo');
      mkdirSync(otherRepoPath, { recursive: true });
      const otherRepoRes = await req(getApp(), '/api/repos', {
        method: 'POST',
        body: { path: otherRepoPath, name: 'inject-other-repo' },
      });
      expect(otherRepoRes.status).toBe(201);
      const otherRepoId = (await otherRepoRes.json()).id;

      const res = await req(getApp(), `/api/repos/${otherRepoId}/sessions/${sessionId}/inject`, {
        method: 'POST',
        body: { text: 'hello' },
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/does not belong to repo/i);

      await req(getApp(), `/api/repos/${otherRepoId}`, { method: 'DELETE' });
    });

    it('POST /api/repos/:id/sessions/:sid/restart — resets session to stopped', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}/restart`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const session = await res.json();
      expect(session.status).toBe('stopped');
      expect(session.state).toBe('stopped');
    });

    it('POST /api/repos/:id/sessions/:sid/restart — 404 for mismatched repo/session pair', async () => {
      const otherRepoPath = join(testPaths.root, 'repos-api-other-repo');
      mkdirSync(otherRepoPath, { recursive: true });
      const otherRepoRes = await req(getApp(), '/api/repos', {
        method: 'POST',
        body: { path: otherRepoPath, name: 'other-repo' },
      });
      expect(otherRepoRes.status).toBe(201);
      const otherRepoId = (await otherRepoRes.json()).id;

      const res = await req(getApp(), `/api/repos/${otherRepoId}/sessions/${sessionId}/restart`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/does not belong to repo/i);

      await req(getApp(), `/api/repos/${otherRepoId}`, { method: 'DELETE' });
    });

    it('DELETE /api/repos/:id/sessions/:sid — 200 with ok', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it('GET /api/repos/:id/sessions — session gone after delete', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions`);
      const sessions = await res.json();
      expect(sessions.some((session: { id: number }) => session.id === sessionId)).toBe(false);
    });

    it('DELETE /api/repos/:id/sessions/:sid — 404 for non-existent session', async () => {
      const res = await req(getApp(), `/api/repos/${repoId}/sessions/99999`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  it('DELETE /api/repos/:id — 200 with ok', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DELETE /api/repos/:id — 404 when repo does not exist', async () => {
    const res = await req(getApp(), '/api/repos/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('GET /api/repos — repo is gone after delete', async () => {
    const res = await req(getApp(), '/api/repos');
    const repos = await res.json();
    expect(repos.some((repo: { id: number }) => repo.id === repoId)).toBe(false);
  });
});
