import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useModal } from '../../hooks/useModal';
import XCloseButton from '../ui/XCloseButton';

interface ToolStatus {
    id: string;
    name: string;
    command: string;
    installed: boolean;
}

interface Props {
    onClose: () => void;
}

export default function InstallToolsModal({ onClose }: Props) {
    const [tools, setTools] = useState<ToolStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [done, setDone] = useState(false);
    const [log, setLog] = useState<{ text: string; type: 'log' | 'error' }[]>([]);
    const logRef = useRef<HTMLDivElement>(null);
    const { overlayRef, handleOverlayClick } = useModal(onClose);

    useEffect(() => {
        api.tools.status()
            .then((res) => setTools(res.tools))
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    // Auto-scroll log to bottom
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [log]);

    const handleInstall = () => {
        setInstalling(true);
        setDone(false);
        setLog([]);

        // SSE via fetch POST — EventSource only supports GET, so we use fetch + ReadableStream
        fetch('/api/tools/install', { method: 'POST' })
            .then(async (res) => {
                if (!res.body) throw new Error('No response body');
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done: streamDone, value } = await reader.read();
                    if (streamDone) break;

                    buffer += decoder.decode(value, { stream: true });
                    const parts = buffer.split('\n\n');
                    buffer = parts.pop() ?? '';

                    for (const part of parts) {
                        const eventLine = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
                        const dataLine = part.match(/^data:\s*(.+)$/m)?.[1]?.trim();
                        if (!dataLine) continue;

                        const type = eventLine === 'error' ? 'error' : 'log';

                        if (eventLine === 'done') {
                            setLog((l) => [...l, { text: dataLine, type: 'log' }]);
                            setDone(true);
                            // Re-fetch tool status to update badges
                            api.tools.status().then((r) => setTools(r.tools)).catch(() => { });
                        } else {
                            setLog((l) => [...l, { text: dataLine, type }]);
                        }
                    }
                }
            })
            .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : 'Connection failed';
                setLog((l) => [...l, { text: msg, type: 'error' }]);
                setDone(true);
            })
            .finally(() => setInstalling(false));
    };

    const missingCount = tools.filter((t) => !t.installed).length;

    return (
        <div ref={overlayRef} onClick={handleOverlayClick} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
                    <span className="text-sm font-semibold text-gray-200">CLI Agent Tools</span>
                    <XCloseButton onClick={onClose} />
                </div>

                {/* Tool status list */}
                <div className="px-4 pt-3 pb-2 shrink-0">
                    {loading ? (
                        <p className="text-xs text-gray-500">Checking installed tools…</p>
                    ) : (
                        <div className="space-y-1.5">
                            {tools.map((t) => (
                                <div key={t.id} className="flex items-center justify-between text-sm">
                                    <span className="text-gray-300">{t.name}</span>
                                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${t.installed ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
                                        {t.installed ? 'installed' : 'missing'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Log output */}
                {log.length > 0 && (
                    <div
                        ref={logRef}
                        className="mx-4 mb-2 bg-gray-950 border border-gray-800 rounded-md p-2.5 overflow-y-auto font-mono text-[11px] leading-relaxed flex-1 min-h-0"
                    >
                        {log.map((line, i) => (
                            <div key={i} className={line.type === 'error' ? 'text-red-400' : 'text-gray-300'}>
                                {line.text}
                            </div>
                        ))}
                    </div>
                )}

                {done && (
                    <p className="px-4 pb-2 text-xs text-orange-400 shrink-0">
                        Restart the app to detect newly installed tools.
                    </p>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-800 shrink-0">
                    <p className="text-[11px] text-gray-500">
                        {!loading && missingCount === 0
                            ? 'All tools installed.'
                            : !loading
                                ? `${missingCount} tool${missingCount !== 1 ? 's' : ''} missing`
                                : ''}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 font-medium transition-all"
                        >
                            Close
                        </button>
                        {missingCount > 0 && !done && (
                            <button
                                onClick={handleInstall}
                                disabled={installing}
                                className="text-xs px-4 py-1.5 rounded border border-orange-500 bg-orange-600/80 hover:bg-orange-500 text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {installing ? 'Installing…' : 'Install Missing Tools'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}