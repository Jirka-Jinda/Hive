import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { Session } from '../../api/client';
import AgentPicker from './AgentPicker';
import MdFilePicker from './MdFilePicker';

export default function SessionList() {
    const {
        selectedRepo,
        sessions,
        setSessions,
        selectedSession,
        setSelectedSession,
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
    const [sessionRefs, setSessionRefs] = useState<import('../../api/client').MdFile[]>([]);
    const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<number | null>(null);
    const [deletingSession, setDeletingSession] = useState(false);

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

    return (
        <div className="p-2 border-t border-gray-700 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Sessions
                </span>
                <button
                    onClick={() => { setShowNew(!showNew); setErrorMsg(''); }}
                    className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium ${showNew
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-indigo-400 hover:bg-gray-750 hover:text-indigo-300 hover:border-gray-600'
                        }`}
                >
                    {showNew ? '✕' : '+ Add'}
                </button>
            </div>

            {showNew && (
                <div className="mb-2 p-2.5 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-2">
                    <input
                        className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
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
                        files={mdFiles}
                        selected={selectedRefs}
                        onChange={setSelectedRefs}
                        label="Context files (optional)"
                    />
                    {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
                    <button
                        onClick={createSession}
                        disabled={creating}
                        className="w-full text-xs bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
                    const dotClass =
                        session.state === 'idle'
                            ? 'bg-green-400'
                            : session.state === 'working'
                                ? 'bg-amber-400 animate-pulse'
                                : 'bg-gray-500';
                    return (
                        <li
                            key={session.id}
                            onClick={() => setSelectedSession(session)}
                            className={`group rounded cursor-pointer text-sm ${isActive
                                ? 'bg-indigo-700 text-white'
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
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span
                                                className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`}
                                            />
                                            <span className="truncate">{session.name}</span>
                                            <span className="text-xs text-gray-500 shrink-0">{session.agent_type}</span>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteSessionId(session.id); }}
                                            className="inline-flex items-center justify-center w-5 h-5 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/40 ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-all text-sm"
                                            title="Delete session"
                                        >
                                            ×
                                        </button>
                                    </>
                                )}
                            </div>
                            {isActive && sessionRefs.length > 0 && (
                                <div className="px-2 pb-1.5 flex flex-wrap gap-1">
                                    {sessionRefs.map((f) => (
                                        <span
                                            key={f.id}
                                            className="inline-flex items-center gap-0.5 text-[10px] bg-indigo-900/60 text-indigo-200/80 px-1.5 py-0.5 rounded font-medium"
                                            title={f.path}
                                        >
                                            {f.path.split(/[/\\]/).pop()}
                                        </span>
                                    ))}
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
