import 'dotenv/config';

if (!process.env.MASTER_PASSWORD) {
  console.warn(
    '[WARN] MASTER_PASSWORD is not set. Stored credentials will use weak key derivation. ' +
    'Set MASTER_PASSWORD in your .env file for production use.'
  );
}

export const Config = {
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  DATA_DIR: process.env.DATA_DIR ?? './packages/backend/data',
  /** Root folder where all managed repositories live. Clones go here; local-path picker lists from here. */
  REPOS_DIR: process.env.REPOS_DIR ?? './repos',
  MASTER_PASSWORD: process.env.MASTER_PASSWORD ?? '',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  /** Absolute path to the compiled frontend build directory. Defaults to ./public (Docker / bare-metal). */
  STATIC_DIR: process.env.STATIC_DIR ?? './public',
} as const;
