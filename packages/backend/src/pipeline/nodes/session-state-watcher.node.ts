import type { PipelineNode, PipelineContext } from '../types.js';
import type { SessionStore } from '../../services/session-store.js';
import type { NotificationBus } from '../../services/notification-bus.js';
import { AGENT_ADAPTERS } from '../../services/agents.js';

// Matches common ANSI escape sequences so we can test the raw text.
const ANSI_ESCAPE_RE = /\x1B\[[0-9;]*[A-Za-z]|\x1B\][^\x07]*\x07|\x1B[PX^_].*?ST|\x1B[()][AB012]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

interface DebounceEntry {
  timer: ReturnType<typeof setTimeout>;
}

export function createSessionStateWatcherNode(
  sessionStore: SessionStore,
  notificationBus: NotificationBus,
): PipelineNode {
  const debounceMap = new Map<number, DebounceEntry>();
  const IDLE_DEBOUNCE_MS = 500;

  return {
    id: 'session-state-watcher',
    name: 'Session State Watcher',
    description: 'Tracks agent idle/working state and emits notifications.',
    phases: ['agent-output', 'user-input'],
    defaultEnabled: true,

    async transform(text: string, ctx: PipelineContext): Promise<string> {
      const { sessionId, phase } = ctx;
      if (!sessionId) return text;

      // On user input — cancel any pending idle debounce and mark as working
      if (phase === 'user-input') {
        const entry = debounceMap.get(sessionId);
        if (entry) {
          clearTimeout(entry.timer);
          debounceMap.delete(sessionId);
        }
        let sessionName = '';
        try { sessionName = sessionStore.get(sessionId).name; } catch { /* ignore */ }
        sessionStore.setState(sessionId, 'working');
        notificationBus.emitSessionState({ sessionId, state: 'working', sessionName });
        return text;
      }

      // On agent output — test stripped text against idle pattern with debounce
      if (phase === 'agent-output') {
        let session;
        try { session = sessionStore.get(sessionId); } catch { return text; }

        const adapter = AGENT_ADAPTERS[session.agent_type];
        if (!adapter) return text;

        const stripped = stripAnsi(text);
        if (!adapter.idlePattern.test(stripped)) return text;

        // Debounce: reset the timer on every matching chunk
        const existing = debounceMap.get(sessionId);
        if (existing) clearTimeout(existing.timer);

        const timer = setTimeout(() => {
          debounceMap.delete(sessionId);
          sessionStore.setState(sessionId, 'idle');
          notificationBus.emitSessionState({ sessionId, state: 'idle', sessionName: session.name });
        }, IDLE_DEBOUNCE_MS);

        debounceMap.set(sessionId, { timer });
      }

      return text;
    },
  };
}
