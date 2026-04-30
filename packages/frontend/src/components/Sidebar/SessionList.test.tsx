import { render, screen, waitFor, within } from '@testing-library/react';
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
      list: vi.fn(),
      mdRefs: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
    git: {
      branches: {
        list: vi.fn(),
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
        session_count: 2,
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
          branch_mode: 'existing',
          initial_branch_name: 'existing-branch',
          worktree_path: 'C:/worktrees/alpha-session',
          current_branch: 'existing-branch',
          head_ref: 'existing-branch',
          is_detached: false,
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
        {
          id: 21,
          repo_id: 1,
          agent_type: 'claude',
          credential_id: null,
          name: 'Queued session with a much longer descriptive name that should stay fully visible',
          status: 'stopped',
          state: 'stopped',
          branch_mode: 'new',
          initial_branch_name: 'feature/long-queued-session-name',
          worktree_path: 'C:/worktrees/queued-session',
          current_branch: 'feature/long-queued-session-name',
          head_ref: 'feature/long-queued-session-name',
          is_detached: false,
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
        branch_mode: 'existing',
        initial_branch_name: 'existing-branch',
        worktree_path: 'C:/worktrees/alpha-session',
        current_branch: 'existing-branch',
        head_ref: 'existing-branch',
        is_detached: false,
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
      },
      agents: [
        {
          id: 'claude',
          name: 'Claude',
          command: 'claude',
          installed: true,
          credentialFields: [],
        },
      ],
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
      branch_mode: 'existing',
      initial_branch_name: 'existing-branch',
      worktree_path: 'C:/worktrees/alpha-session',
      current_branch: 'existing-branch',
      head_ref: 'existing-branch',
      is_detached: false,
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
      branch_mode: 'existing',
      initial_branch_name: 'existing-branch',
      worktree_path: 'C:/worktrees/alpha-session',
      current_branch: 'existing-branch',
      head_ref: 'existing-branch',
      is_detached: false,
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });
    apiMock.repos.sessions.list.mockResolvedValue([]);
    apiMock.repos.git.branches.list.mockResolvedValue([
      {
        name: 'existing-branch',
        in_use: true,
        worktree_path: 'C:/worktrees/taken',
        is_main_worktree: false,
        session_id: 99,
        session_name: 'Taken Session',
        disabled_reason: 'Already in use by session Taken Session',
      },
      {
        name: 'available-branch',
        in_use: false,
        worktree_path: null,
        is_main_worktree: false,
        session_id: null,
        session_name: null,
        disabled_reason: null,
      },
    ]);
  });

  it('restarts the active session and bumps the terminal version', async () => {
    const user = userEvent.setup();
    render(<SessionList />);
    const row = screen.getByText('Alpha Session').closest('li');

    expect(row).not.toBeNull();

    await user.click(within(row!).getByRole('button', { name: 'Restart session' }));

    await waitFor(() => {
      expect(apiMock.repos.sessions.restart).toHaveBeenCalledWith(1, 11);
    });
    expect(useAppStore.getState().sessionTerminalVersions[11]).toBe(1);
    expect(useAppStore.getState().selectedSession?.status).toBe('stopped');
  });

  it('updates the active session name and context refs', async () => {
    const user = userEvent.setup();
    render(<SessionList />);
    const row = screen.getByText('Alpha Session').closest('li');

    expect(row).not.toBeNull();

    await user.click(within(row!).getByRole('button', { name: 'Update session' }));
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

  it('creates a new git session on a new branch', async () => {
    const user = userEvent.setup();
    apiMock.repos.sessions.create.mockResolvedValue({
      id: 12,
      repo_id: 1,
      agent_type: 'claude',
      credential_id: null,
      name: 'Feature Session',
      status: 'stopped',
      state: 'stopped',
      branch_mode: 'new',
      initial_branch_name: 'feature/new-session',
      worktree_path: 'C:/worktrees/feature-session',
      current_branch: 'feature/new-session',
      head_ref: 'feature/new-session',
      is_detached: false,
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });

    render(<SessionList />);

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.type(screen.getByPlaceholderText('Session name'), 'Feature Session');
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'claude');
    await user.type(screen.getByPlaceholderText('Branch name'), 'feature/new-session');
    await user.click(screen.getByRole('button', { name: 'Start Session' }));

    await waitFor(() => {
      expect(apiMock.repos.sessions.create).toHaveBeenCalledWith(1, {
        name: 'Feature Session',
        agentType: 'claude',
        credentialId: undefined,
        branchMode: 'new',
        branchName: 'feature/new-session',
      });
    });
    expect(useAppStore.getState().selectedSession?.current_branch).toBe('feature/new-session');
  });

  it('creates a git session on the repo root without a branch name', async () => {
    const user = userEvent.setup();
    apiMock.repos.sessions.create.mockResolvedValue({
      id: 14,
      repo_id: 1,
      agent_type: 'claude',
      credential_id: null,
      name: 'Root Session',
      status: 'stopped',
      state: 'stopped',
      branch_mode: 'root',
      initial_branch_name: null,
      worktree_path: null,
      current_branch: 'main',
      head_ref: 'main',
      is_detached: false,
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });

    render(<SessionList />);

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.click(screen.getByRole('button', { name: 'Repo root' }));
    await user.type(screen.getByPlaceholderText('Session name'), 'Root Session');
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'claude');
    await user.click(screen.getByRole('button', { name: 'Start Session' }));

    await waitFor(() => {
      expect(apiMock.repos.sessions.create).toHaveBeenCalledWith(1, {
        name: 'Root Session',
        agentType: 'claude',
        credentialId: undefined,
        branchMode: 'root',
        branchName: undefined,
      });
    });
    expect(useAppStore.getState().selectedSession?.worktree_path).toBeNull();
  });

  it('keeps inactive sessions expanded with full names, branch badges, and visible actions', () => {
    render(<SessionList />);

    const row = screen.getByText('Queued session with a much longer descriptive name that should stay fully visible').closest('li');

    expect(row).not.toBeNull();
    expect(within(row!).getByText('feature/long-queued-session-name')).toBeInTheDocument();
    expect(within(row!).getByText('claude')).toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'Restart session' })).toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'Update session' })).toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'Delete session' })).toBeInTheDocument();
  });

  it('shows disabled existing branches and creates from an available one', async () => {
    const user = userEvent.setup();
    apiMock.repos.sessions.create.mockResolvedValue({
      id: 13,
      repo_id: 1,
      agent_type: 'claude',
      credential_id: null,
      name: 'Existing Branch Session',
      status: 'stopped',
      state: 'stopped',
      branch_mode: 'existing',
      initial_branch_name: 'available-branch',
      worktree_path: 'C:/worktrees/available-branch',
      current_branch: 'available-branch',
      head_ref: 'available-branch',
      is_detached: false,
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });

    render(<SessionList />);

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.click(screen.getByRole('button', { name: 'Existing branch' }));

    await waitFor(() => {
      expect(apiMock.repos.git.branches.list).toHaveBeenCalledWith(1, undefined);
    });

    expect(screen.getByRole('button', { name: 'existing-branch In use' })).toBeDisabled();
    expect(screen.getByText('Already in use by session Taken Session')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Session name'), 'Existing Branch Session');
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'claude');
    await user.click(screen.getByRole('button', { name: 'available-branch' }));
    await user.click(screen.getByRole('button', { name: 'Start Session' }));

    await waitFor(() => {
      expect(apiMock.repos.sessions.create).toHaveBeenCalledWith(1, {
        name: 'Existing Branch Session',
        agentType: 'claude',
        credentialId: undefined,
        branchMode: 'existing',
        branchName: 'available-branch',
      });
    });
  });
});
