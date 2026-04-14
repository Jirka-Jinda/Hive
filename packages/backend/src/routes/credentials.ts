import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { CredentialStore } from '../services/credential-store';
import { getErrorMessage } from '../utils/errors';

export function credentialsRouter(db: Database.Database): Hono {
  const app = new Hono();
  const store = new CredentialStore(db);

  // List returns metadata only — never exposes encrypted_data
  app.get('/', (c) => c.json(store.list()));

  app.post('/', async (c) => {
    const body = await c.req.json<{ name: string; agentType: string; data: { envVars: Record<string, string> } }>();
    if (!body.name?.trim() || !body.agentType?.trim()) {
      return c.json({ error: 'name and agentType are required' }, 400);
    }
    try {
      return c.json(store.create(body.name.trim(), body.agentType, body.data), 201);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.put('/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<{ name: string; agentType: string; data: { envVars: Record<string, string> } }>();
    if (!body.name?.trim() || !body.agentType?.trim()) {
      return c.json({ error: 'name and agentType are required' }, 400);
    }
    try {
      return c.json(store.update(id, body.name.trim(), body.agentType, body.data));
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.delete('/:id', (c) => {
    try {
      store.delete(parseInt(c.req.param('id'), 10));
      return c.json({ ok: true });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  return app;
}
