import { useEffect, useRef, useCallback } from 'react';

export function useWebSocket(
  sessionId: number | null,
  onData: (data: Uint8Array) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  // Keep callback stable via ref to avoid reconnecting on every render
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/ws/terminal?sessionId=${sessionId}`
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const data =
        e.data instanceof ArrayBuffer
          ? new Uint8Array(e.data)
          : new TextEncoder().encode(String(e.data));
      onDataRef.current(data);
    };

    ws.onerror = (e) => console.error('[WS] error', e);

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const send = useCallback((data: string | ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  return { send, sendResize };
}
