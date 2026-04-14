/** Adapter interface — one implementation per supported CLI agent. */
export interface AgentAdapter {
  name: string;
  command: string;
  buildArgs(envVars?: Record<string, string>): string[];
  envVars(envVars?: Record<string, string>): Record<string, string>;
}

export const AGENT_ADAPTERS: Record<string, AgentAdapter> = {
  claude: {
    name: 'Claude CLI',
    command: 'claude',
    buildArgs: () => [],
    envVars: (env = {}) => ({
      ANTHROPIC_API_KEY: env['ANTHROPIC_API_KEY'] ?? '',
    }),
  },
  chatgpt: {
    name: 'ChatGPT CLI',
    command: 'chatgpt',
    buildArgs: () => [],
    envVars: (env = {}) => ({
      OPENAI_API_KEY: env['OPENAI_API_KEY'] ?? '',
    }),
  },
  copilot: {
    name: 'GitHub Copilot CLI',
    command: 'gh',
    buildArgs: () => ['copilot', 'suggest', '-t', 'shell'],
    envVars: (env = {}) => ({
      GH_TOKEN: env['GH_TOKEN'] ?? '',
    }),
  },
};
