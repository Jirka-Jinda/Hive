import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitHistoryModal from './GitHistoryModal';

const apiMock = vi.hoisted(() => ({
    repos: {
        git: {
            status: vi.fn(),
            history: vi.fn(),
        },
    },
}));

vi.mock('../../api/client', async () => {
    const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
    return { ...actual, api: apiMock };
});

describe('GitHistoryModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMock.repos.git.status.mockResolvedValue({
            branch: 'feature/session-one',
            head_ref: 'feature/session-one',
            is_detached: false,
            worktree_path: 'C:/worktrees/session-one',
            repo_path: 'C:/repos/alpha',
        });
        apiMock.repos.git.history.mockResolvedValue([
            {
                hash: '1234567890abcdef',
                short_hash: '1234567',
                subject: 'Add isolated git worktree sessions',
                author_name: 'Test User',
                authored_at: '2026-04-28T10:30:00.000Z',
                refs: ['HEAD -> feature/session-one', 'feature/session-one'],
            },
            {
                hash: 'abcdef1234567890',
                short_hash: 'abcdef1',
                subject: 'Initial commit',
                author_name: 'Test User',
                authored_at: '2026-04-27T08:00:00.000Z',
                refs: ['main'],
            },
        ]);
    });

    it('renders commit rows, branch badges, and refreshes on demand', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        render(
            <GitHistoryModal
                repo={{
                    id: 1,
                    name: 'Alpha Repo',
                    path: 'C:/repos/alpha',
                    source: 'local',
                    git_url: null,
                    created_at: '2026-04-27T00:00:00Z',
                    is_git_repo: true,
                }}
                session={{
                    id: 11,
                    repo_id: 1,
                    agent_type: 'claude',
                    credential_id: null,
                    name: 'Feature Session',
                    status: 'running',
                    state: 'idle',
                    created_at: '2026-04-27T00:00:00Z',
                    updated_at: '2026-04-27T00:00:00Z',
                    branch_mode: 'new',
                    initial_branch_name: 'feature/session-one',
                    worktree_path: 'C:/worktrees/session-one',
                    current_branch: 'feature/session-one',
                    head_ref: 'feature/session-one',
                    is_detached: false,
                    sort_order: 0,
                }}
                onClose={onClose}
            />,
        );

        await waitFor(() => {
            expect(apiMock.repos.git.status).toHaveBeenCalledWith(1, 11);
        });
        expect(apiMock.repos.git.history).toHaveBeenCalledWith(1, { sessionId: 11, limit: 50 });
        expect(screen.getByText('Git History')).toBeInTheDocument();
        expect(screen.getAllByText('feature/session-one')).toHaveLength(2);
        expect(screen.getByText('Add isolated git worktree sessions')).toBeInTheDocument();
        expect(screen.getByText('HEAD -> feature/session-one')).toBeInTheDocument();
        expect(screen.getByText('Initial commit')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Refresh' }));
        await user.click(screen.getByRole('button', { name: 'Close (Esc)' }));

        expect(apiMock.repos.git.history).toHaveBeenCalledTimes(2);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
