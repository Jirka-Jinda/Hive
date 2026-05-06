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
import { createFuturePipelineNodes } from './pipeline/nodes/future-pipeline-nodes';
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
import { ChangeFeedService } from './services/change-feed-service';
import { changesRouter } from './routes/changes';

type StartupStatus = 'starting' | 'ready' | 'migration-failed' | 'fatal-error';

interface StartupState {
  status: StartupStatus;
  db: 'pending' | 'ok' | 'failed';
  migrations: 'pending' | 'ok' | 'failed';
  message: string | null;
  timestamp: string;
}

interface ReadyServices {
  db: ReturnType<typeof openDb>;
  logService: LogService;
  settingsService: SettingsService;
  notificationBus: NotificationBus;
  mdMgr: MdFileManager;
  centralMdSync: CentralMdSyncService;
  sessionStore: SessionStore;
  repoManager: RepoManager;
  credentialStore: CredentialStore;
  mdRefService: MdRefService;
  workspace: WorkspaceService;
  tokenCounter: TokenCounterService;
  usageService: UsageService;
  repoAgentMdWatcher: RepoAgentMdWatcher;
  pipelineRegistry: PipelineRegistry;
  automationService: AutomationService;
  changeFeed: ChangeFeedService;
}

const startupState: StartupState = {
  status: 'starting',
  db: 'pending',
  migrations: 'pending',
  message: null,
  timestamp: new Date().toISOString(),
};

function updateStartupState(updates: Partial<StartupState>): void {
  Object.assign(startupState, updates, { timestamp: new Date().toISOString() });
}

let services: ReadyServices | null = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────
// Capture unhandled errors before any other service initialises
process.on('uncaughtException', (err: Error) => {
  updateStartupState({ status: 'fatal-error', message: err.message });
  services?.logService.logAppError(err.message, err.stack);
  console.error('[FATAL] Uncaught exception', err);
});
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  updateStartupState({ status: 'fatal-error', message: err.message });
  services?.logService.logAppError(err.message, err.stack);
  console.error('[FATAL] Unhandled rejection', err);
});

try {
  const db = openDb(join(Config.DATA_DIR, 'app.db'));
  updateStartupState({ db: 'ok' });

  migrate(db);
  updateStartupState({ migrations: 'ok' });

  const logService = new LogService(db);
  const settingsService = new SettingsService();
  const notificationBus = new NotificationBus();
  const mdMgr = new MdFileManager(db);
  const centralMdSync = new CentralMdSyncService(mdMgr, settingsService, notificationBus);
  mdMgr.setSyncService(centralMdSync);
  centralMdSync.fullSync();
  centralMdSync.startWatching();

  const sessionStore = new SessionStore(db);
  sessionStore.stopRunningSessions();
  const repoManager = new RepoManager(db, settingsService);
  const credentialStore = new CredentialStore(db);
  const mdRefService = new MdRefService(db);
  const workspace = new WorkspaceService(db, mdMgr, settingsService, credentialStore, repoManager, sessionStore, logService);
  const tokenCounter = new TokenCounterService();
  const usageService = new UsageService(db);
  const repoAgentMdWatcher = new RepoAgentMdWatcher(workspace, notificationBus);
  const changeFeed = new ChangeFeedService(db);
  workspace.setAgentMdWatchRootsChangedHandler(() => repoAgentMdWatcher.refreshWatchedRoots());
  void workspace.reconcileGitWorktrees()
    .catch((error) => {
      console.error('[WARN] Failed to reconcile managed git worktrees on startup', error);
    })
    .finally(() => {
      repoAgentMdWatcher.startWatching();
    });

  const pipelineRegistry = new PipelineRegistry(settingsService);
  pipelineRegistry.register(createMdContextNode(mdRefService));
  for (const node of createFuturePipelineNodes()) {
    pipelineRegistry.register(node);
  }
  pipelineRegistry.register(createTokenUsageNode(sessionStore, usageService, tokenCounter));
  pipelineRegistry.register(createSessionStateWatcherNode(sessionStore, notificationBus));

  const automationService = new AutomationService(db, mdMgr, sessionStore, repoManager, pipelineRegistry, changeFeed);
  automationService.startAll();

  services = {
    db,
    logService,
    settingsService,
    notificationBus,
    mdMgr,
    centralMdSync,
    sessionStore,
    repoManager,
    credentialStore,
    mdRefService,
    workspace,
    tokenCounter,
    usageService,
    repoAgentMdWatcher,
    pipelineRegistry,
    automationService,
    changeFeed,
  };

  updateStartupState({ status: 'ready', message: null });
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  const status: StartupStatus = startupState.migrations !== 'ok' && startupState.db === 'ok'
    ? 'migration-failed'
    : 'fatal-error';
  updateStartupState({
    status,
    db: startupState.db === 'pending' ? 'failed' : startupState.db,
    migrations: startupState.migrations === 'pending' ? 'failed' : startupState.migrations,
    message: err.message,
  });
  console.error('[FATAL] Backend startup failed', err);
}

// ── Hono app ───────────────────────────────────────────────────────────────
const app = new Hono();

app.use('*', cors());

app.onError((err, c) => {
  updateStartupState({ status: 'fatal-error', message: err.message });
  services?.logService.logAppError(err.message, err.stack);
  console.error('[ERROR]', err.message);
  return c.json({ error: err.message }, 500);
});

// Health check
app.get('/api/health', (c) =>
  c.json({
    status: startupState.status === 'ready' ? 'ok' : 'degraded',
    readiness: startupState,
    timestamp: new Date().toISOString(),
  })
);

app.get('/api/readiness', (c) => c.json(startupState));

// API routes
if (services) {
  app.route('/api/repos', reposRouter(services.workspace, services.mdRefService, services.pipelineRegistry));
  app.route('/api/credentials', credentialsRouter(services.credentialStore));
  app.route('/api/agents', agentsRouter());
  app.route('/api/mdfiles', mdfilesRouter(services.mdMgr, services.workspace, services.logService, services.notificationBus, services.changeFeed));
  app.route('/api/settings', settingsRouter(services.settingsService, services.centralMdSync));
  app.route('/api/pipeline', pipelineRouter(services.pipelineRegistry));
  app.route('/api/tools', toolsRouter());
  app.route('/api/automation', automationRouter(services.automationService));
  app.route('/api/changes', changesRouter(services.changeFeed));
  app.route('/api/usage', usageRouter(services.usageService, services.repoManager));
  app.route('/api/logs', logsRouter(services.logService));

  // Re-discover repo md files whenever an agent session goes idle so that any
  // md files created by the agent in its worktree appear in the right panel.
  services.notificationBus.onSessionState((event) => {
    if (event.state !== 'idle') return;
    try {
      const session = services?.sessionStore.get(event.sessionId);
      if (!session || !services) return;
      const summary = services.workspace.rediscoverRepoMdFiles(session.repo_id);
      if (summary.repoChanged) {
        services.notificationBus.emitMdFilesChanged({ scope: 'repo', repoId: session.repo_id });
      }
      for (const sessionId of summary.sessionChangedIds) {
        services.notificationBus.emitMdFilesChanged({ scope: 'session', repoId: session.repo_id, sessionId });
      }
    } catch (e) {
      console.warn('[Hive] Failed to re-discover repo md files after session idle:', e);
    }
  });
} else {
  app.all('/api/*', (c) => c.json({ error: startupState.message ?? 'Backend not ready', readiness: startupState }, 503));
}

// Keep API misses JSON-shaped. Without this, production SPA fallback can mask
// a missing route as index.html and the frontend reports a content-type error.
if (services) {
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
}

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

if (services) {
  setupWebSocketServer(termWss, services.sessionStore, services.repoManager, services.credentialStore, services.pipelineRegistry, services.notificationBus);
  setupShellServer(shellWss, services.settingsService);
  setupNotifyServer(notifyWss, services.notificationBus);
}

server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  if (!services) {
    socket.destroy();
    return;
  }
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
