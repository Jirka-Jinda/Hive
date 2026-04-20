import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// __dirname is packages/backend/src/utils — go up 4 levels to project root
const PROJECT_ROOT = resolve(__dirname, '../../../..');

// On Windows, GUI/child processes often start with a stale PATH that misses
// user-installed tools (gh, claude, etc.). Read the real values from the
// registry before anything else runs so `where.exe` lookups work correctly.
if (process.platform === 'win32') {
  const regQuery = (hive: string): string => {
    try {
      const out = execSync(`reg query "${hive}" /v Path /reg:64`, { encoding: 'utf8', timeout: 2000 });
      const m = out.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i);
      return m ? m[1].trim() : '';
    } catch { return ''; }
  };
  const combined = [
    regQuery('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    regQuery('HKCU\\Environment'),
  ].filter(Boolean).join(';');
  if (combined) process.env.PATH = combined;
}

// Explicitly load .env from the project root so the path is correct regardless
// of which directory npm uses as CWD when running workspace scripts
dotenvConfig({ path: resolve(PROJECT_ROOT, '.env') });

if (!process.env.MASTER_PASSWORD) {
  console.warn(
    '[WARN] MASTER_PASSWORD is not set. Stored credentials will use weak key derivation. ' +
    'Set MASTER_PASSWORD in your .env file for production use.'
  );
}

export const Config = {
  PROJECT_ROOT,
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  DATA_DIR: resolve(PROJECT_ROOT, process.env.DATA_DIR ?? './packages/backend/data'),
  /** Root folder where all managed repositories live. Relative paths are resolved against PROJECT_ROOT. */
  REPOS_DIR: process.env.REPOS_DIR ?? './repos',
  /** Folder where central MD files are synced to/from disk — lives next to repos/ so terminal can cd between them. */
  CENTRAL_MD_DIR: resolve(PROJECT_ROOT, process.env.CENTRAL_MD_DIR ?? './central-md'),
  MASTER_PASSWORD: process.env.MASTER_PASSWORD ?? '',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  /** Absolute path to the compiled frontend build directory. Defaults to ./public (Docker / bare-metal). */
  STATIC_DIR: process.env.STATIC_DIR ?? './public',
} as const;
