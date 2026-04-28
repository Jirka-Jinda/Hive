import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useAppStore } from '../../store/appStore';
import type { AutomationTask, MdFile, Repo, Session } from '../../api/client';
import { useModal } from '../../hooks/useModal';
import XCloseButton from '../ui/XCloseButton';

interface Props {
    onClose: () => void;
}

const CRON_PRESETS = [
    { label: 'Every 5 min', value: '*/5 * * * *' },
    { label: 'Every 15 min', value: '*/15 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Daily at 9am', value: '0 9 * * *' },
    { label: 'Weekdays at 9am', value: '0 9 * * 1-5' },
];

interface RepoSession {
    repo: Repo;
    session: Session;
}

export default function AutomationModal({ onClose }: Props) {
    const { mdFiles, repos } = useAppStore();
    const promptTemplates = mdFiles.filter((f) => f.type === 'prompt' && f.scope === 'central');

    // All sessions across repos
    const [allSessions, setAllSessions] = useState<RepoSession[]>([]);
    const [tasks, setTasks] = useState<AutomationTask[]>([]);
    const [loading, setLoading] = useState(true);

    // Create form
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [newMdFileId, setNewMdFileId] = useState<number | ''>('');
    const [newSessionId, setNewSessionId] = useState<number | ''>('');
    const [newCron, setNewCron] = useState('*/15 * * * *');
    const [newTextParams, setNewTextParams] = useState<Record<string, string>>({});
    const [templateParams, setTemplateParams] = useState<{ name: string; default?: string; description?: string }[]>([]);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    // Delete confirm
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { overlayRef, handleOverlayClick } = useModal(onClose);

    const fetchTasks = () =>
        api.automation.list().then(setTasks).catch(() => { });

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const [taskList, repoList] = await Promise.all([
                    api.automation.list(),
                    api.repos.list(),
                ]);
                setTasks(taskList);

                const repoSessions: RepoSession[] = [];
                await Promise.all(repoList.map(async (repo) => {
                    const sessions = await api.repos.sessions.list(repo.id).catch(() => [] as Session[]);
                    sessions.forEach((s) => repoSessions.push({ repo, session: s }));
                }));
                setAllSessions(repoSessions);
            } finally {
                setLoading(false);
            }
        };
        void init();

        pollRef.current = setInterval(() => { void fetchTasks(); }, 10_000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, []);

    // Load text params when template changes
    useEffect(() => {
        if (!newMdFileId) { setTemplateParams([]); setNewTextParams({}); return; }
        api.mdfiles.params(newMdFileId as number).then((data) => {
            const textOnly = (data.params ?? []).filter((p) => p.type === 'text');
            setTemplateParams(textOnly);
            const defaults: Record<string, string> = {};
            textOnly.forEach((p) => { defaults[p.name] = p.default ?? ''; });
            setNewTextParams(defaults);
        }).catch(() => { });
    }, [newMdFileId]);

    const handleCreate = async () => {
        if (!newName.trim() || !newMdFileId || !newSessionId || !newCron.trim()) {
            setCreateError('Name, template, session and cron are required.');
            return;
        }
        setCreating(true);
        setCreateError('');
        try {
            await api.automation.create({
                name: newName.trim(),
                md_file_id: newMdFileId as number,
                session_id: newSessionId as number,
                cron: newCron.trim(),
                params: newTextParams,
            });
            await fetchTasks();
            setShowCreate(false);
            setNewName('');
            setNewMdFileId('');
            setNewSessionId('');
            setNewCron('*/15 * * * *');
            setNewTextParams({});
        } catch (e: unknown) {
            setCreateError(e instanceof Error ? e.message : 'Failed to create task');
        } finally {
            setCreating(false);
        }
    };

    const handlePause = async (task: AutomationTask) => {
        try {
            const updated = await (task.enabled ? api.automation.pause(task.id) : api.automation.resume(task.id));
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        } catch { /* ignore */ }
    };

    const handleDelete = async (id: number) => {
        setDeletingId(id);
        try {
            await api.automation.delete(id);
            setTasks((prev) => prev.filter((t) => t.id !== id));
            setConfirmDeleteId(null);
        } catch { /* ignore */ }
        finally { setDeletingId(null); }
    };

    const getMdFileName = (id: number) =>
        promptTemplates.find((f: MdFile) => f.id === id)?.path.split(/[/\\]/).pop() ?? `#${id}`;

    const getSessionLabel = (id: number) => {
        const rs = allSessions.find((s) => s.session.id === id);
        return rs ? `${rs.repo.name} / ${rs.session.name}` : `Session #${id}`;
    };

    const fmtDate = (s: string | null) => {
        if (!s) return '—';
        return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    };

    return (
        <div ref={overlayRef} onClick={handleOverlayClick} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col rounded-xl border border-gray-700/60 bg-gray-900 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
                    <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                        <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Automation Tasks
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setShowCreate((v) => !v); setCreateError(''); }}
                            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border font-medium transition-all ${showCreate
                                ? 'bg-amber-600 border-amber-500 text-white'
                                : 'bg-gray-800 border-gray-700 text-amber-400 hover:bg-amber-600/10 hover:border-amber-500/60'
                                }`}
                        >
                            {showCreate ? '✕ Cancel' : '+ New Task'}
                        </button>
                        <XCloseButton onClick={onClose} />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                    {/* Create form */}
                    {showCreate && (
                        <div className="m-3 p-3 bg-gray-800/70 border border-gray-700/80 rounded-lg space-y-3">
                            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">New Automated Task</p>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Task name</label>
                                    <input
                                        className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
                                        placeholder="e.g. Daily code review"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Template</label>
                                    <select
                                        className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded text-gray-100 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
                                        value={newMdFileId}
                                        onChange={(e) => setNewMdFileId(e.target.value ? parseInt(e.target.value, 10) : '')}
                                    >
                                        <option value="">— select template —</option>
                                        {promptTemplates.map((f: MdFile) => (
                                            <option key={f.id} value={f.id}>{f.path.split(/[/\\]/).pop()}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Target session</label>
                                    <select
                                        className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded text-gray-100 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
                                        value={newSessionId}
                                        onChange={(e) => setNewSessionId(e.target.value ? parseInt(e.target.value, 10) : '')}
                                    >
                                        <option value="">— select session —</option>
                                        {allSessions.map(({ repo, session }) => (
                                            <option key={session.id} value={session.id}>{repo.name} / {session.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Schedule (cron)</label>
                                    <select
                                        className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded text-gray-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
                                        value=""
                                        onChange={(e) => { if (e.target.value) setNewCron(e.target.value); }}
                                    >
                                        <option value="">— preset —</option>
                                        {CRON_PRESETS.map((p) => (
                                            <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
                                        ))}
                                    </select>
                                    <input
                                        className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
                                        placeholder="*/15 * * * *"
                                        value={newCron}
                                        onChange={(e) => setNewCron(e.target.value)}
                                    />
                                    <p className="text-[10px] text-gray-600">min hr dom mon dow — <span className="text-gray-500">repo &amp; session filled automatically</span></p>
                                </div>
                            </div>

                            {/* Text params */}
                            {templateParams.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Template parameters</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {templateParams.map((p) => (
                                            <div key={p.name} className="space-y-0.5">
                                                <label className="text-[10px] text-gray-500">
                                                    {p.name}{p.description && <span className="ml-1 text-gray-600">— {p.description}</span>}
                                                </label>
                                                <input
                                                    className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
                                                    placeholder={p.default ?? ''}
                                                    value={newTextParams[p.name] ?? ''}
                                                    onChange={(e) => setNewTextParams((v) => ({ ...v, [p.name]: e.target.value }))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {createError && <p className="text-xs text-red-400">{createError}</p>}

                            <button
                                onClick={() => void handleCreate()}
                                disabled={creating}
                                className="w-full text-xs bg-amber-600 hover:bg-amber-500 border border-amber-500 text-white py-1.5 rounded font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {creating ? 'Creating…' : 'Create Task'}
                            </button>
                        </div>
                    )}

                    {/* Task list */}
                    <div className="p-3">
                        {loading ? (
                            <p className="text-xs text-gray-500 text-center py-6">Loading…</p>
                        ) : tasks.length === 0 ? (
                            <div className="text-center py-8 space-y-1">
                                <p className="text-xs text-gray-500">No automation tasks yet.</p>
                                <p className="text-[11px] text-gray-600">Click "+ New Task" to schedule a prompt template.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {tasks.map((task) => {
                                    const isPendingDelete = confirmDeleteId === task.id;
                                    const isEnabled = task.enabled === 1;
                                    return (
                                        <div
                                            key={task.id}
                                            className={`rounded-lg border p-3 transition-all ${isEnabled
                                                ? 'border-gray-700/80 bg-gray-800/60'
                                                : 'border-gray-800 bg-gray-850/40 opacity-60'
                                                }`}
                                        >
                                            {isPendingDelete ? (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-gray-300">Delete "{task.name}"?</span>
                                                    <div className="flex gap-1.5">
                                                        <button
                                                            onClick={() => void handleDelete(task.id)}
                                                            disabled={deletingId === task.id}
                                                            className="text-xs px-2.5 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white font-medium transition-all disabled:opacity-40"
                                                        >
                                                            {deletingId === task.id ? '…' : 'Yes, delete'}
                                                        </button>
                                                        <button
                                                            onClick={() => setConfirmDeleteId(null)}
                                                            className="text-xs px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-all"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 mb-0.5">
                                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isEnabled ? 'bg-amber-400' : 'bg-gray-600'}`} />
                                                                <span className="text-xs font-medium text-gray-200 truncate">{task.name}</span>
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isEnabled ? 'bg-amber-900/50 text-amber-300' : 'bg-gray-700 text-gray-500'
                                                                    }`}>
                                                                    {isEnabled ? 'active' : 'paused'}
                                                                </span>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1.5">
                                                                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                                                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                                    </svg>
                                                                    {getMdFileName(task.md_file_id)}
                                                                </span>
                                                                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                                                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                                    </svg>
                                                                    {getSessionLabel(task.session_id)}
                                                                </span>
                                                                <span className="text-[11px] font-mono text-amber-400/80">
                                                                    {task.cron}
                                                                </span>
                                                                <span className="text-[11px] text-gray-600">
                                                                    last: {fmtDate(task.last_run_at)}
                                                                </span>
                                                                <span className="text-[11px] text-gray-600 col-span-2">
                                                                    next: {fmtDate(task.next_run_at)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-1 shrink-0">
                                                            <button
                                                                onClick={() => void handlePause(task)}
                                                                title={isEnabled ? 'Pause' : 'Resume'}
                                                                className="flex items-center justify-center w-7 h-7 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-all"
                                                            >
                                                                {isEnabled ? (
                                                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                                                        <path d="M6 19h4V5H6zm8-14v14h4V5z" />
                                                                    </svg>
                                                                ) : (
                                                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                                                        <path d="M8 5v14l11-7z" />
                                                                    </svg>
                                                                )}
                                                            </button>
                                                            <button
                                                                onClick={() => setConfirmDeleteId(task.id)}
                                                                title="Delete"
                                                                className="flex items-center justify-center w-7 h-7 rounded border border-gray-700 bg-gray-800 text-gray-500 hover:text-red-400 hover:border-red-500/50 transition-all"
                                                            >
                                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-between items-center px-4 py-3 border-t border-gray-800 shrink-0">
                    <p className="text-[11px] text-gray-600">{tasks.length} task{tasks.length !== 1 ? 's' : ''} · polls every 10s</p>
                </div>
            </div>
        </div>
    );
}
