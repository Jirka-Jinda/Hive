import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { MdFile, Session } from '../../api/client';
import AgentPicker from './AgentPicker';
import MdFilePicker from './MdFilePicker';

function EditIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49a2.1 2.1 0 112.97 2.97L9 18.3l-4 1 1-4L16.86 4.49z" />
        </svg>
    );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
    return (
        <svg className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 10-2.34 5.66M20 12v-5m0 5h-5" />
        </svg>
    );
}

function ActionButton({
    title,
    onClick,
    children,
    tone = 'default',
    visible,
    disabled = false,
}: {
    title: string;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    children: React.ReactNode;
    tone?: 'default' | 'danger';
    visible: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-md ml-1 shrink-0 transition-all ${visible
                ? tone === 'danger'
                    ? 'opacity-100 bg-black/20 ring-1 ring-black/10 text-white/90 hover:bg-red-900/45 hover:text-white'
                    : 'opacity-100 bg-black/20 ring-1 ring-black/10 text-white/90 hover:bg-black/30 hover:text-white'
                : tone === 'danger'
                    ? 'opacity-0 text-gray-500 group-hover:opacity-100 hover:text-red-300 hover:bg-red-950/50'
                    : 'opacity-0 text-gray-500 group-hover:opacity-100 hover:text-orange-200 hover:bg-white/10'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={title}
        >
            {children}
        </button>
    );
}

export default function SessionList() {
    const {
        selectedRepo,
        sessions,
        setSessions,
        selectedSession,
        setSelectedSession,
        updateSession,
        bumpSessionTerminalVersion,
        mdFiles,
    } = useAppStore();

    const [showNew, setShowNew] = useState(false);
    const [name, setName] = useState('');
    const [agentType, setAgentType] = useState('');
    const [credId, setCredId] = useState<number | undefined>();
    const [selectedRefs, setSelectedRefs] = useState<number[]>([]);
    const [creating, setCreating] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    // Active session context display
    const [sessionRefs, setSessionRefs] = useState<MdFile[]>([]);
    const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<number | null>(null);
    const [deletingSession, setDeletingSession] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
    const [editingSessionName, setEditingSessionName] = useState('');
    const [editingSessionRefs, setEditingSessionRefs] = useState<number[]>([]);
    const [savingEdit, setSavingEdit] = useState(false);
    const [restartingSessionId, setRestartingSessionId] = useState<number | null>(null);

    useEffect(() => {
        if (!selectedSession || !selectedRepo) { setSessionRefs([]); return; }
        api.repos.sessions.mdRefs.get(selectedRepo.id, selectedSession.id)
            .then(setSessionRefs)
            .catch(() => setSessionRefs([]));
    }, [selectedSession?.id, selectedRepo?.id]);

    if (!selectedRepo) return null;

    const createSession = async () => {
        if (!name.trim() || !agentType) {
            setErrorMsg('Name and agent are required');
            return;
        }
        setCreating(true);
        setErrorMsg('');
        try {
            const session = await api.repos.sessions.create(selectedRepo.id, {
                name: name.trim(),
                agentType,
                credentialId: credId,
            });
            // Save MD refs BEFORE connecting the terminal (terminal reads refs on PTY spawn)
            if (selectedRefs.length > 0) {
                await api.repos.sessions.mdRefs.set(selectedRepo.id, session.id, selectedRefs);
            }
            setSessions([session, ...sessions]);
            setSelectedSession(session);
            setShowNew(false);
            setName('');
            setAgentType('');
            setCredId(undefined);
            setSelectedRefs([]);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to create session');
        } finally {
            setCreating(false);
        }
    };

    const deleteSession = async (id: number) => {
        setDeletingSession(true);
        setErrorMsg('');
        try {
            await api.repos.sessions.delete(selectedRepo.id, id);
            setSessions(sessions.filter((s) => s.id !== id));
            if (selectedSession?.id === id) setSelectedSession(null);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to delete session');
        } finally {
            setDeletingSession(false);
            setConfirmDeleteSessionId(null);
        }
    };

    const startEditingSession = async (session: Session) => {
        if (selectedSession?.id !== session.id) return;
        setErrorMsg('');
        try {
            const refs = await api.repos.sessions.mdRefs.get(selectedRepo.id, session.id);
            if (useAppStore.getState().selectedSession?.id !== session.id) return;
            setSessionRefs(refs);
            setEditingSessionRefs(refs.map((file) => file.id));
        } catch {
            setEditingSessionRefs(sessionRefs.map((file) => file.id));
        }
        setEditingSessionId(session.id);
        setEditingSessionName(session.name);
    };

    const cancelEditingSession = () => {
        setEditingSessionId(null);
        setEditingSessionName('');
        setEditingSessionRefs([]);
    };

    const saveSessionEdit = async () => {
        if (!selectedRepo || !selectedSession || editingSessionId !== selectedSession.id) return;
        const nextName = editingSessionName.trim();
        if (!nextName) {
            setErrorMsg('Session name is required');
            return;
        }

        setSavingEdit(true);
        setErrorMsg('');
        try {
            const updatedSession = await api.repos.sessions.update(selectedRepo.id, selectedSession.id, { name: nextName });
            await api.repos.sessions.mdRefs.set(selectedRepo.id, selectedSession.id, editingSessionRefs);
            const refs = await api.repos.sessions.mdRefs.get(selectedRepo.id, selectedSession.id);
            updateSession(updatedSession);
            setSessionRefs(refs);
            cancelEditingSession();
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to update session');
        } finally {
            setSavingEdit(false);
        }
    };

    const restartSession = async (session: Session) => {
        if (!selectedRepo) return;
        setRestartingSessionId(session.id);
        setErrorMsg('');
        try {
            const updatedSession = await api.repos.sessions.restart(selectedRepo.id, session.id);
            updateSession(updatedSession);
            if (selectedSession?.id === session.id) {
                bumpSessionTerminalVersion(session.id);
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to refresh session');
        } finally {
            setRestartingSessionId(null);
        }
    };

    return (
        <div className="p-2 border-t border-gray-700 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Sessions
                </span>
                <button
                    onClick={() => { setShowNew(!showNew); setErrorMsg(''); }}
                    className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium ${showNew
                        ? 'bg-orange-600 border-orange-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-orange-400 hover:bg-gray-750 hover:text-orange-300 hover:border-gray-600'
                        }`}
                >
                    {showNew ? '✕' : '+ Add'}
                </button>
            </div>

            {showNew && (
                <div className="mb-2 p-2.5 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-2">
                    <input
                        className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                        placeholder="Session name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && createSession()}
                        autoFocus
                    />
                    <AgentPicker
                        agentType={agentType}
                        credentialId={credId}
                        onAgentChange={setAgentType}
                        onCredentialChange={setCredId}
                    />
                    <MdFilePicker
                        files={mdFiles.filter((f) => f.type !== 'prompt')}
                        selected={selectedRefs}
                        onChange={setSelectedRefs}
                        label="Context files (optional)"
                    />
                    {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
                    <button
                        onClick={createSession}
                        disabled={creating}
                        className="w-full text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {creating ? 'Starting…' : 'Start Session'}
                    </button>
                </div>
            )}

            {!showNew && errorMsg && <p className="px-2 pb-2 text-xs text-red-400">{errorMsg}</p>}

            <ul className="space-y-0.5">
                {[...sessions].sort((a, b) => {
                    const order = { idle: 0, working: 1, stopped: 2 } as Record<string, number>;
                    return (order[a.state ?? 'stopped'] ?? 2) - (order[b.state ?? 'stopped'] ?? 2);
                }).map((session: Session) => {
                    const isActive = selectedSession?.id === session.id;
                    const isEditing = editingSessionId === session.id;
                    const dotClass =
                        session.state === 'idle'
                            ? 'bg-green-400 shadow-[0_0_0_1px_rgba(74,222,128,0.35)]'
                            : session.state === 'working'
                                ? 'bg-amber-400 animate-pulse shadow-[0_0_0_1px_rgba(251,191,36,0.35)]'
                                : 'bg-gray-500 shadow-[0_0_0_1px_rgba(156,163,175,0.35)]';
                    return (
                        <li
                            key={session.id}
                            onClick={() => setSelectedSession(session)}
                            className={`group rounded cursor-pointer text-sm ${isActive
                                ? 'bg-orange-700 text-white'
                                : 'text-gray-300 hover:bg-gray-800'
                                }`}
                        >
                            <div className="flex items-center justify-between px-2 py-1.5">
                                {confirmDeleteSessionId === session.id ? (
                                    <>
                                        <span className="text-xs text-gray-300 truncate">Delete {session.name}?</span>
                                        <div className="flex gap-1 shrink-0 ml-1">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); void deleteSession(session.id); }}
                                                disabled={deletingSession}
                                                className="text-[10px] px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white font-medium transition-all disabled:opacity-40"
                                            >
                                                {deletingSession ? '…' : 'Yes'}
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteSessionId(null); }}
                                                className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-all"
                                            >
                                                No
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {isActive ? (
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span
                                                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass} ring-2 ring-black/45 ring-offset-1 ring-offset-orange-700`}
                                                    />
                                                    <span className="truncate">{session.name}</span>
                                                </div>
                                                <div className="mt-1 flex items-center justify-between gap-2 min-w-0">
                                                    <span className="text-xs shrink-0 text-orange-200">{session.agent_type}</span>
                                                    <div className="flex items-center shrink-0">
                                                        <ActionButton
                                                            title="Restart session"
                                                            visible={isActive}
                                                            disabled={restartingSessionId === session.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void restartSession(session);
                                                            }}
                                                        >
                                                            <RefreshIcon spinning={restartingSessionId === session.id} />
                                                        </ActionButton>
                                                        <ActionButton
                                                            title="Update session"
                                                            visible={isActive}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (isEditing) {
                                                                    cancelEditingSession();
                                                                    return;
                                                                }
                                                                void startEditingSession(session);
                                                            }}
                                                        >
                                                            <EditIcon />
                                                        </ActionButton>
                                                        <ActionButton
                                                            title="Delete session"
                                                            visible={isActive}
                                                            tone="danger"
                                                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteSessionId(session.id); }}
                                                        >
                                                            <span className="text-sm leading-none">×</span>
                                                        </ActionButton>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span
                                                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`}
                                                    />
                                                    <span className="truncate">{session.name}</span>
                                                    <span className="text-xs shrink-0 text-gray-500">{session.agent_type}</span>
                                                </div>
                                                <div className="flex items-center shrink-0">
                                                    <ActionButton
                                                        title="Restart session"
                                                        visible={false}
                                                        disabled={restartingSessionId === session.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            void restartSession(session);
                                                        }}
                                                    >
                                                        <RefreshIcon spinning={restartingSessionId === session.id} />
                                                    </ActionButton>
                                                    <ActionButton
                                                        title="Update session"
                                                        visible={false}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (isEditing) {
                                                                cancelEditingSession();
                                                                return;
                                                            }
                                                            void startEditingSession(session);
                                                        }}
                                                    >
                                                        <EditIcon />
                                                    </ActionButton>
                                                    <ActionButton
                                                        title="Delete session"
                                                        visible={false}
                                                        tone="danger"
                                                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteSessionId(session.id); }}
                                                    >
                                                        <span className="text-sm leading-none">×</span>
                                                    </ActionButton>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                            {isActive && !isEditing && sessionRefs.length > 0 && (
                                <div className="px-2 pb-1.5 flex flex-wrap gap-1">
                                    {sessionRefs.map((f) => (
                                        <span
                                            key={f.id}
                                            className="inline-flex items-center gap-0.5 text-[10px] bg-orange-900/60 text-orange-200/80 px-1.5 py-0.5 rounded font-medium"
                                            title={f.path}
                                        >
                                            {f.path.split(/[/\\]/).pop()}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {isActive && isEditing && (
                                <div className="px-2 pb-2 space-y-2">
                                    <input
                                        className="w-full bg-gray-950/80 border border-orange-500/30 text-sm px-2.5 py-1.5 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-500/30 transition-all"
                                        value={editingSessionName}
                                        onChange={(e) => setEditingSessionName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && void saveSessionEdit()}
                                        placeholder="Session name"
                                    />
                                    <MdFilePicker
                                        files={mdFiles.filter((file) => file.type !== 'prompt')}
                                        selected={editingSessionRefs}
                                        onChange={setEditingSessionRefs}
                                        label="Context files"
                                    />
                                    <div className="flex gap-1.5">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); void saveSessionEdit(); }}
                                            disabled={savingEdit}
                                            className="flex-1 text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {savingEdit ? 'Saving…' : 'Save'}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); cancelEditingSession(); }}
                                            className="text-xs px-3 py-1.5 rounded-md border border-gray-700 bg-gray-800 text-gray-300 hover:text-white font-medium transition-all"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
                {sessions.length === 0 && (
                    <li className="text-xs text-gray-600 px-2 py-2 italic">
                        No sessions — click + New to start one
                    </li>
                )}
            </ul>
        </div>
    );
}
