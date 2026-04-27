/**
 * Preload script — runs in a Node.js context with access to the renderer's
 * window object, but isolated from it via contextBridge.
 *
 * Keep this minimal: only expose what the renderer needs that cannot be
 * done through the normal HTTP/WebSocket API.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  platform: process.platform,
  openInVsCode: (targetPath: string) =>
    ipcRenderer.invoke('system:open-in-vscode', targetPath) as Promise<void>,
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>,
  setFullscreen: (value: boolean) =>
    ipcRenderer.invoke('window:set-fullscreen', value) as Promise<boolean>,
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen') as Promise<boolean>,
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => {
      callback(isFullscreen);
    };
    ipcRenderer.on('window:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
  },
});
