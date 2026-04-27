import { Hono } from 'hono';
import type { MdFileManager } from '../services/mdfile-manager';
import { parseFrontmatter, renderTemplate } from '../utils/template';
import { jsonRoute, parseIdParam } from './route-utils';

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

    return jsonRoute(c, () => mdMgr.create(body.scope, body.repoPath ?? null, body.filename, body.content, body.type), {
      successStatus: 201,
      errorStatus: 400,
    });
  });

  app.get('/:id', (c) => jsonRoute(c, () => {
    const { file, content } = mdMgr.read(parseIdParam(c, 'id'));
    return { ...file, content };
  }, { errorStatus: 404 }));

  app.put('/:id', async (c) => {
    const body = await c.req.json<{ content: string }>();

    return jsonRoute(c, () => mdMgr.write(parseIdParam(c, 'id'), body.content), { errorStatus: 404 });
  });

  app.delete('/:id', (c) => jsonRoute(c, () => {
    mdMgr.delete(parseIdParam(c, 'id'));
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
