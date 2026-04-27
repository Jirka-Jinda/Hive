import { Hono } from 'hono';
import type { CredentialStore } from '../services/credential-store';
import { jsonRoute, parseIdParam } from './route-utils';

export function credentialsRouter(store: CredentialStore): Hono {
  const app = new Hono();

  // List returns metadata only — never exposes encrypted_data
  app.get('/', (c) => c.json(store.list()));

  app.post('/', async (c) => {
    const body = await c.req.json<{ name: string; agentType: string; data: { envVars: Record<string, string> } }>();
    if (!body.name?.trim() || !body.agentType?.trim()) {
      return c.json({ error: 'name and agentType are required' }, 400);
    }

    return jsonRoute(c, () => store.create(body.name.trim(), body.agentType, body.data), {
      successStatus: 201,
      errorStatus: 400,
    });
  });

  app.put('/:id', async (c) => {
    const id = parseIdParam(c, 'id');
    const body = await c.req.json<{ name: string; agentType: string; data: { envVars: Record<string, string> } }>();
    if (!body.name?.trim() || !body.agentType?.trim()) {
      return c.json({ error: 'name and agentType are required' }, 400);
    }

    return jsonRoute(c, () => store.update(id, body.name.trim(), body.agentType, body.data), {
      errorStatus: 404,
    });
  });

  app.delete('/:id', (c) => jsonRoute(c, () => {
    store.delete(parseIdParam(c, 'id'));
    return { ok: true };
  }, { errorStatus: 404 }));

  return app;
}
