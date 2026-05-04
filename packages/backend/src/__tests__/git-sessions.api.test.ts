import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const remotePath = join(testPaths.root, 'git-session-remote.git');
  let repoId = 0;
  let newBranchSession: {
    id: number;
    worktree_path: string;
  };
  let existingBranchSession: {
    id: number;
    worktree_path: string;
  };
  let rootSession: {
    id: number;
    worktree_path: string | null;
  } = { id: 0, worktree_path: null };
  let remoteBranchSession: {
    id: number;
    worktree_path: string;
  };
  const repoSeedContent = '# Session seed\n\nUse this in the worktree.\n';

  beforeAll(async () => {
    await initGitRepo(repoPath);
    await simpleGit().raw(['init', '--bare', remotePath]);
    const git = simpleGit(repoPath);
    await git.addRemote('origin', remotePath);
    await git.push(['-u', 'origin', 'main']);
    await git.push(['origin', 'existing-branch']);
    await git.raw(['branch', '--set-upstream-to=origin/existing-branch', 'existing-branch']);
    await git.checkoutLocalBranch('remote-only-branch');
    writeFileSync(join(repoPath, 'remote-only.txt'), 'remote branch\n', 'utf8');
    await git.add('.');
    await git.commit('Remote-only branch commit');
    await git.push(['-u', 'origin', 'remote-only-branch']);
    await git.checkout('main');
    await git.raw(['branch', '-D', 'remote-only-branch']);

    const res = await req(getApp(), '/api/repos', {
      method: 'POST',
      body: { path: repoPath, name: 'git-session-repo' },
    });
    expect(res.status).toBe(201);
    repoId = (await res.json()).id;

    const mdRes = await req(getApp(), '/api/mdfiles', {
      method: 'POST',
      body: {
        scope: 'repo',
        repoPath,
        filename: 'session-seed.md',
        content: repoSeedContent,
        type: 'prompt',
      },
    });
    expect(mdRes.status).toBe(201);
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
    expect(readFileSync(join(newBranchBody.worktree_path, '.agent', 'session-seed.md'), 'utf8')).toBe(repoSeedContent);
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

  it('creates repo-root git sessions without allocating a worktree', async () => {
    const createRootSession = await req(getApp(), `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: {
        name: 'Repo Root Session',
        agentType: 'claude',
        branchMode: 'root',
      },
    });
    expect(createRootSession.status).toBe(201);
    const rootBody = await createRootSession.json();
    expect(rootBody.branch_mode).toBe('root');
    expect(rootBody.initial_branch_name).toBeNull();
    expect(rootBody.worktree_path).toBeNull();
    expect(rootBody.current_branch).toBe('main');
    rootSession = rootBody;

    const statusRes = await req(getApp(), `/api/repos/${repoId}/git/status?sessionId=${rootBody.id}`);
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual(
      expect.objectContaining({
        branch: 'main',
        worktree_path: repoPath,
        repo_path: repoPath,
      }),
    );
  });

  it('lists remote branches and creates a local tracking branch session from one', async () => {
    const branchesRes = await req(getApp(), `/api/repos/${repoId}/git/branches?q=remote-only`);
    expect(branchesRes.status).toBe(200);
    const branches = await branchesRes.json();
    expect(branches).toEqual([
      expect.objectContaining({
        name: 'origin/remote-only-branch',
        in_use: false,
        is_remote: true,
      }),
    ]);

    const createRemoteBranch = await req(getApp(), `/api/repos/${repoId}/sessions`, {
      method: 'POST',
      body: {
        name: 'Remote Branch Session',
        agentType: 'claude',
        branchMode: 'existing',
        branchName: 'origin/remote-only-branch',
      },
    });
    expect(createRemoteBranch.status).toBe(201);
    const remoteBranchBody = await createRemoteBranch.json();
    expect(remoteBranchBody.branch_mode).toBe('existing');
    expect(remoteBranchBody.initial_branch_name).toBe('remote-only-branch');
    expect(remoteBranchBody.current_branch).toBe('remote-only-branch');
    expect(readFileSync(join(remoteBranchBody.worktree_path, 'remote-only.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'remote branch\n',
    );
    remoteBranchSession = remoteBranchBody;
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

  it('fetches and pulls from the current branch upstream', async () => {
    const updaterPath = join(testPaths.root, 'git-session-remote-updater');
    await simpleGit().clone(remotePath, updaterPath);
    const updater = simpleGit(updaterPath);
    await updater.addConfig('user.name', 'Remote User');
    await updater.addConfig('user.email', 'remote@example.com');
    await updater.checkout('remote-only-branch');
    writeFileSync(join(updaterPath, 'remote-only.txt'), 'remote branch\nupstream update\n', 'utf8');
    await updater.add('.');
    await updater.commit('Update remote-only branch');
    await updater.push('origin', 'remote-only-branch');

    const pullRes = await req(getApp(), `/api/repos/${repoId}/git/fetch-pull`, {
      method: 'POST',
      body: { sessionId: remoteBranchSession.id },
    });

    expect(pullRes.status).toBe(200);
    expect(readFileSync(join(remoteBranchSession.worktree_path, 'remote-only.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'remote branch\nupstream update\n',
    );
  });

  it('returns JSON changed files and diffs for a session worktree', async () => {
    writeFileSync(join(existingBranchSession.worktree_path, 'feature.txt'), 'existing branch\nchanged\n', 'utf8');
    writeFileSync(join(existingBranchSession.worktree_path, 'new-file.txt'), 'new file\n', 'utf8');

    const filesRes = await req(
      getApp(),
      `/api/repos/${repoId}/git/changed-files?sessionId=${existingBranchSession.id}`,
    );
    expect(filesRes.status).toBe(200);
    expect(filesRes.headers.get('content-type')).toContain('application/json');
    const files = await filesRes.json();
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'feature.txt', status: 'M' }),
        expect.objectContaining({ path: 'new-file.txt', status: '?' }),
      ]),
    );

    const diffRes = await req(
      getApp(),
      `/api/repos/${repoId}/git/diff?sessionId=${existingBranchSession.id}&path=feature.txt`,
    );
    expect(diffRes.status).toBe(200);
    const diff = await diffRes.json();
    expect(diff).toEqual(
      expect.objectContaining({
        path: 'feature.txt',
        status: 'M',
        original: 'existing branch\n',
        modified: 'existing branch\nchanged\n',
      }),
    );
  });

  it('returns JSON for unmatched API routes', async () => {
    const res = await req(getApp(), '/api/not-a-real-route');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('deletes only the targeted worktree and keeps the branch available', async () => {
    const res = await req(getApp(), `/api/repos/${repoId}/sessions/${newBranchSession.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(existsSync(newBranchSession.worktree_path)).toBe(false);
    expect(existsSync(existingBranchSession.worktree_path)).toBe(true);
    expect(rootSession.worktree_path).toBeNull();

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
