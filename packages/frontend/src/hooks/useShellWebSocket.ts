import { useEffect, useRef, useCallback } from 'react';

const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_DELAY_MS = 15000;

/** Connects to /ws/shell and automatically reconnects on close/error. */
export function useShellWebSocket(onData: (data: Uint8Array) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onDataRef = useRef(onData);
  const delayRef = useRef(RECONNECT_DELAY_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // Resize queued while the socket is still connecting / reconnecting
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  // Last known dims — included in the URL so a newly spawned shell PTY has the right size
  const lastDimsRef = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  onDataRef.current = onData;

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const { cols, rows } = lastDimsRef.current;
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/ws/shell?cols=${cols}&rows=${rows}`
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      delayRef.current = RECONNECT_DELAY_MS;
      // Flush any resize queued before the socket was ready
      if (pendingResizeRef.current) {
        const { cols, rows } = pendingResizeRef.current;
        pendingResizeRef.current = null;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    ws.onmessage = (e) => {
      const data =
        e.data instanceof ArrayBuffer
          ? new Uint8Array(e.data)
          : new TextEncoder().encode(String(e.data));
      onDataRef.current(data);
    };

    const scheduleReconnect = () => {
      // Only reconnect for the socket we currently own
      if (unmountedRef.current || wsRef.current !== ws) return;
      timerRef.current = setTimeout(() => { connect(); }, delayRef.current);
      delayRef.current = Math.min(delayRef.current * 2, MAX_RECONNECT_DELAY_MS);
    };

    ws.onclose = scheduleReconnect;
    ws.onerror = () => { /* onclose fires after onerror */ };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((data: string | ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(data);
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    lastDimsRef.current = { cols, rows };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    } else {
      // Queue for when the socket opens or reconnects
      pendingResizeRef.current = { cols, rows };
    }
  }, []);

  return { send, sendResize };
}
