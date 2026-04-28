import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AppErrorLog, UserActionLog } from '../../api/client';

interface Props {
    onClose: () => void;
}

type Tab = 'actions' | 'errors';

const ACTION_LABELS: Record<string, string> = {
    add_repo: 'Add repo',
    delete_repo: 'Delete repo',
    create_session: 'Create session',
    delete_session: 'Delete session',
    create_md_file: 'Create MD file',
    delete_md_file: 'Delete MD file',
};

function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
    }).format(date);
}

export default function LogsModal({ onClose }: Props) {
    const [tab, setTab] = useState<Tab>('actions');
    const [actions, setActions] = useState<UserActionLog[]>([]);
    const [errors, setErrors] = useState<AppErrorLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [expandedStack, setExpandedStack] = useState<number | null>(null);

    const loadLogs = async () => {
        setLoading(true);
        setLoadError('');
        try {
            const [nextActions, nextErrors] = await Promise.all([
                api.logs.actions(),
                api.logs.errors(),
            ]);
            setActions(nextActions);
            setErrors(nextErrors);
        } catch (err: unknown) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load logs');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadLogs();
    }, []);

    const tabCls = (t: Tab) =>
        `px-4 py-2 text-sm font-medium transition-colors border-b-2 ${tab === t
            ? 'border-orange-500 text-orange-400'
            : 'border-transparent text-gray-400 hover:text-gray-200'
        }`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[88vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <span className="text-sm font-semibold text-gray-200">Application Logs</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { void loadLogs(); }}
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

                {/* Tabs */}
                <div className="flex border-b border-gray-800 px-4">
                    <button className={tabCls('actions')} onClick={() => setTab('actions')}>
                        User Actions
                        {actions.length > 0 && (
                            <span className="ml-2 text-[10px] bg-gray-700 text-gray-300 rounded-full px-1.5 py-0.5">
                                {actions.length}
                            </span>
                        )}
                    </button>
                    <button className={tabCls('errors')} onClick={() => setTab('errors')}>
                        App Errors
                        {errors.length > 0 && (
                            <span className="ml-2 text-[10px] bg-red-900/60 text-red-300 rounded-full px-1.5 py-0.5">
                                {errors.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loadError && (
                        <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300 mb-4">
                            {loadError}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading…</div>
                    ) : tab === 'actions' ? (
                        actions.length === 0 ? (
                            <div className="flex items-center justify-center py-12 text-gray-600 text-sm">No user actions recorded yet.</div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-800">
                                        <th className="pb-2 pr-4 w-44">Time</th>
                                        <th className="pb-2 pr-4 w-36">Action</th>
                                        <th className="pb-2">Detail</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800/60">
                                    {actions.map((row) => (
                                        <tr key={row.id} className="hover:bg-gray-800/30">
                                            <td className="py-2 pr-4 text-gray-500 whitespace-nowrap tabular-nums">
                                                {formatTime(row.created_at)}
                                            </td>
                                            <td className="py-2 pr-4">
                                                <span className="inline-flex items-center rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-300 whitespace-nowrap">
                                                    {ACTION_LABELS[row.action] ?? row.action}
                                                </span>
                                            </td>
                                            <td className="py-2 text-gray-300 break-all">
                                                {row.detail ?? <span className="text-gray-600">—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )
                    ) : errors.length === 0 ? (
                        <div className="flex items-center justify-center py-12 text-gray-600 text-sm">No errors recorded.</div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-800">
                                    <th className="pb-2 pr-4 w-44">Time</th>
                                    <th className="pb-2">Message</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800/60">
                                {errors.map((row) => (
                                    <tr key={row.id} className="hover:bg-gray-800/30">
                                        <td className="py-2 pr-4 text-gray-500 whitespace-nowrap tabular-nums align-top">
                                            {formatTime(row.created_at)}
                                        </td>
                                        <td className="py-2 align-top">
                                            <div className="text-red-300 break-all">{row.message}</div>
                                            {row.stack && (
                                                <div className="mt-1">
                                                    <button
                                                        onClick={() => setExpandedStack(expandedStack === row.id ? null : row.id)}
                                                        className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                                                    >
                                                        {expandedStack === row.id ? '▲ Hide stack' : '▼ Show stack'}
                                                    </button>
                                                    {expandedStack === row.id && (
                                                        <pre className="mt-1 text-[10px] text-gray-500 whitespace-pre-wrap break-all font-mono bg-gray-950/60 rounded p-2 border border-gray-800">
                                                            {row.stack}
                                                        </pre>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
