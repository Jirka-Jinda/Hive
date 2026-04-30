import { describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '../application/workspace-service';

describe('WorkspaceService git session cleanup', () => {
  it('removes a newly created worktree if session creation fails after allocation', async () => {
    const repoManager = {
      get: vi.fn(() => ({
        id: 1,
        name: 'Git Repo',
        path: 'C:/repos/git-repo',
        source: 'local',
        git_url: null,
        created_at: '2026-04-28T00:00:00Z',
        is_git_repo: true,
      })),
      validateBranchName: vi.fn(async (_repo, branchName: string) => branchName),
      createSessionWorktree: vi.fn(async () => 'C:/data/worktrees/1/5-feature-session'),
      removeSessionWorktree: vi.fn(async () => undefined),
    } as any;

    const sessionStore = {
      create: vi.fn(() => ({
        id: 5,
        repo_id: 1,
        agent_type: 'claude',
        credential_id: null,
        name: 'Feature Session',
        status: 'stopped',
        state: 'stopped',
        branch_mode: 'new',
        initial_branch_name: 'feature/session',
        worktree_path: null,
        created_at: '2026-04-28T00:00:00Z',
        updated_at: '2026-04-28T00:00:00Z',
      })),
      updateGitMetadata: vi.fn(() => {
        throw new Error('failed to persist session metadata');
      }),
      delete: vi.fn(),
    } as any;

    const workspace = new WorkspaceService(
      {} as any,
      { list: vi.fn(() => []) } as any,
      {} as any,
      { get: vi.fn() } as any,
      repoManager,
      sessionStore,
    );

    await expect(workspace.createSession({
      repoId: 1,
      name: 'Feature Session',
      agentType: 'claude',
      branchMode: 'new',
      branchName: 'feature/session',
    })).rejects.toThrow(/failed to persist session metadata/i);

    expect(repoManager.createSessionWorktree).toHaveBeenCalledTimes(1);
    expect(repoManager.removeSessionWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'C:/data/worktrees/1/5-feature-session',
    );
    expect(sessionStore.delete).toHaveBeenCalledWith(5);
  });
});
