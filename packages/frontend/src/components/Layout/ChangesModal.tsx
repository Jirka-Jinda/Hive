import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ChangeEvent } from '../../api/client';
import XCloseButton from '../ui/XCloseButton';

interface Props {
    onClose: () => void;
    onOpenChange: (event: ChangeEvent) => void | Promise<void>;
}

function getEventBadge(event: ChangeEvent): { label: string; className: string } {
    switch (event.event_type) {
        case 'automation-failed':
            return { label: 'Automation', className: 'bg-red-950/50 text-red-300' };
        case 'automation-ran':
            return { label: 'Automation', className: 'bg-emerald-950/50 text-emerald-300' };
        case 'mdfile-moved':
            return { label: 'Moved', className: 'bg-amber-950/50 text-amber-300' };
        case 'mdfile-deleted':
            return { label: 'Deleted', className: 'bg-red-950/50 text-red-300' };
        default:
            return { label: 'Markdown', className: 'bg-sky-950/50 text-sky-300' };
    }
}

export default function ChangesModal({ onClose, onOpenChange }: Props) {
    const [changes, setChanges] = useState<ChangeEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');
    const [openingId, setOpeningId] = useState<number | null>(null);

    const loadChanges = async () => {
        setLoading(true);
        setError('');
        setActionError('');
        try {
            const nextChanges = await api.changes.list({ limit: 40 });
            setChanges(nextChanges);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load recent changes');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadChanges();
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-[880px] max-h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
                    <div>
                        <h2 className="text-sm font-semibold text-gray-200">Recent Changes</h2>
                        <p className="mt-1 text-[11px] text-gray-500">A summary view of markdown and automation activity. Open any item to jump back into its dedicated screen.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { void loadChanges(); }}
                            className="text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:text-white hover:border-gray-600 transition-all"
                        >
                            Refresh
                        </button>
                        <XCloseButton onClick={onClose} />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0 p-3">
                    {actionError && (
                        <div className="mb-3 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
                            {actionError}
                        </div>
                    )}
                    {loading ? (
                        <p className="text-sm text-gray-500 text-center py-8">Loading recent changes…</p>
                    ) : error ? (
                        <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">
                            {error}
                        </div>
                    ) : changes.length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-8">No recent changes yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {changes.map((event) => {
                                const badge = getEventBadge(event);
                                return (
                                    <div key={event.id} className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                                                        {badge.label}
                                                    </span>
                                                    {event.scope && (
                                                        <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2 py-0.5 text-[10px] text-gray-400">
                                                            {event.scope}
                                                        </span>
                                                    )}
                                                    <span className="text-[11px] text-gray-500">{new Date(event.created_at).toLocaleString()}</span>
                                                </div>
                                                <h3 className="mt-2 text-sm font-medium text-gray-100 break-words">{event.title}</h3>
                                                {event.summary && <p className="mt-1 text-xs text-gray-400 break-words">{event.summary}</p>}
                                                {(event.path || event.repo_id || event.session_id) && (
                                                    <p className="mt-1 text-[11px] text-gray-500 break-words">
                                                        {event.path ?? ''}
                                                        {event.repo_id ? ` · repo ${event.repo_id}` : ''}
                                                        {event.session_id ? ` · session ${event.session_id}` : ''}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    setActionError('');
                                                    setOpeningId(event.id);
                                                    try {
                                                        await onOpenChange(event);
                                                    } catch (openError) {
                                                        setActionError(openError instanceof Error ? openError.message : 'Unable to open this change.');
                                                    } finally {
                                                        setOpeningId(null);
                                                    }
                                                }}
                                                className="shrink-0 text-xs px-2.5 py-1 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:text-white hover:border-gray-600 transition-all"
                                            >
                                                {openingId === event.id ? 'Opening…' : 'Open'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
