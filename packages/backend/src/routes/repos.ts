import { Hono } from 'hono';
import type { WorkspaceService } from '../application/workspace-service';
import type { MdRefService } from '../services/md-ref-service';
import { getErrorMessage } from '../utils/errors';
import { getProcess } from '../services/process-manager';

export function reposRouter(workspace: WorkspaceService, mdRefService: MdRefService): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(workspace.listRepos()));

  app.get('/discovered', (c) => c.json(workspace.discoverRepos()));

  app.post('/', async (c) => {
    const body = await c.req.json<{ path?: string; gitUrl?: string; name?: string }>();
    try {
      return c.json(await workspace.createRepo(body), 201);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.get('/:id', (c) => {
    try {
      return c.json(workspace.getRepo(parseInt(c.req.param('id'), 10)));
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.delete('/:id', (c) => {
    try {
      const deleteFromDisk = c.req.query('deleteFromDisk') === 'true';
      workspace.deleteRepo(parseInt(c.req.param('id'), 10), deleteFromDisk);
      return c.json({ ok: true });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  // --- Sessions sub-resource ---
  app.get('/:id/sessions', (c) => {
    try {
      return c.json(workspace.listSessions(parseInt(c.req.param('id'), 10)));
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.post('/:id/sessions', async (c) => {
    const repoId = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<{
      name: string;
      agentType: string;
      credentialId?: number;
    }>();
    if (!body.name?.trim() || !body.agentType?.trim()) {
      return c.json({ error: 'name and agentType are required' }, 400);
    }
    try {
      const session = workspace.createSession({
        repoId,
        name: body.name,
        agentType: body.agentType,
        credentialId: body.credentialId,
      });
      return c.json(session, 201);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.delete('/:id/sessions/:sid', (c) => {
    try {
      workspace.deleteSession(
        parseInt(c.req.param('id'), 10),
        parseInt(c.req.param('sid'), 10)
      );
      return c.json({ ok: true });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  // --- MD refs sub-resources ---

  app.get('/:id/md-refs', (c) => {
    const repoId = parseInt(c.req.param('id'), 10);
    return c.json(mdRefService.getRepoRefs(repoId));
  });

  app.put('/:id/md-refs', async (c) => {
    const repoId = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<{ mdFileIds: number[] }>();
    mdRefService.setRepoRefs(repoId, body.mdFileIds ?? []);
    return c.json({ ok: true });
  });

  app.get('/:id/sessions/:sid/md-refs', (c) => {
    const sessionId = parseInt(c.req.param('sid'), 10);
    return c.json(mdRefService.getSessionRefs(sessionId));
  });

  app.put('/:id/sessions/:sid/md-refs', async (c) => {
    const sessionId = parseInt(c.req.param('sid'), 10);
    const body = await c.req.json<{ mdFileIds: number[] }>();
    mdRefService.setSessionRefs(sessionId, body.mdFileIds ?? []);
    return c.json({ ok: true });
  });

  app.post('/:id/sessions/:sid/inject', async (c) => {
    const sessionId = parseInt(c.req.param('sid'), 10);
    const body = await c.req.json<{ text: string }>();
    const proc = getProcess(sessionId);
    if (!proc) return c.json({ error: 'Session not running' }, 404);
    proc.pty.write(body.text);
    return c.json({ ok: true });
  });

  return app;
}
