import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';
import type { AgentAdapter } from './agents';
import { resolveCommand } from './agents';

export interface ProcessEntry {
  pty: pty.IPty;
  sessionId: number;
  repoPath: string;
  events: EventEmitter;
}

const processes = new Map<number, ProcessEntry>();

export function spawnAgent(
  sessionId: number,
  adapter: AgentAdapter,
  repoPath: string,
  credential?: Record<string, string>,
  cols = 120,
  rows = 30
): ProcessEntry {
  const existing = processes.get(sessionId);
  if (existing) return existing;

  const resolvedCommand = resolveCommand(adapter.command);
  const proc = pty.spawn(resolvedCommand, adapter.buildArgs(credential), {
    name: 'xterm-color',
    cols,
    rows,
    cwd: repoPath,
    env: {
      ...process.env,
      ...adapter.envVars(credential),
      TERM: 'xterm-color',
    } as Record<string, string>,
  });

  const events = new EventEmitter();
  const entry: ProcessEntry = { pty: proc, sessionId, repoPath, events };
  processes.set(sessionId, entry);

  proc.onData((data: string) => events.emit('data', Buffer.from(data)));
  proc.onExit(({ exitCode }: { exitCode: number }) => {
    events.emit('exit', exitCode);
    processes.delete(sessionId);
  });

  return entry;
}

export function getProcess(sessionId: number): ProcessEntry | undefined {
  return processes.get(sessionId);
}

export function killProcess(sessionId: number): void {
  const entry = processes.get(sessionId);
  if (entry) {
    try { entry.pty.kill(); } catch { /* already dead */ }
    processes.delete(sessionId);
  }
}

export function resizeProcess(sessionId: number, cols: number, rows: number): void {
  const entry = processes.get(sessionId);
  if (entry) entry.pty.resize(cols, rows);
}
