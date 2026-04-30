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
    await vi.advanceTimersByTimeAsync(1000);

    expect(sessionStore.setState).toHaveBeenCalledWith(1, 'idle');
    expect(notificationBus.emitSessionState).toHaveBeenCalledWith({
      sessionId: 1,
      repoId: 1,
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

  it('does not mark working for terminal focus reports', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'codex',
        credential_id: null,
        name: 'Codex Session',
        status: 'running',
        state: 'idle',
        created_at: '',
        updated_at: '',
      })),
      setState: vi.fn(),
    } as unknown as SessionStore;

    const notificationBus = {
      emitSessionState: vi.fn(),
    } as unknown as NotificationBus;

    const node = createSessionStateWatcherNode(sessionStore, notificationBus);

    await node.transform('\x1b[O', { sessionId: 1, repoId: 1, phase: 'user-input' });
    await node.transform('\x1b[I', { sessionId: 1, repoId: 1, phase: 'user-input' });

    expect(sessionStore.setState).not.toHaveBeenCalled();
    expect(notificationBus.emitSessionState).not.toHaveBeenCalled();
  });

  it('marks working for real user input from idle', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'codex',
        credential_id: null,
        name: 'Codex Session',
        status: 'running',
        state: 'idle',
        created_at: '',
        updated_at: '',
      })),
      setState: vi.fn(),
    } as unknown as SessionStore;

    const notificationBus = {
      emitSessionState: vi.fn(),
    } as unknown as NotificationBus;

    const node = createSessionStateWatcherNode(sessionStore, notificationBus);

    await node.transform('hello', { sessionId: 1, repoId: 1, phase: 'user-input' });

    expect(sessionStore.setState).toHaveBeenCalledWith(1, 'working');
    expect(notificationBus.emitSessionState).toHaveBeenCalledWith({
      sessionId: 1,
      repoId: 1,
      state: 'working',
      sessionName: 'Codex Session',
    });
  });

  it('marks Copilot idle from a full TUI repaint row', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'copilot',
        credential_id: null,
        name: 'Copilot Session',
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

    await node.transform(
      '\x1b[40;1HC:\\repo [master] ─────❯                         ───── / commands · ? help GPT-5 mini\r\n\x1b[K',
      { sessionId: 1, repoId: 1, phase: 'agent-output' },
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(sessionStore.setState).toHaveBeenCalledWith(1, 'idle');
    expect(notificationBus.emitSessionState).toHaveBeenCalledWith({
      sessionId: 1,
      repoId: 1,
      state: 'idle',
      sessionName: 'Copilot Session',
    });
  });

  it('marks Codex idle after a chevron repaint goes quiet', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'codex',
        credential_id: null,
        name: 'Codex Session',
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

    await node.transform('› Summarize recent commits\r\n  gpt-5.5 xhigh · C:\\repo', {
      sessionId: 1,
      repoId: 1,
      phase: 'agent-output',
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(sessionStore.setState).toHaveBeenCalledWith(1, 'idle');
  });

  it('marks Codex idle from a blank TUI prompt', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'codex',
        credential_id: null,
        name: 'Codex Session',
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

    await node.transform('\x1b[38;1H›                         \r\n  gpt-5.5 xhigh · C:\\repo', {
      sessionId: 1,
      repoId: 1,
      phase: 'agent-output',
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(sessionStore.setState).toHaveBeenCalledWith(1, 'idle');
  });

  it('does not mark Codex idle for ordinary output containing a chevron', async () => {
    const sessionStore = {
      get: vi.fn(() => ({
        id: 1,
        repo_id: 1,
        agent_type: 'codex',
        credential_id: null,
        name: 'Codex Session',
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

    await node.transform('Use shell redirection like `run foo > out.txt` before continuing.\n', {
      sessionId: 1,
      repoId: 1,
      phase: 'agent-output',
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(sessionStore.setState).not.toHaveBeenCalled();
    expect(notificationBus.emitSessionState).not.toHaveBeenCalled();
  });
});
