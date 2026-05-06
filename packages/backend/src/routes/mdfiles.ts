import { Hono } from 'hono';
import type { MdFile, MdFileManager } from '../services/mdfile-manager';
import type { WorkspaceService } from '../application/workspace-service';
import { parseFrontmatter, renderTemplate } from '../utils/template';
import { jsonRoute, parseIdParam } from './route-utils';
import { getErrorMessage } from '../utils/errors';
import type { LogService } from '../services/log-service';
import type { NotificationBus } from '../services/notification-bus';
import type { ChangeFeedService } from '../services/change-feed-service';

function emitMdFilesChanged(notificationBus: NotificationBus, file: Pick<MdFile, 'scope' | 'repo_id' | 'session_id'>): void {
  if (file.scope === 'central') {
    notificationBus.emitMdFilesChanged({ scope: 'central' });
    return;
  }

  if (file.scope === 'repo') {
    notificationBus.emitMdFilesChanged({ scope: 'repo', repoId: file.repo_id ?? undefined });
    return;
  }

  notificationBus.emitMdFilesChanged({
    scope: 'session',
    repoId: file.repo_id ?? undefined,
    sessionId: file.session_id ?? undefined,
  });
}

function emitMdFilesTransition(notificationBus: NotificationBus, before: MdFile, after: MdFile): void {
  const identityChanged =
    before.scope !== after.scope ||
    before.repo_id !== after.repo_id ||
    before.session_id !== after.session_id ||
    before.path !== after.path;

  if (identityChanged) {
    emitMdFilesChanged(notificationBus, before);
  }
  emitMdFilesChanged(notificationBus, after);
}

export function mdfilesRouter(mdMgr: MdFileManager, workspace: WorkspaceService, logService: LogService, notificationBus: NotificationBus, changeFeed?: ChangeFeedService): Hono {
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
      mdMgr.recordRevision(file.id, body.content, 'user-create');
      logService.logUserAction(
        'create_md_file',
        `Created "${body.filename}" (${body.type ?? 'other'}) in ${body.scope}${body.repoPath ? ` at ${body.repoPath}` : ''}${body.sessionId !== undefined ? ` for session ${body.sessionId}` : ''}`,
      );
      if (file.scope === 'repo' && file.repo_id !== null) {
        void workspace.syncRepoFilesToAllWorktrees(file.repo_id);
      } else if (file.scope === 'session' && file.session_id !== null) {
        void workspace.syncSessionFilesToWorktree(file.session_id);
      }
      emitMdFilesChanged(notificationBus, file);
      changeFeed?.recordMdCreated(file);
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
      const { file: before, content: beforeContent } = mdMgr.read(id);
      const updated = mdMgr.update(id, body);
      if (body.content !== undefined && body.content !== beforeContent) {
        mdMgr.recordRevision(updated.id, body.content, 'user-save');
      }
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
      emitMdFilesTransition(notificationBus, before, updated);
      if (before.scope !== updated.scope || before.path !== updated.path) {
        changeFeed?.recordMdMoved(before, updated);
      } else if (body.content !== undefined || body.type !== undefined) {
        changeFeed?.recordMdUpdated(updated);
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
    emitMdFilesChanged(notificationBus, file);
    changeFeed?.recordMdDeleted(file);
    return { ok: true };
  }, { errorStatus: 404 }));

  app.get('/:id/params', (c) => jsonRoute(c, () => {
    const { content } = mdMgr.read(parseIdParam(c, 'id'));
    const { meta } = parseFrontmatter(content);
    return { name: meta.name ?? '', description: meta.description ?? '', params: meta.params ?? [] };
  }, { errorStatus: 404 }));

  app.get('/:id/revisions', (c) => jsonRoute(c, () => {
    return mdMgr.listRevisions(parseIdParam(c, 'id'));
  }, { errorStatus: 404 }));

  app.get('/:id/revisions/:rid', (c) => jsonRoute(c, () => {
    return mdMgr.readRevision(parseIdParam(c, 'id'), parseIdParam(c, 'rid'));
  }, { errorStatus: 404 }));

  app.post('/:id/revisions/:rid/restore', (c) => jsonRoute(c, () => {
    const id = parseIdParam(c, 'id');
    const { file: before } = mdMgr.read(id);
    const restored = mdMgr.restoreRevision(id, parseIdParam(c, 'rid'));
    if (restored.scope === 'repo' && restored.repo_id !== null) {
      void workspace.syncRepoFilesToAllWorktrees(restored.repo_id);
    } else if (restored.scope === 'session' && restored.session_id !== null) {
      void workspace.syncSessionFilesToWorktree(restored.session_id);
    }
    emitMdFilesTransition(notificationBus, before, restored);
    changeFeed?.recordMdRestored(restored);
    return restored;
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
