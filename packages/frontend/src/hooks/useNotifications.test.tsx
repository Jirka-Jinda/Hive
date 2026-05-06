import { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppStore } from '../test/resetAppStore';
import { useAppStore } from '../store/appStore';
import { useNotifications } from './useNotifications';

const apiMock = vi.hoisted(() => ({
  mdfiles: {
    list: vi.fn(),
  },
}));

vi.mock('../api/client', () => ({ api: apiMock }));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;

  readonly url: string;
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.onclose?.({} as CloseEvent);
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function Harness() {
  useNotifications();

  useEffect(() => {
    return () => {
      MockWebSocket.instances = [];
    };
  }, []);

  return null;
}

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    resetAppStore({
      mdFiles: [
        {
          id: 10,
          scope: 'central',
          repo_id: null,
          session_id: null,
          path: 'existing.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
        {
          id: 20,
          scope: 'repo',
          repo_id: 2,
          session_id: null,
          path: 'repo-note.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
      selectedMdFile: {
        id: 10,
        scope: 'central',
        repo_id: null,
        session_id: null,
        path: 'existing.md',
        type: 'other',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
        content: '# Existing',
      },
    });
  });

  it('refreshes the central file list when a central md change arrives', async () => {
    apiMock.mdfiles.list.mockResolvedValue([
      {
        id: 11,
        scope: 'central',
        repo_id: null,
        session_id: null,
        path: 'new-live-file.md',
        type: 'instruction',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
      },
    ]);

    render(<Harness />);

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    ws.emitMessage({ type: 'md-files-changed', scope: 'central' });

    await waitFor(() => {
      expect(apiMock.mdfiles.list).toHaveBeenCalledWith('central');
    });

    await waitFor(() => {
      expect(useAppStore.getState().mdFiles).toEqual([
        {
          id: 11,
          scope: 'central',
          repo_id: null,
          session_id: null,
          path: 'new-live-file.md',
          type: 'instruction',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
        {
          id: 20,
          scope: 'repo',
          repo_id: 2,
          session_id: null,
          path: 'repo-note.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ]);
    });

    expect(useAppStore.getState().selectedMdFile).toBeNull();
  });

  it('refreshes repo file list when a repo md change arrives for the selected repo', async () => {
    resetAppStore({
      mdFiles: [
        {
          id: 10,
          scope: 'central',
          repo_id: null,
          session_id: null,
          path: 'existing.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
        {
          id: 20,
          scope: 'repo',
          repo_id: 2,
          session_id: null,
          path: 'repo-note.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
      selectedRepo: { id: 2, name: 'my-repo', path: '/repos/my-repo', source: 'local', git_url: null, is_git_repo: false, created_at: '2026-04-27T00:00:00Z' },
    });

    apiMock.mdfiles.list.mockResolvedValue([
      {
        id: 20,
        scope: 'repo',
        repo_id: 2,
        session_id: null,
        path: 'repo-note.md',
        type: 'other',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
      },
      {
        id: 21,
        scope: 'repo',
        repo_id: 2,
        session_id: null,
        path: 'sessions/agent-notes.md',
        type: 'instruction',
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:00:00Z',
      },
    ]);

    render(<Harness />);

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    ws.emitMessage({ type: 'md-files-changed', scope: 'repo', repoId: 2 });

    await waitFor(() => {
      expect(apiMock.mdfiles.list).toHaveBeenCalledWith('repo', 2);
    });

    await waitFor(() => {
      const files = useAppStore.getState().mdFiles;
      expect(files).toHaveLength(3);
      expect(files.some((f) => f.path === 'sessions/agent-notes.md')).toBe(true);
    });
  });

  it('ignores repo md change when a different repo is selected', async () => {
    resetAppStore({
      mdFiles: [
        {
          id: 10,
          scope: 'central',
          repo_id: null,
          session_id: null,
          path: 'existing.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
      selectedRepo: { id: 99, name: 'other-repo', path: '/repos/other', source: 'local', git_url: null, is_git_repo: false, created_at: '2026-04-27T00:00:00Z' },
    });

    apiMock.mdfiles.list.mockResolvedValue([{ id: 21, scope: 'repo', repo_id: 2, session_id: null, path: 'new.md', type: 'other', created_at: '', updated_at: '' }]);

    render(<Harness />);

    const ws = MockWebSocket.instances[0];
    ws.emitMessage({ type: 'md-files-changed', scope: 'repo', repoId: 2 });

    await waitFor(() => {
      expect(apiMock.mdfiles.list).toHaveBeenCalledWith('repo', 2);
    });

    // Store should not change since repo 2 is not selected
    const files = useAppStore.getState().mdFiles;
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('existing.md');
  });

  it('records idle alerts for sessions outside the active repo', async () => {
    resetAppStore({
      selectedRepo: { id: 2, name: 'active-repo', path: '/repos/active', source: 'local', git_url: null, is_git_repo: false, created_at: '2026-04-27T00:00:00Z' },
      sessions: [
        {
          id: 20,
          repo_id: 2,
          agent_type: 'codex',
          credential_id: null,
          name: 'Visible Session',
          status: 'running',
          state: 'working',
          sort_order: 0,
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ],
    });

    render(<Harness />);

    const ws = MockWebSocket.instances[0];
    ws.emitMessage({
      type: 'session-state',
      sessionId: 99,
      repoId: 7,
      sessionName: 'Background Session',
      state: 'idle',
    });

    await waitFor(() => {
      expect(useAppStore.getState().repoAlerts[7]).toBe(1);
    });

    expect(useAppStore.getState().notifications).toEqual([
      expect.objectContaining({
        sessionId: 99,
        repoId: 7,
        sessionName: 'Background Session',
        state: 'idle',
      }),
    ]);
    expect(useAppStore.getState().sessions[0]?.state).toBe('working');
  });
});
