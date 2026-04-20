import { useEffect, useRef, useCallback } from 'react';

export function useWebSocket(
  sessionId: number | null,
  /** Measured terminal dimensions. Connection is deferred until this is non-null
   *  so the PTY is always spawned with the correct size. */
  initialDims: { cols: number; rows: number } | null,
  onData: (data: Uint8Array) => void,
  onClose?: (code: number, reason: string) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  // Keep callbacks stable via refs to avoid reconnecting on every render
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Resize queued while the socket is still connecting
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const cols = initialDims?.cols ?? null;
  const rows = initialDims?.rows ?? null;

  useEffect(() => {
    if (!sessionId || cols === null || rows === null) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/ws/terminal?sessionId=${sessionId}&cols=${cols}&rows=${rows}`
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      // Flush any resize that arrived before the socket was ready
      if (pendingResizeRef.current) {
        const { cols: c, rows: r } = pendingResizeRef.current;
        pendingResizeRef.current = null;
        ws.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
      }
    };

    ws.onmessage = (e) => {
      const data =
        e.data instanceof ArrayBuffer
          ? new Uint8Array(e.data)
          : new TextEncoder().encode(String(e.data));
      onDataRef.current(data);
    };

    ws.onerror = () => ws.close();

    ws.onclose = (e) => {
      wsRef.current = null;
      if (e.code !== 1000) {
        const reason = e.reason || `Connection closed (code ${e.code})`;
        onCloseRef.current?.(e.code, reason);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, cols, rows]);

  const send = useCallback((data: string | ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const sendResize = useCallback((c: number, r: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
    } else {
      // Queue for when the socket opens (handles ResizeObserver firing before onopen)
      pendingResizeRef.current = { cols: c, rows: r };
    }
  }, []);

  return { send, sendResize };
}
