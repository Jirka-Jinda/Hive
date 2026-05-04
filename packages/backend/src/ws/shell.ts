import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { spawn } from 'node-pty';
import { platform } from 'node:process';
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { SettingsService } from '../services/settings-service';

/**
 * Resolve the best available PowerShell on Windows.
 *
 * node-pty with useConpty:false (WinPTY) cannot follow the WindowsApps
 * "app execution alias" reparse points, so we resolve the real binary path
 * from the MSIX Store package via a fast registry query.
 *
 * Priority:
 *   1. MSIX Store package (winget / MS Store install — always latest).
 *   2. MSI / traditional install (C:\Program Files\PowerShell\7\).
 *   3. Fallback inbox Windows PowerShell 5.x.
 */
function resolveWindowsShell(): string {
  // 1. Query the MSIX package registry for the real install path (~10ms, no admin)
  try {
    const regKey =
      'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages';
    const search = execSync(`reg query "${regKey}" /f "Microsoft.PowerShell_" /k /reg:64`, {
      encoding: 'utf8',
      timeout: 2000,
    });
    // Find the matching subkey(s) — pick the highest version (last after sort)
    const keys = search
      .match(/HKEY_CURRENT_USER\\[^\r\n]*Microsoft\.PowerShell_[^\r\n]+/g)
      ?.sort() ?? [];
    // Walk in reverse so highest version is tried first
    for (let i = keys.length - 1; i >= 0; i--) {
      try {
        const vals = execSync(`reg query "${keys[i]}" /v PackageRootFolder /reg:64`, {
          encoding: 'utf8',
          timeout: 2000,
        });
        const m = vals.match(/PackageRootFolder\s+REG_SZ\s+(.*)/i);
        if (m) {
          const candidate = join(m[1].trim(), 'pwsh.exe');
          if (existsSync(candidate)) return candidate;
        }
      } catch { /* skip this key */ }
    }
  } catch {
    /* No MSIX package found — that's fine */
  }

  // 2. Traditional MSI install
  const ps7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  if (existsSync(ps7)) return ps7;

  // 3. Fallback
  return 'powershell.exe';
}

export function setupShellServer(wss: WebSocketServer, settingsService: SettingsService): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const cols = Math.max(20, Math.min(500, parseInt(url.searchParams.get('cols') ?? '', 10) || 80));
    const rows = Math.max(5,  Math.min(200, parseInt(url.searchParams.get('rows') ?? '', 10) || 24));

    const shell = platform === 'win32' ? resolveWindowsShell() : 'bash';

    // Start in the central-md/ directory — Copilot/Claude can directly edit
    // central MD files and cd ../repos to switch to the repos folder.
    const centralMdDir = settingsService.load().centralMdDir;
    mkdirSync(centralMdDir, { recursive: true });
    const cwd = centralMdDir;

    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
      // Force WinPTY on Windows — ConPTY's console-list agent crashes for
      // interactive shells when the native helper binary is not pre-built.
      useConpty: false,
    });

    pty.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(data));
    });

    pty.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Shell exited');
    });

    ws.on('message', (msg: Buffer | string) => {
      const raw = msg instanceof Buffer ? msg : Buffer.from(msg as string);
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'resize' && typeof parsed.cols === 'number') {
          pty.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON — treat as terminal input
      }
      pty.write(raw.toString());
    });

    const kill = () => { try { pty.kill(); } catch { /* already dead */ } };
    ws.on('close', kill);
    ws.on('error', kill);
  });
}
