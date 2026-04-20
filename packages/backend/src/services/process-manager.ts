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
  const args = adapter.buildArgs(credential);

  // On Windows, .cmd/.bat files cannot be spawned directly by node-pty (error 193).
  // They must be executed via cmd.exe /c.
  let spawnFile = resolvedCommand;
  let spawnArgs = args;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedCommand)) {
    spawnArgs = ['/c', resolvedCommand, ...args];
    spawnFile = 'cmd.exe';
  }

  const proc = pty.spawn(spawnFile, spawnArgs, {
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
    // Remove from map first so the natural onExit callback (below) is a no-op
    // if the PTY happens to fire after we've already cleaned up.
    processes.delete(sessionId);
    // Notify listeners (e.g. the terminal WS handler) synchronously so they
    // can close the WebSocket and detach before any buffered data events arrive
    // from the dying process.  Must happen BEFORE removeAllListeners.
    entry.events.emit('exit', -1);
    // Drop all listeners — prevents appendLog / setState from being called on
    // a deleted session after pty.kill() delivers its final buffered output.
    entry.events.removeAllListeners();
    try { entry.pty.kill(); } catch { /* already dead */ }
  }
}

export function resizeProcess(sessionId: number, cols: number, rows: number): void {
  const entry = processes.get(sessionId);
  if (entry) entry.pty.resize(cols, rows);
}
