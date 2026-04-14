import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import type { ServerType } from '@hono/node-server/dist/types';
import type Database from 'better-sqlite3';
import { SessionStore } from '../services/session-store';
import { RepoManager } from '../services/repo-manager';
import { CredentialStore } from '../services/credential-store';
import { MdRefService } from '../services/md-ref-service';
import { spawnAgent, getProcess } from '../services/process-manager';
import { AGENT_ADAPTERS } from '../services/agents';
import { getErrorMessage } from '../utils/errors';

export function setupWebSocketServer(server: ServerType, db: Database.Database): void {
  const wss = new WebSocketServer({ server: server as Server, path: '/ws/terminal' });
  const sessionStore = new SessionStore(db);
  const repoManager = new RepoManager(db);
  const credentialStore = new CredentialStore(db);
  const mdRefService = new MdRefService(db);

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

      // Inject linked MD file contents as a context preamble typed into the PTY.
      // We wait briefly so the CLI can initialise its prompt before receiving input.
      const resolved = mdRefService.resolveSessionContext(sessionId, session.repo_id);
      const preamble = mdRefService.buildPreamble(resolved);
      if (preamble) {
        setTimeout(() => {
          const proc = getProcess(sessionId);
          if (proc) proc.pty.write(preamble);
        }, 350);
      }
    }

    // PTY data → WebSocket (and persist to DB for replay)
    const onData = (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        sessionStore.appendLog(sessionId, data);
      }
    };
    entry.events.on('data', onData);

    const onExit = () => {
      sessionStore.setStatus(sessionId, 'stopped');
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Process exited');
    };
    entry.events.once('exit', onExit);

    // WebSocket input → PTY
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
      entry!.pty.write(raw.toString());
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
