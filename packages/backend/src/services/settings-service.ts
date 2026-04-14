import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Config } from '../utils/config';

export interface AppSettings {
  reposDir: string;
}

function settingsPath(): string {
  return resolve(Config.DATA_DIR, 'settings.json');
}

function defaults(): AppSettings {
  return { reposDir: resolve(Config.REPOS_DIR) };
}

export class SettingsService {
  private cache: AppSettings | null = null;

  load(): AppSettings {
    if (this.cache) return this.cache;
    const path = settingsPath();
    if (!existsSync(path)) {
      this.cache = defaults();
      return this.cache;
    }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppSettings>;
      this.cache = { ...defaults(), ...raw };
    } catch {
      this.cache = defaults();
    }
    return this.cache;
  }

  save(patch: Partial<AppSettings>): AppSettings {
    const current = this.load();
    const next: AppSettings = { ...current, ...patch };
    const path = settingsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8');
    this.cache = next;
    return next;
  }
}
