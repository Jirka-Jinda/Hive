/** Adapter interface — one implementation per supported CLI agent. */
export interface AgentAdapter {
  name: string;
  command: string;
  /** Regex tested against ANSI-stripped agent output to detect an idle prompt. */
  idlePattern: RegExp;
  buildArgs(envVars?: Record<string, string>): string[];
  envVars(envVars?: Record<string, string>): Record<string, string>;
}

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** Resolve the full path to a command, falling back to known Windows install dirs. */
export function resolveCommand(command: string): string {
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${command}` : `which ${command}`;
    const found = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0].trim();
    if (found && existsSync(found)) return found;
  } catch { /* fall through */ }

  if (process.platform === 'win32') {
    const knownPaths: Record<string, string[]> = {
      gh: ['C:\\Program Files\\GitHub CLI\\gh.exe'],
      claude: [
        `${process.env.APPDATA ?? ''}\\npm\\claude`,
        `${process.env.APPDATA ?? ''}\\npm\\claude.cmd`,
      ],
      copilot: [
        `${process.env.APPDATA ?? ''}\\npm\\copilot`,
        `${process.env.APPDATA ?? ''}\\npm\\copilot.cmd`,
        `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe`,
      ],
    };
    for (const p of knownPaths[command] ?? []) {
      if (existsSync(p)) return p;
    }
  }

  return command; // Fall back to bare name and let the OS resolve it
}

export const AGENT_ADAPTERS: Record<string, AgentAdapter> = {
  claude: {
    name: 'Claude CLI',
    command: 'claude',
    idlePattern: /^(>|claude>)\s*$/m,
    buildArgs: () => [],
    envVars: (env = {}) => ({
      ANTHROPIC_API_KEY: env['ANTHROPIC_API_KEY'] ?? '',
    }),
  },
  copilot: {
    name: 'GitHub Copilot CLI',
    command: 'copilot',
    idlePattern: /^(>|\?|copilot>)\s/m,
    buildArgs: () => [],
    envVars: (env = {}) => ({
      GH_TOKEN: env['GH_TOKEN'] ?? '',
    }),
  },
  'gh-copilot': {
    name: 'Copilot (gh extension)',
    command: 'gh',
    idlePattern: /^(>|\?)\s/m,
    buildArgs: () => ['copilot', 'suggest', '-t', 'shell'],
    envVars: (env = {}) => ({
      GH_TOKEN: env['GH_TOKEN'] ?? '',
    }),
  },
};

/** Returns the credential fields required by the given agent type. */
export function getCredentialFields(agentId: string): { key: string; label: string; secret: boolean }[] {
  const fields: Record<string, { key: string; label: string; secret: boolean }[]> = {
    claude: [{ key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', secret: true }],
    copilot: [{ key: 'GH_TOKEN', label: 'GitHub Token', secret: true }],
    'gh-copilot': [{ key: 'GH_TOKEN', label: 'GitHub Token', secret: true }],
  };
  return fields[agentId] ?? [];
}
