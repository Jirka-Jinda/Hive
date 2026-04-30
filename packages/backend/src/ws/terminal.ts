import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { SessionStore } from '../services/session-store';
import type { RepoManager } from '../services/repo-manager';
import type { CredentialStore } from '../services/credential-store';
import type { PipelineRegistry } from '../pipeline/pipeline-registry';
import type { NotificationBus } from '../services/notification-bus';
import { spawnAgent, getProcess, drainProcessOutputBacklog } from '../services/process-manager';
import type { ProcessEntry } from '../services/process-manager';
import { AGENT_ADAPTERS } from '../services/agents';
import { getErrorMessage } from '../utils/errors';

interface SessionOutputStream {
  entry: ProcessEntry;
  clients: Map<WebSocket, SessionOutputClient>;
  onData: (data: Buffer) => void;
  onExit: () => void;
  queue: Promise<void>;
}

interface SessionOutputClient {
  replaying: boolean;
  replayThroughLogId: number;
  pendingLive: { logId: number; data: Buffer }[];
}

export function setupWebSocketServer(
  wss: WebSocketServer,
  sessionStore: SessionStore,
  repoManager: RepoManager,
  credentialStore: CredentialStore,
  pipelineRegistry: PipelineRegistry,
  notificationBus: NotificationBus,
): void {
  const streams = new Map<number, SessionOutputStream>();

  const removeStream = (sessionId: number): void => {
    const stream = streams.get(sessionId);
    if (!stream) return;
    stream.entry.events.off('data', stream.onData);
    stream.entry.events.off('exit', stream.onExit);
    streams.delete(sessionId);
  };

  const sendToClients = (clients: Map<WebSocket, SessionOutputClient>, data: Buffer, logId: number): void => {
    for (const [client, state] of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          if (state.replaying) {
            state.pendingLive.push({ logId, data });
            continue;
          }
          client.send(data);
        } catch {
          clients.delete(client);
        }
      } else {
        clients.delete(client);
      }
    }
  };

  const ensureStream = (sessionId: number, repoId: number, sessionName: string, entry: ProcessEntry): SessionOutputStream => {
    const existing = streams.get(sessionId);
    if (existing?.entry === entry) return existing;
    if (existing) removeStream(sessionId);

    const stream: SessionOutputStream = {
      entry,
      clients: new Map<WebSocket, SessionOutputClient>(),
      onData: () => {},
      onExit: () => {},
      queue: Promise.resolve(),
    };

    stream.onData = (data: Buffer) => {
      let logId: number;
      try {
        logId = sessionStore.appendLog(sessionId, data);
      } catch {
        // The session can be deleted while the PTY is still flushing.
        for (const client of stream.clients.keys()) {
          if (client.readyState === WebSocket.OPEN) client.close(1000, 'Session deleted');
        }
        removeStream(sessionId);
        return;
      }

      const rawText = data.toString('utf8');
      stream.queue = stream.queue.then(async () => {
        try {
          const transformed = await pipelineRegistry.run('agent-output', rawText, { sessionId, repoId });
          sendToClients(stream.clients, Buffer.from(transformed), logId);
        } catch {
          sendToClients(stream.clients, data, logId);
        }
      });
    };

    stream.onExit = () => {
      try {
        sessionStore.setStatus(sessionId, 'stopped');
        sessionStore.setState(sessionId, 'stopped');
        notificationBus.emitSessionState({ sessionId, repoId, state: 'stopped', sessionName });
      } catch {
        // Session row may already be gone.
      }

      for (const client of stream.clients.keys()) {
        if (client.readyState === WebSocket.OPEN) client.close(1000, 'Process exited');
      }
      removeStream(sessionId);
    };

    entry.events.on('data', stream.onData);
    entry.events.once('exit', stream.onExit);
    streams.set(sessionId, stream);
    for (const chunk of drainProcessOutputBacklog(entry)) {
      stream.onData(chunk);
    }
    return stream;
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const sessionId = parseInt(url.searchParams.get('sessionId') ?? '0', 10);
    const cols = Math.max(20, Math.min(500, parseInt(url.searchParams.get('cols') ?? '', 10) || 120));
    const rows = Math.max(5,  Math.min(200, parseInt(url.searchParams.get('rows') ?? '', 10) || 30));

    if (!sessionId) {
      ws.close(1008, 'Missing sessionId');
      return;
    }

    let session;
    let repo;
    try {
      session = sessionStore.get(sessionId);
      repo = repoManager.get(session.repo_id);
    } catch (error: unknown) {
      ws.close(1011, getErrorMessage(error));
      return;
    }

    // Start the PTY if not already running
    let entry = getProcess(sessionId);
    if (!entry) {
      const adapter = AGENT_ADAPTERS[session.agent_type];
      if (!adapter) {
        ws.close(1011, `Unknown agent type: ${session.agent_type}`);
        return;
      }
      let credential: Record<string, string> | undefined;
      if (session.credential_id) {
        try {
          const cred = credentialStore.get(session.credential_id);
          credential = cred.data.envVars;
        } catch {
          // Proceed without credential if lookup fails
        }
      }
      try {
        // Persist credential to gh's OS credential store so Copilot CLI can
        // authenticate via `gh auth token` fallback on all future sessions.
        adapter.setupAuth?.(credential ?? {});
        const workingDirectory = repoManager.resolveWorkingDirectory(repo, session.worktree_path);
        entry = spawnAgent(sessionId, adapter, workingDirectory, credential, cols, rows);
        ensureStream(sessionId, session.repo_id, session.name, entry);
      } catch (spawnError: unknown) {
        sessionStore.setState(sessionId, 'stopped');
        notificationBus.emitSessionState({ sessionId, repoId: session.repo_id, state: 'stopped', sessionName: session.name });
        ws.close(1011, `Failed to start agent: ${getErrorMessage(spawnError)}`);
        return;
      }
      sessionStore.setStatus(sessionId, 'running');
      sessionStore.setState(sessionId, 'working');
      notificationBus.emitSessionState({ sessionId, repoId: session.repo_id, state: 'working', sessionName: session.name });

      // Run the session-start pipeline (e.g. injects MD file context preamble).
      // We wait briefly so the CLI can initialise its prompt before receiving input.
      void pipelineRegistry.run('session-start', '', { sessionId, repoId: session.repo_id }).then((startup) => {
        if (startup) {
          setTimeout(() => {
            const proc = getProcess(sessionId);
            if (proc) proc.pty.write(startup);
          }, 350);
        }
      });
    }

    const stream = ensureStream(sessionId, session.repo_id, session.name, entry);

    const clientState: SessionOutputClient = {
      replaying: true,
      replayThroughLogId: 0,
      pendingLive: [],
    };
    stream.clients.set(ws, clientState);
    clientState.replayThroughLogId = sessionStore.getLastLogId(sessionId);

    // Replay scrollback, then flush any live output captured after the replay cutoff.
    const logs = sessionStore.getLogsThrough(sessionId, clientState.replayThroughLogId);
    for (const { output } of logs) {
      if (ws.readyState === WebSocket.OPEN) ws.send(output);
    }
    clientState.replaying = false;
    const pending = clientState.pendingLive;
    clientState.pendingLive = [];
    for (const item of pending) {
      if (item.logId <= clientState.replayThroughLogId) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(item.data);
    }

    // WebSocket input → PTY (pass through user-input pipeline first)
    ws.on('message', (msg: Buffer | string) => {
      const raw = msg instanceof Buffer ? msg : Buffer.from(msg as unknown as string);
      // Attempt to parse resize control message
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'resize' && typeof parsed.cols === 'number') {
          entry!.pty.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON — treat as terminal input
      }
      void pipelineRegistry.run('user-input', raw.toString(), { sessionId, repoId: session.repo_id })
        .then((transformed) => {
          entry!.pty.write(transformed);
        })
        .catch(() => {
          entry!.pty.write(raw.toString());
        });
    });

    ws.on('close', () => {
      stream.clients.delete(ws);
    });

    ws.on('error', () => {
      stream.clients.delete(ws);
    });
  });
}
