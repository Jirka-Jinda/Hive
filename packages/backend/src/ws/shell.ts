import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'node-pty';
import { platform } from 'node:process';

export function setupShellServer(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    // Prefer PowerShell 7 (pwsh) on Windows; fall back to built-in powershell.exe if not installed.
    const shell = platform === 'win32' ? 'pwsh.exe' : 'bash';
    // Windows uses USERPROFILE, Unix uses HOME
    const home = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();

    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: home,
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
