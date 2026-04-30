import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import UsageModal from './UsageModal';

describe('UsageModal', () => {
  it('renders usage details and calls refresh/close handlers', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onClose = vi.fn();

    render(
      <UsageModal
        repoName="Workspace Repo"
        loading={false}
        error=""
        onRefresh={onRefresh}
        onClose={onClose}
        summary={{
          repo_id: 1,
          totals: {
            context_tokens: 10,
            input_tokens: 15,
            prompt_tokens: 25,
            output_tokens: 17,
            total_tokens: 42,
          },
          sessions: [
            {
              session_id: 5,
              repo_id: 1,
              repo_name: 'Workspace Repo',
              session_name: 'Daily Session',
              agent_type: 'claude',
              credential_id: 9,
              credential_name: 'Primary Key',
              status: 'running',
              state: 'working',
              updated_at: '2026-04-27T00:00:00Z',
              context_tokens: 10,
              input_tokens: 15,
              prompt_tokens: 25,
              output_tokens: 17,
              total_tokens: 42,
            },
          ],
          by_agent: [
            {
              agent_type: 'claude',
              context_tokens: 10,
              input_tokens: 15,
              prompt_tokens: 25,
              output_tokens: 17,
              total_tokens: 42,
            },
          ],
          by_credential: [
            {
              credential_key: 'credential:9',
              credential_id: 9,
              credential_name: 'Primary Key',
              context_tokens: 10,
              input_tokens: 15,
              prompt_tokens: 25,
              output_tokens: 17,
              total_tokens: 42,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Token Usage')).toBeInTheDocument();
    expect(screen.getByText(/Approximate prompt and output tokens for Workspace Repo/i)).toBeInTheDocument();
    expect(screen.getByText('42 exact')).toBeInTheDocument();
    expect(screen.getByText('Daily Session')).toBeInTheDocument();
    expect(screen.getByText('Primary Key')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(screen.getByRole('button', { name: 'Close (Esc)' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
