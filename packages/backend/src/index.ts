import { Hono } from 'hono';
import { createAdaptorServer } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { cors } from 'hono/cors';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Config } from './utils/config';
import { openDb } from './db/schema';
import { migrate } from './db/migrate';
import { reposRouter } from './routes/repos';
import { credentialsRouter } from './routes/credentials';
import { agentsRouter } from './routes/agents';
import { mdfilesRouter } from './routes/mdfiles';
import { settingsRouter } from './routes/settings';
import { pipelineRouter } from './routes/pipeline';
import { toolsRouter } from './routes/tools';
import { setupWebSocketServer } from './ws/terminal';
import { setupShellServer } from './ws/shell';
import { setupNotifyServer } from './ws/notify';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { MdFileManager } from './services/mdfile-manager';
import { MdRefService } from './services/md-ref-service';
import { SettingsService } from './services/settings-service';
import { NotificationBus } from './services/notification-bus';
import { CentralMdSyncService } from './services/central-md-sync';
import { PipelineRegistry } from './pipeline/pipeline-registry';
import { createMdContextNode } from './pipeline/nodes/md-context.node';
import { createTokenUsageNode } from './pipeline/nodes/token-usage.node';
import { createSessionStateWatcherNode } from './pipeline/nodes/session-state-watcher.node';
import { SessionStore } from './services/session-store';
import { RepoManager } from './services/repo-manager';
import { CredentialStore } from './services/credential-store';
import { WorkspaceService } from './application/workspace-service';
import { AutomationService } from './services/automation-service';
import { automationRouter } from './routes/automation';
import { TokenCounterService } from './services/token-counter-service';
import { UsageService } from './services/usage-service';
import { usageRouter } from './routes/usage';
import { LogService } from './services/log-service';
import { logsRouter } from './routes/logs';
import { RepoAgentMdWatcher } from './services/repo-agent-md-watcher';

// ── Bootstrap ──────────────────────────────────────────────────────────────
const db = openDb(join(Config.DATA_DIR, 'app.db'));
migrate(db);
const logService = new LogService(db);

// Capture unhandled errors before any other service initialises
process.on('uncaughtException', (err: Error) => {
  logService.logAppError(err.message, err.stack);
  console.error('[FATAL] Uncaught exception', err);
});
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logService.logAppError(err.message, err.stack);
  console.error('[FATAL] Unhandled rejection', err);
});

const settingsService = new SettingsService();
const notificationBus = new NotificationBus();
const mdMgr = new MdFileManager(db);
const centralMdSync = new CentralMdSyncService(mdMgr, settingsService, notificationBus);
mdMgr.setSyncService(centralMdSync);
centralMdSync.fullSync();
centralMdSync.startWatching();

// ── Services (single instances shared across routes, WS, and pipelines) ───
const sessionStore = new SessionStore(db);
sessionStore.stopRunningSessions();
const repoManager = new RepoManager(db, settingsService);
const credentialStore = new CredentialStore(db);
const mdRefService = new MdRefService(db);
const workspace = new WorkspaceService(db, mdMgr, settingsService, credentialStore, repoManager, sessionStore, logService);
const tokenCounter = new TokenCounterService();
const usageService = new UsageService(db);
const repoAgentMdWatcher = new RepoAgentMdWatcher(workspace, notificationBus);
workspace.setAgentMdWatchRootsChangedHandler(() => repoAgentMdWatcher.refreshWatchedRoots());
void workspace.reconcileGitWorktrees()
  .catch((error) => {
    console.error('[WARN] Failed to reconcile managed git worktrees on startup', error);
  })
  .finally(() => {
    repoAgentMdWatcher.startWatching();
  });

// ── Pipeline ───────────────────────────────────────────────────────────────
const pipelineRegistry = new PipelineRegistry(settingsService);
pipelineRegistry.register(createMdContextNode(mdRefService));
pipelineRegistry.register(createTokenUsageNode(sessionStore, usageService, tokenCounter));
pipelineRegistry.register(createSessionStateWatcherNode(sessionStore, notificationBus));

// ── Automation ─────────────────────────────────────────────────────────────
const automationService = new AutomationService(db, mdMgr, sessionStore, repoManager, pipelineRegistry);
automationService.startAll();

// ── Hono app ───────────────────────────────────────────────────────────────
const app = new Hono();

app.use('*', cors());

app.onError((err, c) => {
  logService.logAppError(err.message, err.stack);
  console.error('[ERROR]', err.message);
  return c.json({ error: err.message }, 500);
});

// Health check
app.get('/api/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// API routes
app.route('/api/repos', reposRouter(workspace, mdRefService, pipelineRegistry));
app.route('/api/credentials', credentialsRouter(credentialStore));
app.route('/api/agents', agentsRouter());
app.route('/api/mdfiles', mdfilesRouter(mdMgr, workspace, logService));
app.route('/api/settings', settingsRouter(settingsService, centralMdSync));
app.route('/api/pipeline', pipelineRouter(pipelineRegistry));
app.route('/api/tools', toolsRouter());
app.route('/api/automation', automationRouter(automationService));
app.route('/api/usage', usageRouter(usageService, repoManager));
app.route('/api/logs', logsRouter(logService));

// Keep API misses JSON-shaped. Without this, production SPA fallback can mask
// a missing route as index.html and the frontend reports a content-type error.
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Static frontend (production only)
if (Config.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: Config.STATIC_DIR }));
  // SPA fallback: return JSON 404 for unmatched /api/* paths, index.html for everything else
  app.get('/*', (c) => {
    if (c.req.path.startsWith('/api')) {
      return c.json({ error: 'Not found' }, 404);
    }
    try {
      const html = readFileSync(join(Config.STATIC_DIR, 'index.html'), 'utf-8');
      return c.html(html);
    } catch {
      return c.text('Frontend not found', 404);
    }
  });
}

// ── WebSocket servers ──────────────────────────────────────────────────────
// Use noServer:true for both so a single 'upgrade' handler can route by path.
// Using two WebSocketServers that each own the server's upgrade event causes
// the first one to destroy sockets whose path it doesn't recognise, preventing
// the second WSS from ever receiving connections.
const server = createAdaptorServer({ fetch: app.fetch });

const termWss = new WebSocketServer({ noServer: true });
const shellWss = new WebSocketServer({ noServer: true });
const notifyWss = new WebSocketServer({ noServer: true });

setupWebSocketServer(termWss, sessionStore, repoManager, credentialStore, pipelineRegistry, notificationBus);
setupShellServer(shellWss, settingsService);
setupNotifyServer(notifyWss, notificationBus);

// Re-discover repo md files whenever an agent session goes idle so that any
// md files created by the agent in its worktree appear in the right panel.
notificationBus.onSessionState((event) => {
  if (event.state !== 'idle') return;
  try {
    const session = sessionStore.get(event.sessionId);
    workspace.rediscoverRepoMdFiles(session.repo_id);
    notificationBus.emitMdFilesChanged({ scope: 'repo', repoId: session.repo_id });
  } catch (e) {
    console.warn('[Hive] Failed to re-discover repo md files after session idle:', e);
  }
});

server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const pathname = new URL(req.url ?? '', 'http://localhost').pathname;
  if (pathname === '/ws/terminal') {
    termWss.handleUpgrade(req, socket, head, (ws) => termWss.emit('connection', ws, req));
  } else if (pathname === '/ws/shell') {
    shellWss.handleUpgrade(req, socket, head, (ws) => shellWss.emit('connection', ws, req));
  } else if (pathname === '/ws/notify') {
    notifyWss.handleUpgrade(req, socket, head, (ws) => notifyWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(Config.PORT, () => {
  console.log(`[INFO] Hive running on http://localhost:${Config.PORT}`);
  console.log(`[INFO] Environment: ${Config.NODE_ENV}`);
  console.log(`[INFO] Data directory: ${Config.DATA_DIR}`);
});
