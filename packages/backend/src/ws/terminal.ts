import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { SessionStore } from '../services/session-store';
import type { RepoManager } from '../services/repo-manager';
import type { CredentialStore } from '../services/credential-store';
import type { PipelineRegistry } from '../pipeline/pipeline-registry';
import type { NotificationBus } from '../services/notification-bus';
import { spawnAgent, getProcess } from '../services/process-manager';
import { AGENT_ADAPTERS } from '../services/agents';
import { getErrorMessage } from '../utils/errors';

export function setupWebSocketServer(
  wss: WebSocketServer,
  sessionStore: SessionStore,
  repoManager: RepoManager,
  credentialStore: CredentialStore,
  pipelineRegistry: PipelineRegistry,
  notificationBus: NotificationBus,
): void {

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const sessionId = parseInt(url.searchParams.get('sessionId') ?? '0', 10);

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

    // Replay scrollback before attaching live output
    const logs = sessionStore.getLogs(sessionId);
    for (const chunk of logs) {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
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
      entry = spawnAgent(sessionId, adapter, repo.path, credential);
      sessionStore.setStatus(sessionId, 'running');
      sessionStore.setState(sessionId, 'working');
      notificationBus.emitSessionState({ sessionId, state: 'working', sessionName: session.name });

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

    // PTY data → WebSocket (persist raw; pipeline may transform the live display)
    const onData = (data: Buffer) => {
      sessionStore.appendLog(sessionId, data);
      void pipelineRegistry.run('agent-output', data.toString(), { sessionId, repoId: session.repo_id }).then((transformed) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(transformed));
      });
    };
    entry.events.on('data', onData);

    const onExit = () => {
      sessionStore.setStatus(sessionId, 'stopped');
      sessionStore.setState(sessionId, 'stopped');
      notificationBus.emitSessionState({ sessionId, state: 'stopped', sessionName: session.name });
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Process exited');
    };
    entry.events.once('exit', onExit);

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
      void pipelineRegistry.run('user-input', raw.toString(), { sessionId, repoId: session.repo_id }).then((transformed) => {
        entry!.pty.write(transformed);
      });
    });

    ws.on('close', () => {
      entry!.events.off('data', onData);
      entry!.events.off('exit', onExit);
    });

    ws.on('error', () => {
      entry!.events.off('data', onData);
      entry!.events.off('exit', onExit);
    });
  });
}
