import { WebSocketServer, WebSocket } from 'ws';
import type { NotificationBus } from '../services/notification-bus.js';

export function setupNotifyServer(wss: WebSocketServer, bus: NotificationBus): void {
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  bus.onSessionState((event) => {
    const msg = JSON.stringify({ type: 'session-state', ...event });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  });

  bus.onMdFilesChanged((event) => {
    const msg = JSON.stringify({ type: 'md-files-changed', ...event });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  });
}
