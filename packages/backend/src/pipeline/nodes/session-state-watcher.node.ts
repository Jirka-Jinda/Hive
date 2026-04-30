import type { PipelineNode, PipelineContext } from '../types.js';
import type { SessionStore } from '../../services/session-store.js';
import type { NotificationBus } from '../../services/notification-bus.js';
import { AGENT_ADAPTERS } from '../../services/agents.js';
import type { AgentAdapter } from '../../services/agents.js';
import { normalizeTerminalText } from '../../utils/terminal-text.js';

function normalizeForPromptDetection(text: string): string {
  return normalizeTerminalText(text);
}

interface DebounceEntry {
  outputTail: string;
  timer?: ReturnType<typeof setTimeout>;
}

const OUTPUT_TAIL_MAX = 512;
const RIGHT_CHEVRON_RE = /[>❯›❱❭❵]/;
const RIGHT_CHEVRON_START_RE = /^\s*[>❯›❱❭❵](?:\s|$)/u;
const PROMPT_CHEVRON_RE = /(?:^|[\s\u2500-\u257f])[>❯›❱❭❵](?:\s{2,}|\s*$)/u;
const TUI_FOOTER_RE = /(?:gpt-[\w.-]+|\/ commands\s+·\s+\?\s+help)/i;
const TERMINAL_EVENT_INPUT_RE =
  /(?:\x1B\[(?:I|O)|\x1B\[<\d+;\d+;\d+[mM]|\x1B\[M[\s\S]{3})/g;

function appendOutputTail(outputTail: string, text: string): string {
  return `${outputTail}${normalizeForPromptDetection(text)}`.slice(-OUTPUT_TAIL_MAX);
}

function getRecentPromptCandidates(outputTail: string): string[] {
  // Strip trailing whitespace, newlines, and carriage returns.
  const trimmedTail = outputTail.replace(/\s+$/g, '');
  if (!trimmedTail) return [];

  // normalizeTerminalText has already converted CRs and cursor row jumps into
  // newlines. Scan a small window because TUI prompts and footers often occupy
  // adjacent rows rather than one final line.
  return trimmedTail
    .split('\n')
    .map((segment) => segment.trimEnd())
    .filter((segment) => segment.trim())
    .slice(-8);
}

function isIdlePromptTail(outputTail: string, adapter: AgentAdapter): boolean {
  const candidates = getRecentPromptCandidates(outputTail);
  const finalRow = candidates.at(-1);
  if (!finalRow) return false;

  const rowLooksIdle = (candidate: string) => (
    adapter.idlePattern.test(candidate) ||
    PROMPT_CHEVRON_RE.test(candidate) ||
    (RIGHT_CHEVRON_RE.test(candidate) && (adapter.tuiIdlePattern?.test(candidate) ?? false))
  );

  if (rowLooksIdle(finalRow)) return true;

  const previousRow = candidates.at(-2);
  return Boolean(
    previousRow &&
    TUI_FOOTER_RE.test(finalRow) &&
    (
      rowLooksIdle(previousRow) ||
      (adapter.idleOnChevronQuiet === true && RIGHT_CHEVRON_START_RE.test(previousRow))
    ),
  );
}

function isIgnorableTerminalEventInput(text: string): boolean {
  return text.replace(TERMINAL_EVENT_INPUT_RE, '') === '';
}

export function createSessionStateWatcherNode(
  sessionStore: SessionStore,
  notificationBus: NotificationBus,
): PipelineNode {
  const debounceMap = new Map<number, DebounceEntry>();
  const DEFAULT_IDLE_DEBOUNCE_MS = 1000;

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
        if (isIgnorableTerminalEventInput(text)) return text;

        const entry = debounceMap.get(sessionId);
        if (entry?.timer) {
          clearTimeout(entry.timer);
        }
        debounceMap.delete(sessionId);
        let sessionName = '';
        let sessionRepoId: number | undefined;
        let sessionState: string | undefined;
        try {
          const s = sessionStore.get(sessionId);
          sessionName = s.name;
          sessionRepoId = s.repo_id;
          sessionState = s.state;
        } catch { /* ignore */ }
        if (sessionState === 'working') return text;
        sessionStore.setState(sessionId, 'working');
        notificationBus.emitSessionState({ sessionId, repoId: sessionRepoId, state: 'working', sessionName });
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

        if (!isIdlePromptTail(entry.outputTail, adapter)) {
          if (entry.timer) {
            clearTimeout(entry.timer);
            delete entry.timer;
          }
          debounceMap.set(sessionId, entry);
          return text;
        }

        // Debounce: reset the timer on every matching chunk
        if (entry.timer) clearTimeout(entry.timer);

        const idleDebounceMs = adapter.idleDebounceMs ?? DEFAULT_IDLE_DEBOUNCE_MS;
        entry.timer = setTimeout(() => {
          const latest = debounceMap.get(sessionId);
          if (latest) {
            delete latest.timer;
            debounceMap.set(sessionId, latest);
          }
          let current;
          try { current = sessionStore.get(sessionId); } catch { return; }
          if (current.state !== 'working') return;
          sessionStore.setState(sessionId, 'idle');
          notificationBus.emitSessionState({ sessionId, repoId: current.repo_id, state: 'idle', sessionName: current.name });
        }, idleDebounceMs);

        debounceMap.set(sessionId, entry);
      }

      return text;
    },
  };
}
