import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { GitHistoryEntry, GitStatus, Repo, Session } from '../../api/client';

interface Props {
    repo: Repo;
    session: Session | null;
    onClose: () => void;
}

function formatCommitTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

function getHeadBadge(status: GitStatus | null): string {
    if (!status) return 'Unknown HEAD';
    if (status.is_detached) {
        return status.head_ref ? `HEAD • ${status.head_ref}` : 'HEAD';
    }
    return status.branch ?? status.head_ref ?? 'HEAD';
}

export default function GitHistoryModal({ repo, session, onClose }: Props) {
    const [history, setHistory] = useState<GitHistoryEntry[]>([]);
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const sessionId = session?.id;
    const scopeLabel = session ? `Session worktree • ${session.name}` : `Repo root • ${repo.name}`;

    const loadHistory = async () => {
        setLoading(true);
        setError('');
        try {
            const [nextStatus, nextHistory] = await Promise.all([
                api.repos.git.status(repo.id, sessionId),
                api.repos.git.history(repo.id, { sessionId, limit: 50 }),
            ]);
            setStatus(nextStatus);
            setHistory(nextHistory);
        } catch (loadError: unknown) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load git history');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadHistory();
    }, [repo.id, sessionId]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[88vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <circle cx="6.5" cy="6.5" r="2.25" />
                                <circle cx="6.5" cy="17.5" r="2.25" />
                                <circle cx="17.5" cy="12" r="2.25" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 6.5h4a3 3 0 013 3v0M8.5 17.5h4a3 3 0 003-3v0" />
                            </svg>
                            <span className="text-sm font-semibold text-gray-200">Git History</span>
                            <span className="inline-flex items-center rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-200">
                                {getHeadBadge(status)}
                            </span>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">{scopeLabel}</p>
                        <p className="mt-1 text-[11px] text-gray-600 break-all">{status?.worktree_path ?? session?.worktree_path ?? repo.path}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { void loadHistory(); }}
                            className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:text-white hover:border-gray-600 font-medium transition-all"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={onClose}
                            className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 font-medium transition-all"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="p-4 space-y-4 overflow-y-auto">
                    {error && (
                        <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-4 text-xs text-gray-500">
                            Loading git history…
                        </div>
                    ) : history.length === 0 ? (
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-4 text-xs text-gray-500">
                            No commits are available for this target yet.
                        </div>
                    ) : (
                        <ul className="space-y-3">
                            {history.map((entry) => (
                                <li key={entry.hash} className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-gray-100 break-words">{entry.subject}</div>
                                            <div className="mt-1 text-[11px] text-gray-500">
                                                <span className="font-semibold text-gray-300">{entry.short_hash}</span>
                                                <span className="mx-1.5 text-gray-700">•</span>
                                                <span>{entry.author_name}</span>
                                                <span className="mx-1.5 text-gray-700">•</span>
                                                <span>{formatCommitTime(entry.authored_at)}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-1 md:justify-end">
                                            {entry.refs.length > 0 ? entry.refs.map((ref) => (
                                                <span
                                                    key={`${entry.hash}-${ref}`}
                                                    className="inline-flex items-center rounded-full border border-gray-700 bg-gray-900/80 px-2 py-0.5 text-[10px] font-medium text-gray-300"
                                                >
                                                    {ref}
                                                </span>
                                            )) : (
                                                <span className="inline-flex items-center rounded-full border border-gray-800 bg-gray-900/60 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                                    Commit
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}