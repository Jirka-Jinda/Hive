import type { PipelineContext, PipelineNode } from '../types';
import type { SessionStore } from '../../services/session-store';
import type { UsageService } from '../../services/usage-service';
import type { TokenCounterService } from '../../services/token-counter-service';
import { AGENT_ADAPTERS } from '../../services/agents';
import type { AgentAdapter } from '../../services/agents';
import { normalizeTerminalText } from '../../utils/terminal-text';

const OUTPUT_TAIL_MAX = 1024;
const INPUT_ESCAPE_RE =
  /\x1B(?:\[[0-9;?<>!]*[ -/]*[@-~]|O[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[PX^_][^\x1B]*(?:\x1B\\|$)|[^[\]])/y;
const PROMPT_PREFIX_RE = /^[>\u276f\u203a\u2771\u276d\u2775?]\s*/u;
const RIGHT_CHEVRON_RE = /[>\u276f\u203a\u2771\u276d\u2775]/u;
const RIGHT_CHEVRON_START_RE = /^\s*[>\u276f\u203a\u2771\u276d\u2775](?:\s|$)/u;
const PROMPT_CHEVRON_RE = /(?:^|[\s\u2500-\u257f])[>\u276f\u203a\u2771\u276d\u2775](?:\s{2,}|\s*$)/u;
const COMMAND_FOOTER_RE = /\/ commands\s+\u00b7\s+\?\s+help/i;
const MODEL_FOOTER_RE = /^gpt-[\w.-]+(?:\s+\w+)?\s+\u00b7\s+.+/i;
const TUI_FOOTER_RE = /(?:gpt-[\w.-]+|\/ commands\s+\u00b7\s+\?\s+help)/i;

interface TokenUsageState {
  input: TerminalInputAccumulator;
  awaitingOutput: boolean;
  outputRaw: string;
  outputTail: string;
  submittedInputs: string[];
}

class TerminalInputAccumulator {
  private buffer = '';
  private cursor = 0;

  accept(text: string): string[] {
    const submissions: string[] = [];

    for (let index = 0; index < text.length;) {
      if (text.charCodeAt(index) === 0x1b) {
        INPUT_ESCAPE_RE.lastIndex = index;
        const match = INPUT_ESCAPE_RE.exec(text);
        if (match?.index === index) {
          this.applyEscape(match[0]);
          index = INPUT_ESCAPE_RE.lastIndex;
          continue;
        }
        index += 1;
        continue;
      }

      const codePoint = text.codePointAt(index);
      if (codePoint === undefined) break;
      const char = String.fromCodePoint(codePoint);
      index += char.length;

      if (char === '\r' || char === '\n') {
        const submitted = this.buffer.trimEnd();
        if (submitted.trim()) submissions.push(submitted);
        this.buffer = '';
        this.cursor = 0;
        continue;
      }

      if (char === '\x7f' || char === '\b') {
        this.deleteBeforeCursor();
        continue;
      }

      if (char === '\x01') {
        this.cursor = 0;
        continue;
      }

      if (char === '\x03') {
        this.buffer = '';
        this.cursor = 0;
        continue;
      }

      if (char === '\x04') {
        this.deleteAtCursor();
        continue;
      }

      if (char === '\x05') {
        this.cursor = this.buffer.length;
        continue;
      }

      if (char === '\x0b') {
        this.buffer = this.buffer.slice(0, this.cursor);
        continue;
      }

      if (char === '\x15') {
        this.buffer = '';
        this.cursor = 0;
        continue;
      }

      if (char === '\x17') {
        this.deletePreviousWord();
        continue;
      }

      if (codePoint < 0x20 && char !== '\t') continue;

      this.insert(char);
    }

    return submissions;
  }

  private applyEscape(sequence: string): void {
    if (/^\x1B(?:\[(?:\d+;)*\d*D|OD)$/.test(sequence)) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }

    if (/^\x1B(?:\[(?:\d+;)*\d*C|OC)$/.test(sequence)) {
      this.cursor = Math.min(this.buffer.length, this.cursor + 1);
      return;
    }

    if (/^\x1B(?:\[(?:1|7)?~?H?|\[1~|\[7~|OH)$/.test(sequence)) {
      this.cursor = 0;
      return;
    }

    if (/^\x1B(?:\[F|\[4~|\[8~|OF)$/.test(sequence)) {
      this.cursor = this.buffer.length;
      return;
    }

    if (/^\x1B\[3~$/.test(sequence)) {
      this.deleteAtCursor();
    }
  }

  private insert(text: string): void {
    this.buffer = `${this.buffer.slice(0, this.cursor)}${text}${this.buffer.slice(this.cursor)}`;
    this.cursor += text.length;
  }

  private deleteBeforeCursor(): void {
    if (this.cursor <= 0) return;
    const before = Array.from(this.buffer.slice(0, this.cursor));
    before.pop();
    const after = this.buffer.slice(this.cursor);
    this.buffer = `${before.join('')}${after}`;
    this.cursor = before.join('').length;
  }

  private deleteAtCursor(): void {
    if (this.cursor >= this.buffer.length) return;
    const after = Array.from(this.buffer.slice(this.cursor));
    after.shift();
    this.buffer = `${this.buffer.slice(0, this.cursor)}${after.join('')}`;
  }

  private deletePreviousWord(): void {
    const before = this.buffer.slice(0, this.cursor);
    const nextBefore = before.replace(/\s+$/g, '').replace(/\S+$/g, '');
    this.buffer = `${nextBefore}${this.buffer.slice(this.cursor)}`;
    this.cursor = nextBefore.length;
  }
}

function createState(): TokenUsageState {
  return {
    input: new TerminalInputAccumulator(),
    awaitingOutput: false,
    outputRaw: '',
    outputTail: '',
    submittedInputs: [],
  };
}

function appendOutputTail(outputTail: string, text: string): string {
  return `${outputTail}${normalizeTerminalText(text)}`.slice(-OUTPUT_TAIL_MAX);
}

function getRecentPromptCandidates(outputTail: string): string[] {
  const trimmedTail = outputTail.replace(/\s+$/g, '');
  if (!trimmedTail) return [];

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

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function submittedInputLines(submittedInputs: string[]): string[] {
  return submittedInputs
    .flatMap((input) => normalizeTerminalText(input).split('\n'))
    .map(normalizeLine)
    .filter((line) => line.length > 0);
}

function isChromeLine(line: string, normalizedLine: string, adapter: AgentAdapter | undefined): boolean {
  if (!normalizedLine) return true;
  if (adapter?.idlePattern.test(normalizedLine)) return true;
  if (adapter?.tuiIdlePattern?.test(normalizedLine)) return true;
  if (COMMAND_FOOTER_RE.test(normalizedLine)) return true;
  if (MODEL_FOOTER_RE.test(normalizedLine)) return true;
  return PROMPT_CHEVRON_RE.test(line) && TUI_FOOTER_RE.test(line);
}

function isSubmittedEchoLine(normalizedLine: string, inputs: string[]): boolean {
  const promptLine = PROMPT_PREFIX_RE.test(normalizedLine);

  return inputs.some((input) => (
    normalizedLine === input ||
    (promptLine && normalizedLine.includes(input)) ||
    (input.length >= 12 && normalizedLine.includes(input))
  ));
}

function filterAgentOutputForTokenCount(
  rawText: string,
  submittedInputs: string[],
  adapter: AgentAdapter | undefined,
): string {
  const inputs = submittedInputLines(submittedInputs);
  const lines = normalizeTerminalText(rawText).split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trimEnd();
    const normalizedLine = normalizeLine(trimmedLine);

    if (isChromeLine(trimmedLine, normalizedLine, adapter)) continue;
    if (isSubmittedEchoLine(normalizedLine, inputs)) continue;

    kept.push(trimmedLine);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function createTokenUsageNode(
  sessionStore: SessionStore,
  usageService: UsageService,
  tokenCounter: TokenCounterService,
): PipelineNode {
  const states = new Map<number, TokenUsageState>();

  const getState = (sessionId: number): TokenUsageState => {
    const existing = states.get(sessionId);
    if (existing) return existing;
    const next = createState();
    states.set(sessionId, next);
    return next;
  };

  const increment = (
    ctx: PipelineContext,
    session: ReturnType<SessionStore['get']>,
    delta: { contextTokens?: number; inputTokens?: number; outputTokens?: number },
  ): void => {
    usageService.increment(
      {
        sessionId: ctx.sessionId,
        repoId: session.repo_id,
        agentType: session.agent_type,
        credentialId: session.credential_id,
      },
      delta,
    );
  };

  const flushOutput = async (
    state: TokenUsageState,
    ctx: PipelineContext,
    session: ReturnType<SessionStore['get']>,
  ): Promise<void> => {
    if (!state.awaitingOutput || !state.outputRaw) {
      state.outputRaw = '';
      state.outputTail = '';
      state.submittedInputs = [];
      state.awaitingOutput = false;
      return;
    }

    const adapter = AGENT_ADAPTERS[session.agent_type];
    const countableOutput = filterAgentOutputForTokenCount(state.outputRaw, state.submittedInputs, adapter);
    state.outputRaw = '';
    state.outputTail = '';
    state.submittedInputs = [];
    state.awaitingOutput = false;

    const outputTokens = await tokenCounter.count(countableOutput);
    if (outputTokens > 0) increment(ctx, session, { outputTokens });
  };

  return {
    id: 'token-usage',
    name: 'Token Usage Counter',
    description: 'Counts approximate prompt and output tokens for usage analytics.',
    phases: ['session-start', 'user-input', 'agent-output'],
    defaultEnabled: true,

    async transform(text: string, ctx: PipelineContext): Promise<string> {
      const state = getState(ctx.sessionId);
      let session;
      try {
        session = sessionStore.get(ctx.sessionId);
      } catch {
        states.delete(ctx.sessionId);
        return text;
      }

      if (ctx.phase === 'session-start') {
        await flushOutput(state, ctx, session);
        states.set(ctx.sessionId, createState());
        const tokens = await tokenCounter.count(text);
        if (tokens > 0) increment(ctx, session, { contextTokens: tokens });
        return text;
      }

      if (ctx.phase === 'user-input') {
        await flushOutput(state, ctx, session);

        const submitted = state.input.accept(text);
        if (submitted.length === 0) return text;

        const inputTokens = await tokenCounter.count(submitted.join('\n'));
        if (inputTokens > 0) increment(ctx, session, { inputTokens });

        state.awaitingOutput = true;
        state.outputRaw = '';
        state.outputTail = '';
        state.submittedInputs = submitted;
        return text;
      }

      if (!state.awaitingOutput) return text;

      state.outputRaw += text;
      state.outputTail = appendOutputTail(state.outputTail, text);

      const adapter = AGENT_ADAPTERS[session.agent_type];
      if (adapter && isIdlePromptTail(state.outputTail, adapter)) {
        await flushOutput(state, ctx, session);
      }

      return text;
    },
  };
}
