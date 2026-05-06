import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ChangesModal from './ChangesModal';

const apiMock = vi.hoisted(() => ({
  changes: {
    list: vi.fn(),
  },
}));

vi.mock('../../api/client', () => ({ api: apiMock }));

describe('ChangesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.changes.list.mockResolvedValue([
      {
        id: 1,
        event_type: 'mdfile-created',
        scope: 'repo',
        repo_id: 7,
        session_id: null,
        md_file_id: 101,
        automation_task_id: null,
        path: 'notes.md',
        title: 'Created notes.md',
        summary: 'New repo markdown file',
        created_at: '2026-04-27T00:00:00Z',
      },
    ]);
  });

  it('loads recent changes and forwards open actions', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<ChangesModal onClose={() => { }} onOpenChange={onOpenChange} />);

    expect(await screen.findByText('Created notes.md')).toBeInTheDocument();
    expect(screen.getByText('New repo markdown file')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1, md_file_id: 101 }));
    });
  });
});
