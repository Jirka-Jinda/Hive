import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/notify`;
const MAX_RETRY_DELAY_MS = 30_000;

export function useNotifications(): void {
  const updateSessionState = useAppStore((s) => s.updateSessionState);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1_000);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect(): void {
      if (cancelled) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelayRef.current = 1_000;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            type: string;
            sessionId: number;
            sessionName?: string;
            state: 'working' | 'idle' | 'stopped';
          };
          if (msg.type === 'session-state') {
            updateSessionState(msg.sessionId, msg.state, msg.sessionName ?? '');
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) {
          retryRef.current = setTimeout(() => {
            retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_DELAY_MS);
            connect();
          }, retryDelayRef.current);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [updateSessionState]);
}
