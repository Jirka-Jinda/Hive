/**
 * Pipeline phase — when during a session lifecycle the node runs.
 *
 *   session-start  — once, when the PTY process is first spawned
 *                    (text starts as '' and nodes build up the startup payload)
 *   user-input     — every time the user sends text to the agent
 *   agent-output   — every chunk of raw output from the agent
 */
export type PipelinePhase = 'session-start' | 'user-input' | 'agent-output';

/**
 * Context passed to every node transform call.
 */
export interface PipelineContext {
  sessionId: number;
  repoId: number;
  phase: PipelinePhase;
}

/**
 * A pipeline node transforms text in one or more phases.
 * Nodes are pure transformers — they receive text and return modified text.
 * They cannot block or cancel a message.
 */
export interface PipelineNode {
  /** Stable unique identifier (used for toggle state storage). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Short explanation shown in the UI. */
  description: string;
  /** Which phases this node participates in. */
  phases: PipelinePhase[];
  /** Default enabled state (overridden by persisted settings). */
  defaultEnabled: boolean;
  /**
   * Transform text for the given phase.
   * For `session-start`, the initial text is ''; nodes append/return the startup payload.
   * For `user-input` / `agent-output`, nodes receive and return the content chunk.
   */
  transform(text: string, ctx: PipelineContext): string | Promise<string>;
}

/** Serialisable DTO returned by the API (no function fields). */
export interface PipelineNodeDto {
  id: string;
  name: string;
  description: string;
  phases: PipelinePhase[];
  enabled: boolean;
}
