import { Hono } from 'hono';
import { AGENT_ADAPTERS, getCredentialFields } from '../services/agents';
import { isInstalled } from '../utils/tool-detection';

export function agentsRouter(): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const agents = Object.entries(AGENT_ADAPTERS).map(([id, adapter]) => ({
      id,
      name: adapter.name,
      command: adapter.command,
      installed: isInstalled(adapter.command),
      credentialFields: getCredentialFields(id),
    }));
    return c.json(agents);
  });

  return app;
}
