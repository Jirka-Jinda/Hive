import type { PipelineNode, PipelineContext } from '../types.js';
import type { SessionStore } from '../../services/session-store.js';
import type { NotificationBus } from '../../services/notification-bus.js';
import { AGENT_ADAPTERS } from '../../services/agents.js';

// Matches common ANSI / VT escape sequences so we can test the raw text.
// [0-9;?]* covers both standard and DEC-private-mode CSI params (e.g. \x1B[?25h, \x1B[?2004h).
const ANSI_ESCAPE_RE = /\x1B\[[0-9;?]*[A-Za-z]|\x1B\][^\x07]*\x07|\x1B[PX^_].*?ST|\x1B[()][AB012]/g;

function stripAnsi(text: string): string {
  // Remove ANSI sequences then strip \r so multiline anchors work on PTY output.
  return text.replace(ANSI_ESCAPE_RE, '').replace(/\r/g, '');
}

interface DebounceEntry {
  outputTail: string;
  timer?: ReturnType<typeof setTimeout>;
}

const OUTPUT_TAIL_MAX = 512;

function appendOutputTail(outputTail: string, text: string): string {
  return `${outputTail}${stripAnsi(text)}`.slice(-OUTPUT_TAIL_MAX);
}

function getTrailingPromptCandidate(outputTail: string): string {
  const trimmedTail = outputTail.replace(/\n+$/g, '');
  if (!trimmedTail) return '';

  const lines = trimmedTail.split('\n');
  return lines[lines.length - 1] ?? trimmedTail;
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
        if (entry?.timer) {
          clearTimeout(entry.timer);
        }
        debounceMap.delete(sessionId);
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

        const entry = debounceMap.get(sessionId) ?? { outputTail: '' };
        entry.outputTail = appendOutputTail(entry.outputTail, text);

        const promptCandidate = getTrailingPromptCandidate(entry.outputTail);
        if (!promptCandidate || !adapter.idlePattern.test(promptCandidate)) {
          if (entry.timer) {
            clearTimeout(entry.timer);
            delete entry.timer;
          }
          debounceMap.set(sessionId, entry);
          return text;
        }

        // Debounce: reset the timer on every matching chunk
        if (entry.timer) clearTimeout(entry.timer);

        entry.timer = setTimeout(() => {
          const latest = debounceMap.get(sessionId);
          if (latest) {
            delete latest.timer;
            debounceMap.set(sessionId, latest);
          }
          sessionStore.setState(sessionId, 'idle');
          notificationBus.emitSessionState({ sessionId, state: 'idle', sessionName: session.name });
        }, IDLE_DEBOUNCE_MS);

        debounceMap.set(sessionId, entry);
      }

      return text;
    },
  };
}
