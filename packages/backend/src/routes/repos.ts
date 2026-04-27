import { Hono } from 'hono';
import type { WorkspaceService } from '../application/workspace-service';
import type { MdRefService } from '../services/md-ref-service';
import { getProcess } from '../services/process-manager';
import { jsonRoute, parseIdParam } from './route-utils';

export function reposRouter(workspace: WorkspaceService, mdRefService: MdRefService): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(workspace.listRepos()));

  app.get('/discovered', (c) => c.json(workspace.discoverRepos()));

  app.post('/', async (c) => {
    const body = await c.req.json<{ path?: string; gitUrl?: string; name?: string }>();
    return jsonRoute(c, () => workspace.createRepo(body), { successStatus: 201, errorStatus: 400 });
  });

  app.get('/:id', (c) => jsonRoute(c, () => workspace.getRepo(parseIdParam(c, 'id')), { errorStatus: 404 }));

  app.put('/:id', async (c) => {
    const repoId = parseIdParam(c, 'id');
    const body = await c.req.json<{ name?: string }>();
    if (!body.name?.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    return jsonRoute(c, () => workspace.updateRepo(repoId, { name: body.name! }), { errorStatus: 404 });
  });

  app.delete('/:id', (c) => jsonRoute(c, () => {
    const deleteFromDisk = c.req.query('deleteFromDisk') === 'true';
    workspace.deleteRepo(parseIdParam(c, 'id'), deleteFromDisk);
    return { ok: true };
  }, { errorStatus: 404 }));

  // --- Sessions sub-resource ---
  app.get('/:id/sessions', (c) => jsonRoute(c, () => workspace.listSessions(parseIdParam(c, 'id')), { errorStatus: 404 }));

  app.post('/:id/sessions', async (c) => {
    const repoId = parseIdParam(c, 'id');
    const body = await c.req.json<{
      name: string;
      agentType: string;
      credentialId?: number;
    }>();
    if (!body.name?.trim() || !body.agentType?.trim()) {
      return c.json({ error: 'name and agentType are required' }, 400);
    }

    return jsonRoute(c, () => workspace.createSession({
        repoId,
        name: body.name,
        agentType: body.agentType,
        credentialId: body.credentialId,
      }), { successStatus: 201, errorStatus: 400 });
  });

  app.delete('/:id/sessions/:sid', (c) => jsonRoute(c, () => {
    workspace.deleteSession(parseIdParam(c, 'id'), parseIdParam(c, 'sid'));
    return { ok: true };
  }, { errorStatus: 404 }));

  app.put('/:id/sessions/:sid', async (c) => {
    const repoId = parseIdParam(c, 'id');
    const sessionId = parseIdParam(c, 'sid');
    const body = await c.req.json<{ name?: string }>();
    if (!body.name?.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    return jsonRoute(c, () => workspace.updateSession(repoId, sessionId, { name: body.name! }), { errorStatus: 404 });
  });

  app.post('/:id/sessions/:sid/restart', (c) => {
    return jsonRoute(c, () => workspace.restartSession(parseIdParam(c, 'id'), parseIdParam(c, 'sid')), { errorStatus: 404 });
  });

  // --- MD refs sub-resources ---

  app.get('/:id/md-refs', (c) => {
    const repoId = parseIdParam(c, 'id');
    return c.json(mdRefService.getRepoRefs(repoId));
  });

  app.put('/:id/md-refs', async (c) => {
    const repoId = parseIdParam(c, 'id');
    const body = await c.req.json<{ mdFileIds: number[] }>();
    mdRefService.setRepoRefs(repoId, body.mdFileIds ?? []);
    return c.json({ ok: true });
  });

  app.get('/:id/sessions/:sid/md-refs', (c) => {
    const sessionId = parseIdParam(c, 'sid');
    return c.json(mdRefService.getSessionRefs(sessionId));
  });

  app.put('/:id/sessions/:sid/md-refs', async (c) => {
    const sessionId = parseIdParam(c, 'sid');
    const body = await c.req.json<{ mdFileIds: number[] }>();
    mdRefService.setSessionRefs(sessionId, body.mdFileIds ?? []);
    return c.json({ ok: true });
  });

  app.post('/:id/sessions/:sid/inject', async (c) => {
    const sessionId = parseIdParam(c, 'sid');
    const body = await c.req.json<{ text: string }>();
    const proc = getProcess(sessionId);
    if (!proc) return c.json({ error: 'Session not running' }, 404);
    proc.pty.write(body.text);
    return c.json({ ok: true });
  });

  return app;
}
