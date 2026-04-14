import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { MdFileManager } from '../services/mdfile-manager';
import { getErrorMessage } from '../utils/errors';

export function mdfilesRouter(db: Database.Database, mdMgr: MdFileManager): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const scope = c.req.query('scope');
    const repoIdStr = c.req.query('repoId');
    const repoId = repoIdStr ? parseInt(repoIdStr, 10) : undefined;
    return c.json(mdMgr.list(scope, repoId));
  });

  app.post('/', async (c) => {
    const body = await c.req.json<{
      scope: 'central' | 'repo';
      repoPath?: string;
      filename: string;
      content: string;
      type?: 'skill' | 'tool' | 'instruction' | 'other';
    }>();
    try {
      const file = mdMgr.create(body.scope, body.repoPath ?? null, body.filename, body.content, body.type);
      return c.json(file, 201);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.get('/:id', (c) => {
    try {
      const { file, content } = mdMgr.read(parseInt(c.req.param('id'), 10));
      return c.json({ ...file, content });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.put('/:id', async (c) => {
    const body = await c.req.json<{ content: string }>();
    try {
      const file = mdMgr.write(parseInt(c.req.param('id'), 10), body.content);
      return c.json(file);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.delete('/:id', (c) => {
    try {
      mdMgr.delete(parseInt(c.req.param('id'), 10));
      return c.json({ ok: true });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  return app;
}
