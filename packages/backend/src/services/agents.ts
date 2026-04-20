/** Adapter interface — one implementation per supported CLI agent. */
export interface AgentAdapter {
  name: string;
  command: string;
  /** Regex tested against ANSI-stripped agent output to detect an idle prompt. */
  idlePattern: RegExp;
  buildArgs(envVars?: Record<string, string>): string[];
  envVars(envVars?: Record<string, string>): Record<string, string>;
  /**
   * Optional one-time auth setup run synchronously before the agent process is
   * spawned.  Used to persist credentials to the OS credential store so they
   * survive across sessions without re-authentication.
   */
  setupAuth?: (envVars: Record<string, string>) => void;
}

import { existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { extname } from 'node:path';

/** Rank a Windows path so that .exe is preferred, then .cmd/.bat, then unknown
 *  extensions, and extensionless Unix shebang scripts are last (they are not
 *  valid PE executables and cause node-pty error 193 on Windows). */
function winRank(p: string): number {
  const ext = extname(p).toLowerCase();
  if (ext === '.exe') return 0;
  if (ext === '.cmd') return 1;
  if (ext === '.bat') return 2;
  if (ext) return 3;
  return 4; // no extension — Unix shell script, avoid on Windows
}

/** Resolve the full path to a command, falling back to known Windows install dirs. */
export function resolveCommand(command: string): string {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`where.exe ${command}`, { encoding: 'utf8', timeout: 3000 });
      const candidates = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && existsSync(s));
      if (candidates.length > 0) {
        // Pick the highest-ranked (lowest rank number) candidate
        return candidates.slice().sort((a, b) => winRank(a) - winRank(b))[0];
      }
    } catch { /* fall through */ }

    // Known absolute paths — .cmd/.exe variants listed before extensionless shims
    const knownPaths: Record<string, string[]> = {
      claude: [
        `${process.env.APPDATA ?? ''}\\npm\\claude.cmd`,
        `${process.env.APPDATA ?? ''}\\npm\\claude`,
      ],
      copilot: [
        `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe`,
        `${process.env.APPDATA ?? ''}\\npm\\copilot.cmd`,
        `${process.env.APPDATA ?? ''}\\npm\\copilot`,
      ],
      codex: [
        `${process.env.APPDATA ?? ''}\\npm\\codex.cmd`,
        `${process.env.LOCALAPPDATA ?? ''}\\npm\\codex.cmd`,
        `${process.env.APPDATA ?? ''}\\npm\\codex`,
        `${process.env.LOCALAPPDATA ?? ''}\\npm\\codex`,
      ],
    };
    for (const p of knownPaths[command] ?? []) {
      if (existsSync(p)) return p;
    }

    return command;
  }

  // Non-Windows: use which
  try {
    const found = execSync(`which ${command}`, { encoding: 'utf8', timeout: 3000 })
      .trim()
      .split('\n')[0]
      .trim();
    if (found && existsSync(found)) return found;
  } catch { /* fall through */ }

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
    // The copilot binary checks tokens in order: COPILOT_GITHUB_TOKEN >
    // GH_TOKEN > GITHUB_TOKEN > OS keychain (set by `copilot login`) > gh auth token.
    // Only fine-grained PATs (github_pat_) with "Copilot Requests" permission and
    // OAuth tokens (gho_) are supported. Classic PATs (ghp_) are NOT supported.
    // IMPORTANT: must not set empty-string env vars — that silently overrides
    // the OS keychain lookup (Windows Credential Manager) and breaks sessions
    // where the user authenticated via browser device-flow (`copilot login`).
    envVars: (env = {}) => {
      const token = env['COPILOT_GITHUB_TOKEN'];
      if (!token) return {};
      return {
        COPILOT_GITHUB_TOKEN: token,
        GH_TOKEN: token,
        GITHUB_TOKEN: token,
      };
    },
    // Persist the token to gh CLI's credential store (Windows Credential Manager)
    // so the Copilot binary authenticates via the `gh auth token` fallback on
    // every future session — even without a credential profile attached.
    // `gh auth login --with-token` reads from stdin; fails silently if gh is absent.
    setupAuth: (env = {}) => {
      const token = env['COPILOT_GITHUB_TOKEN'];
      if (!token) return;
      try {
        spawnSync('gh', ['auth', 'login', '--with-token'], {
          input: token,
          encoding: 'utf8',
          timeout: 5000,
        });
      } catch { /* gh not installed — no-op */ }
    },
  },
  codex: {
    name: 'Codex CLI',
    command: 'codex',
    // Matches the bare prompt line rendered by the Codex TUI after ANSI stripping
    idlePattern: /^\s*[>❯]\s*$/m,
    buildArgs: () => [],
    envVars: (env = {}) => ({
      OPENAI_API_KEY: env['OPENAI_API_KEY'] ?? '',
    }),
  },
};

/** Returns the credential fields required by the given agent type. */
export function getCredentialFields(agentId: string): { key: string; label: string; secret: boolean }[] {
  const fields: Record<string, { key: string; label: string; secret: boolean }[]> = {
    claude: [{ key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', secret: true }],
    copilot: [{ key: 'COPILOT_GITHUB_TOKEN', label: 'GitHub Classic PAT (ghp_) — gh auth login only accepts classic tokens', secret: true }],
    codex: [{ key: 'OPENAI_API_KEY', label: 'OpenAI API Key', secret: true }],
  };
  return fields[agentId] ?? [];
}
