import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import simpleGit from 'simple-git';
import { beforeAll, describe, expect, it } from 'vitest';
import { req, setupApiTestApp, testPaths } from './api-test-support';

const getApp = setupApiTestApp();

async function initGitRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true });
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  writeFileSync(join(repoPath, 'README.md'), '# Git Session Test\n', 'utf8');
  await git.add('.');
  await git.commit('Initial commit');
  await git.raw(['branch', '-M', 'main']);

  await git.checkoutLocalBranch('existing-branch');
  writeFileSync(join(repoPath, 'feature.txt'), 'existing branch\n', 'utf8');
  await git.add('.');
  await git.commit('Existing branch commit');
  await git.checkout('main');
}

describe('Git-backed session APIs', () => {
  const repoPath = join(testPaths.root, 'git-session-repo');
  let repoId = 0;
  let newBranchSession: {
    id: number;
    worktree_path: string;
  };
  let existingBranchSession: {
    id: number;
    worktree_path: string;
  };

  beforeAll(async () => {
    await initGitRepo(repoPath);
    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'git-session-repo' },
    });
    expect(res.status).toBe(201);
    repoId = (await res.json()).id;
  });

  it('lists local branches with root-worktree occupancy', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}/git/branches`);
    expect(res.status).toBe(200);
    const branches = await res.json();

    expect(branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'existing-branch',
          in_use: false,
        }),
        expect.objectContaining({
          name: 'main',
          in_use: true,
          is_main_worktree: true,
          disabled_reason: 'Checked out in the repo root worktree',
        }),
      ]),
    );
  });

  it('creates isolated worktrees for new and existing branch sessions', async () => {
    const createNewBranch = await req(getApp(), `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: {
        name: 'Feature Session',
        agentType: 'claude',
        branchMode: 'new',
        branchName: 'feature/session-one',
      },
    });
    expect(createNewBranch.status).toBe(201);
    const newBranchBody = await createNewBranch.json();
    expect(newBranchBody.branch_mode).toBe('new');
    expect(newBranchBody.initial_branch_name).toBe('feature/session-one');
    expect(newBranchBody.current_branch).toBe('feature/session-one');
    expect(typeof newBranchBody.worktree_path).toBe('string');
    expect(existsSync(newBranchBody.worktree_path)).toBe(true);
    expect(newBranchBody.worktree_path.replace(/\\/g, '/')).toContain('/wt/');
    expect(basename(newBranchBody.worktree_path)).toBe(String(newBranchBody.id));
    newBranchSession = newBranchBody;

    const createExistingBranch = await req(getApp(), `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: {
        name: 'Existing Session',
        agentType: 'claude',
        branchMode: 'existing',
        branchName: 'existing-branch',
      },
    });
    expect(createExistingBranch.status).toBe(201);
    const existingBranchBody = await createExistingBranch.json();
    expect(existingBranchBody.branch_mode).toBe('existing');
    expect(existingBranchBody.initial_branch_name).toBe('existing-branch');
    expect(existingBranchBody.current_branch).toBe('existing-branch');
    expect(existingBranchBody.worktree_path).not.toBe(newBranchBody.worktree_path);
    expect(existsSync(existingBranchBody.worktree_path)).toBe(true);
    existingBranchSession = existingBranchBody;
  });

  it('marks attached branches as in use by the owning session', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}/git/branches`);
    expect(res.status).toBe(200);
    const branches = await res.json();
    const existingBranch = branches.find((branch: { name: string }) => branch.name === 'existing-branch');

    expect(existingBranch).toEqual(
      expect.objectContaining({
        in_use: true,
        session_id: existingBranchSession.id,
        session_name: 'Existing Session',
      }),
    );
  });

  it('returns worktree-aware status and history, including branch drift', async () => {
    const git = simpleGit(newBranchSession.worktree_path);
    await git.checkoutLocalBranch('feature/drifted-session');

    const statusRes = await req(
      getApp(),
      `/api/repos/${repoId}/git/status?sessionId=${newBranchSession.id}`,
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual(
      expect.objectContaining({
        branch: 'feature/drifted-session',
        worktree_path: newBranchSession.worktree_path,
        repo_path: repoPath,
      }),
    );

    const historyRes = await req(
      getApp(),
      `/api/repos/${repoId}/git/history?sessionId=${existingBranchSession.id}&limit=5`,
    );
    expect(historyRes.status).toBe(200);
    const history = await historyRes.json();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toEqual(
      expect.objectContaining({
        hash: expect.any(String),
        short_hash: expect.any(String),
        subject: expect.any(String),
        author_name: 'Test User',
      }),
    );
  });

  it('deletes only the targeted worktree and keeps the branch available', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}/sessions/${newBranchSession.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(existsSync(newBranchSession.worktree_path)).toBe(false);
    expect(existsSync(existingBranchSession.worktree_path)).toBe(true);

    const branchesRes = await req(getApp(), `/api/repos/${repoId}/git/branches?q=session-one`);
    expect(branchesRes.status).toBe(200);
    const branches = await branchesRes.json();
    expect(branches).toEqual([
      expect.objectContaining({
        name: 'feature/session-one',
        in_use: false,
      }),
    ]);
  });

  it('cleans up remaining managed worktrees when the repo is deleted', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(existsSync(existingBranchSession.worktree_path)).toBe(false);
    expect(existsSync(repoPath)).toBe(true);
  });
});