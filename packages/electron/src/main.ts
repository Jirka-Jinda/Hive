import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
  UtilityProcess,
} from 'electron';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns true when running from source (not a packaged build). */
const isDev = !app.isPackaged;

/**
 * Derives a stable, machine-unique password for credential encryption.
 * Stored data can only be decrypted on the same machine — intentional.
 */
function getMachinePassword(): string {
  const seed = [os.hostname(), os.platform(), os.arch(), os.homedir()].join(':');
  return crypto.createHash('sha256').update(seed).digest('hex');
}

/** Finds a free TCP port, preferring `preferred`. */
function findFreePort(preferred = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(preferred, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Preferred port is busy — ask OS for any free port.
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const { port } = fallback.address() as net.AddressInfo;
        fallback.close(() => resolve(port));
      });
      fallback.on('error', reject);
    });
  });
}

/** Polls /api/health until the backend is ready or we give up. */
async function waitForBackend(port: number, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Backend did not become ready on port ${port}`);
}

// ── State ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let backend: UtilityProcess | null = null;
let backendPort = 3000;

// Flag to distinguish user-initiated quit from unexpected backend crash
let appIsQuitting = false;

function sendFullscreenState(window: BrowserWindow): void {
  window.webContents.send('window:fullscreen-changed', window.isFullScreen());
}

async function setWindowFullscreen(window: BrowserWindow, nextState: boolean): Promise<boolean> {
  if (window.isFullScreen() === nextState) return nextState;

  await new Promise<void>((resolve) => {
    if (nextState) {
      window.once('enter-full-screen', () => resolve());
    } else {
      window.once('leave-full-screen', () => resolve());
    }
    window.setFullScreen(nextState);
  });

  return window.isFullScreen();
}

function bindWindowEvents(window: BrowserWindow): void {
  window.on('enter-full-screen', () => sendFullscreenState(window));
  window.on('leave-full-screen', () => sendFullscreenState(window));
}

// ── Backend lifecycle ──────────────────────────────────────────────────────

async function startBackend(): Promise<number> {
  const port = await findFreePort(3000);
  backendPort = port;

  /**
   * Resolve the backend entry script path:
   *   dev  → packages/electron/dist/ → ../../.. → repo root → packages/backend/dist/index.js
   *   prod → resources/app/dist/     →  ..      → resources/app/backend/index.js
   */
  const backendEntry = isDev
    ? path.join(__dirname, '..', '..', '..', 'packages', 'backend', 'dist', 'index.js')
    : path.join(__dirname, '..', 'backend', 'index.js');

  const staticDir = isDev
    ? path.join(__dirname, '..', '..', '..', 'packages', 'frontend', 'dist')
    : path.join(__dirname, '..', 'public');

  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  backend = utilityProcess.fork(backendEntry, [], {
    serviceName: 'aw-backend',
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      STATIC_DIR: staticDir,
      NODE_ENV: 'production',
      MASTER_PASSWORD: getMachinePassword(),
    },
  });

  backend.stdout?.on('data', (d: Buffer) =>
    process.stdout.write(`[backend] ${d}`)
  );
  backend.stderr?.on('data', (d: Buffer) =>
    process.stderr.write(`[backend] ${d}`)
  );

  backend.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
    backend = null;
    if (mainWindow && !appIsQuitting) {
      dialog.showErrorBox(
        'AI Workspace — Backend stopped',
        `The backend process exited unexpectedly (code ${code}). The application will quit.`
      );
      app.quit();
    }
  });

  return port;
}

/** Gracefully stop the backend subprocess. */
function stopBackend(): void {
  if (backend) {
    backend.kill();
    backend = null;
  }
}

// ── Window ─────────────────────────────────────────────────────────────────

async function createWindow(port: number): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#030712',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Allow WebSocket connections back to localhost
      webSecurity: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'AI Workspace Manager',
  });
  bindWindowEvents(mainWindow);

  // Open external links in default browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // In dev we can optionally open devtools.
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.show();
  mainWindow.focus();
  sendFullscreenState(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────

/** In dev mode use a local URL (Vite or backend) rather than spawning a second backend. */
async function startDev(): Promise<void> {
  // wait-on in the npm script already guaranteed localhost:5173 is up before
  // Electron was launched, so we load Vite directly without a fetch probe.
  const startUrl = 'http://127.0.0.1:5173';

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#030712',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'AI Workspace Manager [dev]',
  });
  bindWindowEvents(mainWindow);

  mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(startUrl);
  mainWindow.show();
  sendFullscreenState(mainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('window:is-fullscreen', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
});

ipcMain.handle('window:set-fullscreen', (event, value: boolean) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  return setWindowFullscreen(window, Boolean(value));
});

ipcMain.handle('window:toggle-fullscreen', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  return setWindowFullscreen(window, !window.isFullScreen());
});

app.on('ready', async () => {
  try {
    if (isDev) {
      await startDev();
    } else {
      const port = await startBackend();
      await waitForBackend(port);
      await createWindow(port);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox('AI Workspace — Startup failed', msg);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (isDev) {
      await startDev();
    } else {
      await createWindow(backendPort);
    }
  }
});

app.on('before-quit', () => {
  appIsQuitting = true;
  stopBackend();
});
