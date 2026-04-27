import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionList from './SessionList';
import { useAppStore } from '../../store/appStore';
import { resetAppStore } from '../../test/resetAppStore';

const apiMock = vi.hoisted(() => ({
  repos: {
    sessions: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      restart: vi.fn(),
      mdRefs: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

vi.mock('../../api/client', () => ({ api: apiMock }));

describe('SessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppStore({
      selectedRepo: {
        id: 1,
        name: 'Alpha Repo',
        path: 'C:/repos/alpha',
        source: 'local',
        git_url: null,
        created_at: '2026-04-27T00:00:00Z',
        is_git_repo: true,
      },
      sessions: [
        {
          id: 11,
          repo_id: 1,
          agent_type: 'claude',
          credential_id: null,
          name: 'Alpha Session',
          status: 'running',
          state: 'idle',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
      selectedSession: {
        id: 11,
        repo_id: 1,
        agent_type: 'claude',
        credential_id: null,
        name: 'Alpha Session',
        status: 'running',
        state: 'idle',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
      },
      mdFiles: [
        {
          id: 201,
          scope: 'central',
          repo_id: null,
          path: 'session-context.md',
          type: 'instruction',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
    });

    apiMock.repos.sessions.mdRefs.get.mockResolvedValue([
      {
        id: 201,
        scope: 'central',
        repo_id: null,
        path: 'session-context.md',
        type: 'instruction',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
      },
    ]);
    apiMock.repos.sessions.mdRefs.set.mockResolvedValue({ ok: true });
    apiMock.repos.sessions.update.mockResolvedValue({
      id: 11,
      repo_id: 1,
      agent_type: 'claude',
      credential_id: null,
      name: 'Renamed Session',
      status: 'running',
      state: 'idle',
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });
    apiMock.repos.sessions.restart.mockResolvedValue({
      id: 11,
      repo_id: 1,
      agent_type: 'claude',
      credential_id: null,
      name: 'Alpha Session',
      status: 'stopped',
      state: 'stopped',
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });
  });

  it('restarts the active session and bumps the terminal version', async () => {
    const user = userEvent.setup();
    render(<SessionList />);

    await user.click(screen.getByTitle('Restart session'));

    await waitFor(() => {
      expect(apiMock.repos.sessions.restart).toHaveBeenCalledWith(1, 11);
    });
    expect(useAppStore.getState().sessionTerminalVersions[11]).toBe(1);
    expect(useAppStore.getState().selectedSession?.status).toBe('stopped');
  });

  it('updates the active session name and context refs', async () => {
    const user = userEvent.setup();
    render(<SessionList />);

    await user.click(screen.getByTitle('Update session'));
    const input = await screen.findByPlaceholderText('Session name');
    await user.clear(input);
    await user.type(input, 'Renamed Session');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(apiMock.repos.sessions.update).toHaveBeenCalledWith(1, 11, { name: 'Renamed Session' });
    });
    expect(apiMock.repos.sessions.mdRefs.set).toHaveBeenCalledWith(1, 11, [201]);
    expect(useAppStore.getState().selectedSession?.name).toBe('Renamed Session');
    expect(useAppStore.getState().sessions[0]?.name).toBe('Renamed Session');
  });
});