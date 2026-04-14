import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Config } from '../utils/config';

export interface AppSettings {
  reposDir: string;
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
    return {
      reposDir: resolve(process.env.REPOS_DIR ?? Config.REPOS_DIR),
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

    return next;
  }
}
