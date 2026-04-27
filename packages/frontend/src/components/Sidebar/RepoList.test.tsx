import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RepoList from './RepoList';
import { useAppStore } from '../../store/appStore';
import { resetAppStore } from '../../test/resetAppStore';

const apiMock = vi.hoisted(() => ({
  repos: {
    discover: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    sessions: {
      list: vi.fn(),
    },
    mdRefs: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
  mdfiles: {
    list: vi.fn(),
  },
}));

vi.mock('../../api/client', () => ({ api: apiMock }));

describe('RepoList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppStore({
      repos: [
        {
          id: 1,
          name: 'Alpha Repo',
          path: 'C:/repos/alpha',
          source: 'local',
          git_url: null,
          created_at: '2026-04-27T00:00:00Z',
          is_git_repo: true,
        },
      ],
      selectedRepo: {
        id: 1,
        name: 'Alpha Repo',
        path: 'C:/repos/alpha',
        source: 'local',
        git_url: null,
        created_at: '2026-04-27T00:00:00Z',
        is_git_repo: true,
      },
      mdFiles: [
        {
          id: 101,
          scope: 'central',
          repo_id: null,
          path: 'context.md',
          type: 'instruction',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
    });

    apiMock.repos.mdRefs.get.mockResolvedValue([
      {
        id: 101,
        scope: 'central',
        repo_id: null,
        path: 'context.md',
        type: 'instruction',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
      },
    ]);
    apiMock.repos.sessions.list.mockResolvedValue([]);
    apiMock.mdfiles.list.mockResolvedValue([]);
    apiMock.repos.mdRefs.set.mockResolvedValue({ ok: true });
    apiMock.repos.update.mockResolvedValue({
      id: 1,
      name: 'Renamed Repo',
      path: 'C:/repos/alpha',
      source: 'local',
      git_url: null,
      created_at: '2026-04-27T00:00:00Z',
      is_git_repo: true,
    });
  });

  it('updates the active repository name and context refs', async () => {
    const user = userEvent.setup();
    render(<RepoList />);

    await user.click(screen.getByTitle('Update repository'));
    const input = await screen.findByPlaceholderText('Repository name');
    await user.clear(input);
    await user.type(input, 'Renamed Repo');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(apiMock.repos.update).toHaveBeenCalledWith(1, { name: 'Renamed Repo' });
    });
    expect(apiMock.repos.mdRefs.set).toHaveBeenCalledWith(1, [101]);
    expect(useAppStore.getState().selectedRepo?.name).toBe('Renamed Repo');
    expect(useAppStore.getState().repos[0]?.name).toBe('Renamed Repo');
  });
});