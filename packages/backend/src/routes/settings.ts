import { Hono } from 'hono';
import type { AuthSettings } from '../services/settings-service';
import { SettingsService } from '../services/settings-service';
import { CentralMdSyncService } from '../services/central-md-sync';
import { jsonRoute } from './route-utils';

export function settingsRouter(settingsService: SettingsService, centralMdSync: CentralMdSyncService): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(settingsService.load()));

  app.put('/', async (c) => {
    const body = await c.req.json<{ reposDir?: string; centralMdDir?: string; auth?: AuthSettings }>();
    return jsonRoute(c, async () => {
      const result = settingsService.save(body);
      if (body.centralMdDir !== undefined) {
        await centralMdSync.restartWithNewDir();
      }
      return result;
    }, { errorStatus: 400 });
  });

  return app;
}
