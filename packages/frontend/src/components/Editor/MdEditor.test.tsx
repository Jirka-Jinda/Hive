import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MdEditor from './MdEditor';
import { resetAppStore } from '../../test/resetAppStore';
import { useAppStore } from '../../store/appStore';

const apiMock = vi.hoisted(() => ({
  mdfiles: {
    update: vi.fn(),
  },
}));

vi.mock('../../api/client', () => ({ api: apiMock }));
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (value?: string) => void }) => (
    <textarea
      aria-label="Markdown editor"
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));
vi.mock('./MdPreview', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md-preview">{content}</div>,
}));

describe('MdEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppStore({
      selectedRepo: {
        id: 7,
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
          session_id: null,
          path: 'notes.md',
          type: 'instruction',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
      selectedMdFile: {
        id: 101,
        scope: 'central',
        repo_id: null,
        session_id: null,
        path: 'notes.md',
        type: 'instruction',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
        content: '# Notes',
      },
    });
  });

  it('saves changed scope and type for the selected file', async () => {
    const user = userEvent.setup();
    apiMock.mdfiles.update.mockResolvedValue({
      id: 101,
      scope: 'repo',
      repo_id: 7,
      session_id: null,
      path: 'notes.md',
      type: 'tool',
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:00Z',
    });

    render(<MdEditor />);

    await user.selectOptions(screen.getByLabelText('MD file type'), 'tool');
    await user.selectOptions(screen.getByLabelText('MD file scope'), 'repo');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(apiMock.mdfiles.update).toHaveBeenCalledWith(101, {
        content: '# Notes',
        scope: 'repo',
        repoPath: 'C:/repos/alpha',
        type: 'tool',
      });
    });

    expect(useAppStore.getState().selectedMdFile).toMatchObject({
      id: 101,
      scope: 'repo',
      repo_id: 7,
      type: 'tool',
      content: '# Notes',
    });
    expect(useAppStore.getState().mdFiles[0]).toMatchObject({
      id: 101,
      scope: 'repo',
      repo_id: 7,
      type: 'tool',
    });
  });

  it('does not re-select the previous file when autosave finishes after switching files', async () => {
    const user = userEvent.setup();
    let resolveUpdate: ((value: {
      id: number;
      scope: 'central' | 'repo' | 'session';
      repo_id: number | null;
      session_id: number | null;
      path: string;
      type: 'skill' | 'tool' | 'instruction' | 'prompt' | 'other';
      created_at: string;
      updated_at: string;
    }) => void) | undefined;

    resetAppStore({
      selectedRepo: {
        id: 7,
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
          session_id: null,
          path: 'notes.md',
          type: 'instruction',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
        {
          id: 202,
          scope: 'central',
          repo_id: null,
          session_id: null,
          path: 'template.md',
          type: 'prompt',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
      selectedMdFile: {
        id: 101,
        scope: 'central',
        repo_id: null,
        session_id: null,
        path: 'notes.md',
        type: 'instruction',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
        content: '# Notes',
      },
    });

    apiMock.mdfiles.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );

    render(<MdEditor />);

    await user.clear(screen.getByLabelText('Markdown editor'));
    await user.type(screen.getByLabelText('Markdown editor'), '# Notes edited');

    act(() => {
      useAppStore.getState().setSelectedMdFile({
        id: 202,
        scope: 'central',
        repo_id: null,
        session_id: null,
        path: 'template.md',
        type: 'prompt',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
        content: '# Template',
      });
    });

    await waitFor(() => {
      expect(apiMock.mdfiles.update).toHaveBeenCalledWith(101, {
        content: '# Notes edited',
        scope: 'central',
        repoPath: undefined,
        type: 'instruction',
      });
    });

    resolveUpdate?.({
      id: 101,
      scope: 'central',
      repo_id: null,
      session_id: null,
      path: 'notes.md',
      type: 'instruction',
      created_at: '2026-04-27T00:00:00Z',
      updated_at: '2026-04-27T00:00:01Z',
    });

    await waitFor(() => {
      expect(useAppStore.getState().selectedMdFile).toMatchObject({
        id: 202,
        path: 'template.md',
        type: 'prompt',
        content: '# Template',
      });
    });

    expect(apiMock.mdfiles.update).toHaveBeenCalledTimes(1);
  });
});