import { Hono } from 'hono';
import type { LogService } from '../services/log-service';

export function logsRouter(logService: LogService) {
  const app = new Hono();

  app.get('/errors', (c) => c.json(logService.getAppErrors()));
  app.get('/actions', (c) => c.json(logService.getUserActions()));

  return app;
}
