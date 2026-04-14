import { Hono } from 'hono';
import type { PipelineRegistry } from '../pipeline/pipeline-registry';

export function pipelineRouter(registry: PipelineRegistry): Hono {
  const app = new Hono();

  /** List all registered nodes with their current enabled state. */
  app.get('/', (c) => c.json(registry.list()));

  /** Toggle a node on or off. Returns the updated list. */
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ enabled: boolean }>();
    if (typeof body.enabled !== 'boolean') {
      return c.json({ error: '`enabled` must be a boolean' }, 400);
    }
    try {
      const updated = registry.setEnabled(id, body.enabled);
      return c.json(updated);
    } catch (err: unknown) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  return app;
}
