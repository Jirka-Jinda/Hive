import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Config } from '../utils/config';

export interface PipelineNodeSettings {
  enabled: boolean;
}

export interface AuthSettings {
  enabled: boolean;
  /** Base64-encoded 4-digit PIN */
  pin: string;
}

export interface AppSettings {
  reposDir: string;
  pipeline: {
    nodes: Record<string, PipelineNodeSettings>;
  };
  auth: AuthSettings;
}

function envFilePath(): string {
  return resolve(process.cwd(), '.env');
}

function readEnvFile(): string {
  const path = envFilePath();
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function writeEnvKey(key: string, value: string): void {
  const path = envFilePath();
  let content = readEnvFile();
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + '\n' + line + '\n';
  }
  writeFileSync(path, content, 'utf-8');
}

export class SettingsService {
  load(): AppSettings {
    let pipelineNodes: Record<string, PipelineNodeSettings> = {};
    if (process.env.PIPELINE_NODES) {
      try { pipelineNodes = JSON.parse(process.env.PIPELINE_NODES); } catch { /* ignore malformed */ }
    }
    let auth: AuthSettings = { enabled: false, pin: '' };
    if (process.env.AUTH_SETTINGS) {
      try { auth = JSON.parse(process.env.AUTH_SETTINGS); } catch { /* ignore malformed */ }
    }
    return {
      reposDir: resolve(Config.PROJECT_ROOT, process.env.REPOS_DIR ?? Config.REPOS_DIR),
      pipeline: { nodes: pipelineNodes },
      auth,
    };
  }

  save(patch: Partial<AppSettings>): AppSettings {
    const current = this.load();
    const next: AppSettings = { ...current, ...patch };

    if (patch.reposDir !== undefined) {
      writeEnvKey('REPOS_DIR', patch.reposDir);
      // Update the live process so the running server picks it up immediately
      process.env.REPOS_DIR = patch.reposDir;
    }

    if (patch.pipeline !== undefined) {
      const json = JSON.stringify(patch.pipeline.nodes);
      writeEnvKey('PIPELINE_NODES', json);
      process.env.PIPELINE_NODES = json;
    }

    if (patch.auth !== undefined) {
      const json = JSON.stringify(patch.auth);
      writeEnvKey('AUTH_SETTINGS', json);
      process.env.AUTH_SETTINGS = json;
    }

    return next;
  }
}
