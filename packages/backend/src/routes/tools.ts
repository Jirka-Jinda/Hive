import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_ADAPTERS } from '../services/agents';
import { Config } from '../utils/config';
import { isInstalled } from '../utils/tool-detection';

function resolvePwsh(): string {
  const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  if (existsSync(ps7)) return ps7;
  return 'powershell.exe';
}

export function toolsRouter(): Hono {
  const app = new Hono();

  /** GET /api/tools — return install status for every registered agent */
  app.get('/', (c) => {
    const tools = Object.entries(AGENT_ADAPTERS).map(([id, adapter]) => ({
      id,
      name: adapter.name,
      command: adapter.command,
      installed: isInstalled(adapter.command),
    }));
    return c.json({ tools, anyMissing: tools.some((t) => !t.installed) });
  });

  /**
   * POST /api/tools/install — runs the install script and streams each
   * output line back as Server-Sent Events so the frontend can show live
   * progress without polling.
   *
   * Events:
   *   event: log   — informational line
   *   event: error — stderr / warning line
   *   event: done  — final line, installation finished
   */
  app.post('/install', (c) =>
    streamSSE(c, async (stream) => {
      const scriptPath = resolve(Config.PROJECT_ROOT, 'scripts', 'install-cli-tools.ps1');

      if (!existsSync(scriptPath)) {
        await stream.writeSSE({ event: 'error', data: `Script not found: ${scriptPath}` });
        await stream.writeSSE({ event: 'done', data: 'aborted' });
        return;
      }

      const shell = process.platform === 'win32' ? resolvePwsh() : 'bash';
      const args =
        process.platform === 'win32'
          ? ['-NoProfile', '-NonInteractive', '-File', scriptPath]
          : [scriptPath];

      await stream.writeSSE({ event: 'log', data: '==> Starting CLI tool installation...' });

      await new Promise<void>((resolve, reject) => {
        const child = spawn(shell, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env as Record<string, string>,
        });

        const flush = (chunk: Buffer, event: 'log' | 'error') => {
          const lines = chunk.toString().replace(/\r/g, '').split('\n').filter(Boolean);
          for (const line of lines) {
            void stream.writeSSE({ event, data: line });
          }
        };

        child.stdout?.on('data', (d: Buffer) => flush(d, 'log'));
        child.stderr?.on('data', (d: Buffer) => flush(d, 'error'));

        child.on('close', (code) => {
          if (code === 0 || code === null) resolve();
          else reject(new Error(`Script exited with code ${code}`));
        });
        child.on('error', reject);
      }).catch(async (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        await stream.writeSSE({ event: 'error', data: msg });
      });

      await stream.writeSSE({
        event: 'done',
        data: 'Installation finished. Restart Hive to detect newly installed tools.',
      });
    })
  );

  return app;
}
