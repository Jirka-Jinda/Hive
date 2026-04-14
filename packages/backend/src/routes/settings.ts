import { Hono } from 'hono';
import type { AuthSettings } from '../services/settings-service';
import { SettingsService } from '../services/settings-service';
import { getErrorMessage } from '../utils/errors';

export function settingsRouter(settingsService: SettingsService): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(settingsService.load()));

  app.put('/', async (c) => {
    try {
      const body = await c.req.json<{ reposDir?: string; auth?: AuthSettings }>();
      return c.json(settingsService.save(body));
    } catch (error: unknown) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  return app;
}
