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
import { setupWebSocketServer } from './ws/terminal';
import { MdFileManager } from './services/mdfile-manager';
import { SettingsService } from './services/settings-service';
import { join as pathJoin } from 'node:path';
import { WorkspaceService } from './application/workspace-service';

// ── Bootstrap ──────────────────────────────────────────────────────────────
const db = openDb(pathJoin(Config.DATA_DIR, 'app.db'));
migrate(db);
const settingsService = new SettingsService();
const mdMgr = new MdFileManager(db);
const workspace = new WorkspaceService(db, mdMgr, settingsService);
workspace.hydrateRepoArtifacts();

// ── Hono app ───────────────────────────────────────────────────────────────
const app = new Hono();

app.use('*', cors());

app.onError((err, c) => {
  console.error('[ERROR]', err.message);
  return c.json({ error: err.message }, 500);
});

// Health check
app.get('/api/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// API routes
app.route('/api/repos', reposRouter(db, mdMgr, settingsService));
app.route('/api/credentials', credentialsRouter(db));
app.route('/api/agents', agentsRouter());
app.route('/api/mdfiles', mdfilesRouter(db, mdMgr));
app.route('/api/settings', settingsRouter(settingsService));

// Static frontend (production only)
if (Config.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: Config.STATIC_DIR }));
  // SPA fallback
  app.get('/*', (c) => {
    try {
      const html = readFileSync(join(Config.STATIC_DIR, 'index.html'), 'utf-8');
      return c.html(html);
    } catch {
      return c.text('Frontend not found', 404);
    }
  });
}

// ── Server ─────────────────────────────────────────────────────────────────
const server = createAdaptorServer({ fetch: app.fetch });
setupWebSocketServer(server, db);

server.listen(Config.PORT, () => {
  console.log(`[INFO] AI Workspace Manager running on http://localhost:${Config.PORT}`);
  console.log(`[INFO] Environment: ${Config.NODE_ENV}`);
  console.log(`[INFO] Data directory: ${Config.DATA_DIR}`);
});
