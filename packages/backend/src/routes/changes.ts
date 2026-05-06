import { Hono } from 'hono';
import type { ChangeFeedService } from '../services/change-feed-service';
import { jsonRoute } from './route-utils';

export function changesRouter(changeFeed: ChangeFeedService): Hono {
  const app = new Hono();

  app.get('/', (c) => jsonRoute(c, () => {
    const limitRaw = c.req.query('limit');
    const repoIdRaw = c.req.query('repoId');
    const sessionIdRaw = c.req.query('sessionId');

    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const repoId = repoIdRaw ? parseInt(repoIdRaw, 10) : undefined;
    const sessionId = sessionIdRaw ? parseInt(sessionIdRaw, 10) : undefined;

    if (Number.isNaN(limit)) throw new Error('limit must be a number');
    if (limit < 1 || limit > 200) throw new Error('limit must be between 1 and 200');
    if (repoIdRaw && Number.isNaN(repoId)) throw new Error('repoId must be a number');
    if (sessionIdRaw && Number.isNaN(sessionId)) throw new Error('sessionId must be a number');

    return changeFeed.list(limit, repoId, sessionId);
  }, { errorStatus: 400 }));

  return app;
}
