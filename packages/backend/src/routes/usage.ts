import { Hono } from 'hono';
import type { RepoManager } from '../services/repo-manager';
import type { UsageService } from '../services/usage-service';
import { jsonRoute } from './route-utils';

export function usageRouter(usageService: UsageService, repoManager: RepoManager): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const repoIdRaw = c.req.query('repoId');
    const repoId = repoIdRaw ? parseInt(repoIdRaw, 10) : undefined;
    return jsonRoute(c, () => {
      if (repoId !== undefined) {
        repoManager.get(repoId);
      }
      return usageService.getSummary(repoId);
    }, { errorStatus: 404 });
  });

  return app;
}