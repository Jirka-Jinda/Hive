import { Hono } from 'hono';
import { execSync } from 'node:child_process';
import { AGENT_ADAPTERS } from '../services/agents';

function isInstalled(command: string): boolean {
  try {
    const cmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

function getCredentialFields(agentId: string) {
  const fields: Record<string, { key: string; label: string; secret: boolean }[]> = {
    claude: [{ key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', secret: true }],
    chatgpt: [{ key: 'OPENAI_API_KEY', label: 'OpenAI API Key', secret: true }],
    copilot: [{ key: 'GH_TOKEN', label: 'GitHub Token', secret: true }],
  };
  return fields[agentId] ?? [];
}
