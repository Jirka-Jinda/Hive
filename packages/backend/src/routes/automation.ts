import { Hono } from 'hono';
import type { AutomationService, CreateTaskBody } from '../services/automation-service';
import { jsonRoute, parseIdParam } from './route-utils';

export function automationRouter(automationService: AutomationService): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(automationService.list()));

  app.post('/', async (c) => {
    const body = await c.req.json<CreateTaskBody>();
    return jsonRoute(c, () => automationService.create(body), { successStatus: 201, errorStatus: 400 });
  });

  app.put('/:id/pause', (c) => jsonRoute(c, () => automationService.pause(parseIdParam(c, 'id')), { errorStatus: 404 }));

  app.put('/:id/resume', (c) => jsonRoute(c, () => automationService.resume(parseIdParam(c, 'id')), { errorStatus: 404 }));

  app.delete('/:id', (c) => jsonRoute(c, () => {
    automationService.delete(parseIdParam(c, 'id'));
    return { ok: true };
  }, { errorStatus: 404 }));

  return app;
}
