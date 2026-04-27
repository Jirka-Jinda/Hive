import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationBus } from '../services/notification-bus';
import type { SessionStore } from '../services/session-store';
import { createSessionStateWatcherNode } from '../pipeline/nodes/session-state-watcher.node';

describe('createSessionStateWatcherNode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('marks a session idle when a prompt arrives across split output chunks', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'claude',
        credential_id: null,
        name: 'Claude Session',
        status: 'running',
        state: 'working',
        created_at: '',
        updated_at: '',
      })),
      setState: vi.fn(),
    } as unknown as SessionStore;

    const notificationBus = {
      emitSessionState: vi.fn(),
    } as unknown as NotificationBus;

    const node = createSessionStateWatcherNode(sessionStore, notificationBus);

    await node.transform('clau', { sessionId: 1, repoId: 1, phase: 'agent-output' });
    await node.transform('de> ', { sessionId: 1, repoId: 1, phase: 'agent-output' });
    await vi.advanceTimersByTimeAsync(500);

    expect(sessionStore.setState).toHaveBeenCalledWith(1, 'idle');
    expect(notificationBus.emitSessionState).toHaveBeenCalledWith({
      sessionId: 1,
      state: 'idle',
      sessionName: 'Claude Session',
    });
  });

  it('cancels a pending idle transition when more output arrives', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'claude',
        credential_id: null,
        name: 'Claude Session',
        status: 'running',
        state: 'working',
        created_at: '',
        updated_at: '',
      })),
      setState: vi.fn(),
    } as unknown as SessionStore;

    const notificationBus = {
      emitSessionState: vi.fn(),
    } as unknown as NotificationBus;

    const node = createSessionStateWatcherNode(sessionStore, notificationBus);

    await node.transform('claude> ', { sessionId: 1, repoId: 1, phase: 'agent-output' });
    await vi.advanceTimersByTimeAsync(200);
    await node.transform('Thinking harder...\n', { sessionId: 1, repoId: 1, phase: 'agent-output' });
    await vi.advanceTimersByTimeAsync(500);

    expect(sessionStore.setState).not.toHaveBeenCalled();
    expect(notificationBus.emitSessionState).not.toHaveBeenCalled();
  });
});