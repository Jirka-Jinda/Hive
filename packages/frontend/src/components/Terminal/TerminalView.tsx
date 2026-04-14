import { useEffect, useRef } from 'react';
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

    const { send, sendResize } = useWebSocket(sessionId, (data) => {
        termRef.current?.write(data);
    });

    useEffect(() => {
        if (!containerRef.current) return;

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

        // Small delay to allow layout to settle before fitting
        setTimeout(() => fitAddon.fit(), 50);

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        // Forward user keystrokes to the PTY
        term.onData((data) => send(data));

        // Resize PTY when the terminal element changes size
        const observer = new ResizeObserver(() => {
            fitAddon.fit();
            sendResize(term.cols, term.rows);
        });
        observer.observe(containerRef.current);

        return () => {
            observer.disconnect();
            term.dispose();
            termRef.current = null;
            fitAddonRef.current = null;
        };
        // Re-initialize terminal when session changes
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
