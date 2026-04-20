import { Hono } from 'hono';
import type { MdFileManager } from '../services/mdfile-manager';
import { getErrorMessage } from '../utils/errors';
import { parseFrontmatter, renderTemplate } from '../utils/template';

export function mdfilesRouter(mdMgr: MdFileManager): Hono {
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

  app.get('/:id/params', (c) => {
    try {
      const { content } = mdMgr.read(parseInt(c.req.param('id'), 10));
      const { meta } = parseFrontmatter(content);
      return c.json({ name: meta.name ?? '', description: meta.description ?? '', params: meta.params ?? [] });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.post('/:id/render', async (c) => {
    const body = await c.req.json<{ params: Record<string, string> }>();
    try {
      const { content } = mdMgr.read(parseInt(c.req.param('id'), 10));
      const rendered = renderTemplate(content, body.params);
      return c.json({ rendered });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  return app;
}
