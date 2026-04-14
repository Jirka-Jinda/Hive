import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { useShellWebSocket } from '../../hooks/useShellWebSocket';
import '@xterm/xterm/css/xterm.css';

interface Props {
    /** When true the container is hidden (display:none) but the PTY stays alive. */
    hidden: boolean;
}

export default function ShellTerminal({ hidden }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    const { send, sendResize } = useShellWebSocket((data) => {
        termRef.current?.write(data);
    });

    // Initialise xterm once on mount
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
            fontFamily: '"MesloLGS NF", "MesloLGS Nerd Font", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
            cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        const unicode11Addon = new Unicode11Addon();
        term.loadAddon(fitAddon);
        term.loadAddon(unicode11Addon);
        term.unicode.activeVersion = '11';
        term.open(containerRef.current);
        setTimeout(() => {
            fitAddon.fit();
            term.focus();
        }, 50);

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        term.onData((data) => send(data));

        const observer = new ResizeObserver(() => {
            if (!hidden) {
                fitAddon.fit();
                sendResize(term.cols, term.rows);
            }
        });
        observer.observe(containerRef.current);

        return () => {
            observer.disconnect();
            term.dispose();
            termRef.current = null;
            fitAddonRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-fit and focus whenever the terminal becomes visible
    useEffect(() => {
        if (!hidden && fitAddonRef.current && termRef.current) {
            setTimeout(() => {
                fitAddonRef.current?.fit();
                if (termRef.current) {
                    sendResize(termRef.current.cols, termRef.current.rows);
                    termRef.current.focus();
                }
            }, 30);
        }
    }, [hidden, sendResize]);

    return (
        <div
            className="flex-1 flex flex-col overflow-hidden bg-gray-950"
            style={{ display: hidden ? 'none' : 'flex' }}
        >
            <div
                ref={containerRef}
                className="flex-1 p-1"
                style={{ minHeight: 0 }}
            />
        </div>
    );
}
