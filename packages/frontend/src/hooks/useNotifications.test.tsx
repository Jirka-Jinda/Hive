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
          path: 'existing.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
        {
          id: 20,
          scope: 'repo',
          repo_id: 2,
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
          path: 'new-live-file.md',
          type: 'instruction',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
        {
          id: 20,
          scope: 'repo',
          repo_id: 2,
          path: 'repo-note.md',
          type: 'other',
          created_at: '2026-04-27T00:00:00Z',
          updated_at: '2026-04-27T00:00:00Z',
        },
      ]);
    });

    expect(useAppStore.getState().selectedMdFile).toBeNull();
  });
});