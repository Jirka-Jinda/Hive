import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { Repo, Session } from '../../api/client';
import XCloseButton from '../ui/XCloseButton';

interface Props {
    repo: Repo;
    session: Session;
    onClose: () => void;
}

export default function LogSearchModal({ repo, session, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<{ snippet: string; log_id: number }[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!query.trim()) {
            setResults([]);
            setSearched(false);
            setError('');
            return;
        }
        debounceRef.current = setTimeout(() => {
            setLoading(true);
            setError('');
            api.repos.sessions.logs.search(repo.id, session.id, query.trim())
                .then((rows) => {
                    setResults(rows);
                    setSearched(true);
                })
                .catch((e: unknown) => {
                    setError(e instanceof Error ? e.message : 'Search failed');
                })
                .finally(() => setLoading(false));
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, repo.id, session.id]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                            </svg>
                            <h2 className="text-sm font-semibold text-gray-200">Search Session Logs</h2>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">{session.name}</p>
                    </div>
                    <XCloseButton onClick={onClose} />
                </div>

                <div className="p-4 border-b border-gray-800">
                    <input
                        ref={inputRef}
                        className="w-full bg-gray-950 border border-gray-700 text-sm px-3 py-2 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                        placeholder="Search log output…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {loading && (
                        <p className="text-xs text-gray-500">Searching…</p>
                    )}
                    {error && (
                        <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>
                    )}
                    {!loading && searched && results.length === 0 && (
                        <p className="text-xs text-gray-500">No matches found for <span className="font-mono text-gray-400">{query}</span>.</p>
                    )}
                    {results.map((r) => (
                        <div
                            key={r.log_id}
                            className="rounded-md border border-gray-800 bg-gray-950/70 px-3 py-2 text-xs font-mono text-gray-300 whitespace-pre-wrap break-all"
                            dangerouslySetInnerHTML={{
                                __html: r.snippet
                                    .replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;')
                                    .replace(/&lt;mark&gt;/g, '<mark class="bg-orange-500/30 text-orange-200 rounded px-0.5">')
                                    .replace(/&lt;\/mark&gt;/g, '</mark>'),
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
