import { Hono } from 'hono';
import type { AutomationService, CreateTaskBody } from '../services/automation-service';
import { getErrorMessage } from '../utils/errors';

export function automationRouter(automationService: AutomationService): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(automationService.list()));

  app.post('/', async (c) => {
    try {
      const body = await c.req.json<CreateTaskBody>();
      const task = automationService.create(body);
      return c.json(task, 201);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.put('/:id/pause', (c) => {
    try {
      const task = automationService.pause(parseInt(c.req.param('id'), 10));
      return c.json(task);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.put('/:id/resume', (c) => {
    try {
      const task = automationService.resume(parseInt(c.req.param('id'), 10));
      return c.json(task);
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.delete('/:id', (c) => {
    try {
      automationService.delete(parseInt(c.req.param('id'), 10));
      return c.json({ ok: true });
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  return app;
}
