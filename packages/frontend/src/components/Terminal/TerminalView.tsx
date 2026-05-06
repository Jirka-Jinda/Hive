import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWebSocket } from '../../hooks/useWebSocket';
import '@xterm/xterm/css/xterm.css';

interface Props {
    sessionId: number;
}

export default function TerminalView({ sessionId }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    // Measured terminal dimensions — WS connection is deferred until these are
    // known so the PTY is spawned with the exact right size from the start.
    const [initialDims, setInitialDims] = useState<{ cols: number; rows: number } | null>(null);

    const { send, sendResize } = useWebSocket(
        sessionId,
        initialDims,
        (data) => { termRef.current?.write(data); },
        (_code, reason) => {
            termRef.current?.write(`\r\n\x1b[31m\x1b[1m[Error]\x1b[0m\x1b[31m ${reason}\x1b[0m\r\n`);
        },
    );

    useEffect(() => {
        // Reset dims so any previous session's connection is not reused
        setInitialDims(null);

        if (!containerRef.current) return;

        let initialFitTimer: number | null = null;

        const term = new Terminal({
            allowProposedApi: true,
            theme: {
                background: '#030712',
                foreground: '#f3f4f6',
                cursor: '#818cf8',
                selectionBackground: '#374151',
            },
            fontSize: 14,
            fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
            cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);

        // Measure after the browser has laid out the container, then unblock
        // the WS connection with the real dimensions and focus xterm so its
        // hidden textarea tracks the live cursor after returning to a session.
        initialFitTimer = window.setTimeout(() => {
            fitAddon.fit();
            setInitialDims({ cols: term.cols, rows: term.rows });
            sendResize(term.cols, term.rows);
            term.focus();
        }, 50);

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        // Forward user keystrokes to the PTY
        term.onData((data) => send(data));

        // Keep PTY in sync whenever the container is resized
        const observer = new ResizeObserver(() => {
            fitAddon.fit();
            sendResize(term.cols, term.rows);
        });
        observer.observe(containerRef.current);

        return () => {
            if (initialFitTimer !== null) window.clearTimeout(initialFitTimer);
            observer.disconnect();
            term.dispose();
            termRef.current = null;
            fitAddonRef.current = null;
        };
        // send/sendResize are stable useCallback refs — won't re-trigger
    }, [sessionId, send, sendResize]);

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
            <div
                ref={containerRef}
                className="flex-1 p-1"
                style={{ minHeight: 0 }}
            />
        </div>
    );
}
