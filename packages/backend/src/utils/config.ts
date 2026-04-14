import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';

// __dirname is packages/backend/src/utils — go up 4 levels to project root
const PROJECT_ROOT = resolve(__dirname, '../../../..');

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
  DATA_DIR: process.env.DATA_DIR ?? './packages/backend/data',
  /** Root folder where all managed repositories live. Relative paths are resolved against PROJECT_ROOT. */
  REPOS_DIR: process.env.REPOS_DIR ?? './repos',
  MASTER_PASSWORD: process.env.MASTER_PASSWORD ?? '',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  /** Absolute path to the compiled frontend build directory. Defaults to ./public (Docker / bare-metal). */
  STATIC_DIR: process.env.STATIC_DIR ?? './public',
} as const;
