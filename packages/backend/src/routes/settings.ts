import { Hono } from 'hono';
import type { AuthSettings } from '../services/settings-service';
import { SettingsService } from '../services/settings-service';
import { jsonRoute } from './route-utils';

export function settingsRouter(settingsService: SettingsService): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(settingsService.load()));

  app.put('/', async (c) => {
    const body = await c.req.json<{ reposDir?: string; centralMdDir?: string; auth?: AuthSettings }>();
    return jsonRoute(c, () => settingsService.save(body), { errorStatus: 400 });
  });

  return app;
}
