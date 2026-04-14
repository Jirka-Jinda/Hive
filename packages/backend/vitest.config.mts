import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
    // Forked workers exit cleanly, terminating chokidar watchers
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/routes/**', 'src/services/**'],
      exclude: ['src/ws/**', 'src/index.ts'],
    },
  },
});
