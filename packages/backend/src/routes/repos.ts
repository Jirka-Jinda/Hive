import { Hono } from 'hono';
import type { WorkspaceService } from '../application/workspace-service';
import type { MdRefService } from '../services/md-ref-service';
import { getProcess } from '../services/process-manager';
import { jsonRoute, parseIdParam } from './route-utils';

export function reposRouter(workspace: WorkspaceService, mdRefService: MdRefService): Hono {
  const app = new Hono();

  const parseOptionalQueryId = (raw: string | undefined, name: string): number | undefined => {
    if (!raw) return undefined;
    const value = parseInt(raw, 10);
    if (Number.isNaN(value)) {
      throw new Error(`${name} must be a number`);
    }
    return value;
  };

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

  app.delete('/:id', (c) => jsonRoute(c, async () => {
    const deleteFromDisk = c.req.query('deleteFromDisk') === 'true';
    await workspace.deleteRepo(parseIdParam(c, 'id'), deleteFromDisk);
    return { ok: true };
  }, { errorStatus: 404 }));

  app.get('/:id/git/branches', (c) => jsonRoute(c, () => {
    return workspace.listGitBranches(parseIdParam(c, 'id'), c.req.query('q') ?? undefined);
  }, { errorStatus: 404 }));

  app.get('/:id/git/status', (c) => jsonRoute(c, () => {
    return workspace.getGitStatus(
      parseIdParam(c, 'id'),
      parseOptionalQueryId(c.req.query('sessionId'), 'sessionId'),
    );
  }, { errorStatus: 404 }));

  app.get('/:id/git/history', (c) => jsonRoute(c, () => {
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
    if (limitRaw && Number.isNaN(limit)) {
      throw new Error('limit must be a number');
    }

    return workspace.getGitHistory(
      parseIdParam(c, 'id'),
      parseOptionalQueryId(c.req.query('sessionId'), 'sessionId'),
      limit,
    );
  }, { errorStatus: 404 }));

  // --- Sessions sub-resource ---
  app.get('/:id/sessions', (c) => jsonRoute(c, () => workspace.listSessions(parseIdParam(c, 'id')), { errorStatus: 404 }));

  app.post('/:id/sessions', async (c) => {
    const repoId = parseIdParam(c, 'id');
    const body = await c.req.json<{
      name: string;
      agentType: string;
      credentialId?: number;
      branchMode?: 'new' | 'existing' | 'root';
      branchName?: string;
    }>();
    if (!body.name?.trim() || !body.agentType?.trim()) {
      return c.json({ error: 'name and agentType are required' }, 400);
    }

    return jsonRoute(c, () => workspace.createSession({
        repoId,
        name: body.name,
        agentType: body.agentType,
        credentialId: body.credentialId,
        branchMode: body.branchMode,
        branchName: body.branchName,
      }), { successStatus: 201, errorStatus: 400 });
  });

  app.delete('/:id/sessions/:sid', (c) => jsonRoute(c, async () => {
    await workspace.deleteSession(parseIdParam(c, 'id'), parseIdParam(c, 'sid'));
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

  // --- Session agent files (worktree-only .agent/ files not yet promoted to repo) ---

  app.get('/:id/sessions/:sid/agent-files', (c) => jsonRoute(c, () => {
    return workspace.listSessionAgentFiles(parseIdParam(c, 'id'), parseIdParam(c, 'sid'));
  }, { errorStatus: 404 }));

  app.post('/:id/sessions/:sid/agent-files/promote', async (c) => {
    const repoId = parseIdParam(c, 'id');
    const sessionId = parseIdParam(c, 'sid');
    const body = await c.req.json<{ agentRelativePath: string }>();
    if (!body.agentRelativePath?.trim()) {
      return c.json({ error: 'agentRelativePath is required' }, 400);
    }
    return jsonRoute(c, () => workspace.promoteSessionAgentFile(repoId, sessionId, body.agentRelativePath), {
      successStatus: 201,
      errorStatus: 400,
    });
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
