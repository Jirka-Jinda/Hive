import { Hono } from 'hono';
import type { MdFile, MdFileManager } from '../services/mdfile-manager';
import type { WorkspaceService } from '../application/workspace-service';
import { parseFrontmatter, renderTemplate } from '../utils/template';
import { jsonRoute, parseIdParam } from './route-utils';
import { getErrorMessage } from '../utils/errors';
import type { LogService } from '../services/log-service';

export function mdfilesRouter(mdMgr: MdFileManager, workspace: WorkspaceService, logService: LogService): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const scope = c.req.query('scope');
    const repoIdStr = c.req.query('repoId');
    const sessionIdStr = c.req.query('sessionId');
    const repoId = repoIdStr ? parseInt(repoIdStr, 10) : undefined;
    const sessionId = sessionIdStr ? parseInt(sessionIdStr, 10) : undefined;
    return c.json(mdMgr.list(scope, repoId, sessionId));
  });

  app.post('/', async (c) => {
    const body = await c.req.json<{
      scope: 'central' | 'repo' | 'session';
      repoPath?: string;
      sessionId?: number;
      filename: string;
      content: string;
      type?: MdFile['type'];
    }>();

    return jsonRoute(c, () => {
      const file = mdMgr.create(body.scope, body.repoPath ?? null, body.filename, body.content, body.type, body.sessionId);
      logService.logUserAction(
        'create_md_file',
        `Created "${body.filename}" (${body.type ?? 'other'}) in ${body.scope}${body.repoPath ? ` at ${body.repoPath}` : ''}${body.sessionId !== undefined ? ` for session ${body.sessionId}` : ''}`,
      );
      if (file.scope === 'repo' && file.repo_id !== null) {
        void workspace.syncRepoFilesToAllWorktrees(file.repo_id);
      } else if (file.scope === 'session' && file.session_id !== null) {
        void workspace.syncSessionFilesToWorktree(file.session_id);
      }
      return file;
    }, {
      successStatus: 201,
      errorStatus: 400,
    });
  });

  app.get('/:id', (c) => jsonRoute(c, () => {
    const { file, content } = mdMgr.read(parseIdParam(c, 'id'));
    return { ...file, content };
  }, { errorStatus: 404 }));

  app.put('/:id', async (c) => {
    try {
      const id = parseIdParam(c, 'id');
      const body = await c.req.json<{
        content?: string;
        scope?: MdFile['scope'];
        repoPath?: string;
        sessionId?: number;
        filename?: string;
        type?: MdFile['type'];
      }>();
      const { file: before } = mdMgr.read(id);
      const updated = mdMgr.update(id, body);
      if (before.scope === 'repo' && before.repo_id !== null && (updated.scope !== 'repo' || before.path !== updated.path || before.repo_id !== updated.repo_id)) {
        workspace.deleteRepoFileFromAllWorktrees(before.repo_id, before.path);
      }
      if (before.scope === 'session' && before.session_id !== null && (updated.scope !== 'session' || before.path !== updated.path || before.session_id !== updated.session_id)) {
        workspace.deleteSessionFileFromWorktree(before.session_id, before.path);
      }
      if (updated.scope === 'repo' && updated.repo_id !== null) {
        void workspace.syncRepoFilesToAllWorktrees(updated.repo_id);
      } else if (updated.scope === 'session' && updated.session_id !== null) {
        void workspace.syncSessionFilesToWorktree(updated.session_id);
      }
      return c.json(updated);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400);
    }
  });

  app.delete('/:id', (c) => jsonRoute(c, () => {
    const id = parseIdParam(c, 'id');
    const { file } = mdMgr.read(id);
    mdMgr.delete(id);
    logService.logUserAction('delete_md_file', `Deleted "${file.path}"`);
    if (file.scope === 'repo' && file.repo_id !== null) {
      workspace.deleteRepoFileFromAllWorktrees(file.repo_id, file.path);
    } else if (file.scope === 'session' && file.session_id !== null) {
      workspace.deleteSessionFileFromWorktree(file.session_id, file.path);
    }
    return { ok: true };
  }, { errorStatus: 404 }));

  app.get('/:id/params', (c) => jsonRoute(c, () => {
    const { content } = mdMgr.read(parseIdParam(c, 'id'));
    const { meta } = parseFrontmatter(content);
    return { name: meta.name ?? '', description: meta.description ?? '', params: meta.params ?? [] };
  }, { errorStatus: 404 }));

  app.post('/:id/render', async (c) => {
    const body = await c.req.json<{ params: Record<string, string> }>();

    return jsonRoute(c, () => {
      const { content } = mdMgr.read(parseIdParam(c, 'id'));
      return { rendered: renderTemplate(content, body.params) };
    }, { errorStatus: 404 });
  });

  return app;
}
