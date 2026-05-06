import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { GitBranchOption, MdFile, Session, SessionBranchMode } from '../../api/client';
import AgentPicker from './AgentPicker';
import MdFilePicker from './MdFilePicker';

function getSessionBranchLabel(session: Session): string | null {
    if (session.branch_mode === 'root') {
        const branch = session.is_detached ? session.head_ref : session.current_branch;
        return branch ? `Repo root: ${branch}` : 'Repo root';
    }

    if (session.is_detached) {
        return session.head_ref ?? 'HEAD';
    }

    return session.current_branch ?? session.initial_branch_name ?? null;
}

function getSessionStateMeta(state: Session['state']) {
    switch (state) {
        case 'idle':
            return {
                dotClass: 'bg-green-400 shadow-[0_0_0_1px_rgba(74,222,128,0.35)]',
            };
        case 'working':
            return {
                dotClass: 'bg-amber-400 animate-pulse shadow-[0_0_0_1px_rgba(251,191,36,0.35)]',
            };
        default:
            return {
                dotClass: 'bg-gray-500 shadow-[0_0_0_1px_rgba(156,163,175,0.35)]',
            };
    }
}

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

function DiffIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
    );
}

function ArchiveIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M7 10v7m5-7v7m5-7v7M6 7l1 12h10l1-12M9 4h6l1 3H8l1-3z" />
        </svg>
    );
}

function ActionButton({
    title,
    onClick,
    children,
    tone = 'default',
    disabled = false,
    active = false,
}: {
    title: string;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    children: React.ReactNode;
    tone?: 'default' | 'danger';
    disabled?: boolean;
    active?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={title}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-all ${active
                ? 'bg-orange-600/30 ring-1 ring-orange-500/40 text-orange-100 shadow-sm shadow-orange-950/40'
                : tone === 'danger'
                    ? 'bg-red-950/20 text-red-200 hover:bg-red-800/60 hover:text-white'
                    : 'bg-black/20 ring-1 ring-black/10 text-white/90 hover:bg-orange-600/35 hover:text-white hover:ring-orange-500/30'
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
        updateRepo,
        updateSession,
        bumpSessionTerminalVersion,
        mdFiles,
        activeDiffTarget,
        toggleDiffTarget,
    } = useAppStore();

    const [showNew, setShowNew] = useState(false);
    const [name, setName] = useState('');
    const [agentType, setAgentType] = useState('');
    const [credId, setCredId] = useState<number | undefined>();
    const [selectedRefs, setSelectedRefs] = useState<number[]>([]);
    const [creating, setCreating] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [sessionRefs, setSessionRefs] = useState<MdFile[]>([]);
    const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<number | null>(null);
    const [deletingSession, setDeletingSession] = useState(false);
    const [loadingDeleteDetailsId, setLoadingDeleteDetailsId] = useState<number | null>(null);
    const [dirtySessionCounts, setDirtySessionCounts] = useState<Record<number, number>>({});
    const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
    const [editingSessionName, setEditingSessionName] = useState('');
    const [editingSessionRefs, setEditingSessionRefs] = useState<number[]>([]);
    const [savingEdit, setSavingEdit] = useState(false);
    const [restartingSessionId, setRestartingSessionId] = useState<number | null>(null);
    const [archivingSessionId, setArchivingSessionId] = useState<number | null>(null);
    const [refreshingSessions, setRefreshingSessions] = useState(false);
    const [branchMode, setBranchMode] = useState<SessionBranchMode>('new');
    const [branchName, setBranchName] = useState('');
    const [branchSearch, setBranchSearch] = useState('');
    const [branchOptions, setBranchOptions] = useState<GitBranchOption[]>([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [fetchingRemotes, setFetchingRemotes] = useState(false);
    const [branchReloadKey, setBranchReloadKey] = useState(0);
    const [dragOverId, setDragOverId] = useState<number | null>(null);
    const dragSessionId = useRef<number | null>(null);

    useEffect(() => {
        if (!selectedSession || !selectedRepo) {
            setSessionRefs([]);
            return;
        }

        let cancelled = false;

        api.repos.sessions.mdRefs.get(selectedRepo.id, selectedSession.id)
            .then((refs) => {
                if (!cancelled) {
                    setSessionRefs(refs);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSessionRefs([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [selectedSession?.id, selectedRepo?.id]);

    // Trigger a remote fetch once when the user switches to "existing" mode
    useEffect(() => {
        if (!selectedRepo?.is_git_repo || !showNew || branchMode !== 'existing') return;
        setFetchingRemotes(true);
        api.repos.git.branches.fetchRemotes(selectedRepo.id)
            .catch(() => { /* best-effort */ })
            .finally(() => {
                setFetchingRemotes(false);
                setBranchReloadKey((value) => value + 1);
            });
    }, [branchMode, selectedRepo?.id, selectedRepo?.is_git_repo, showNew]);

    useEffect(() => {
        if (!selectedRepo?.is_git_repo || !showNew || branchMode !== 'existing') {
            setBranchOptions([]);
            setBranchesLoading(false);
            return;
        }

        let cancelled = false;
        setBranchesLoading(true);
        api.repos.git.branches.list(selectedRepo.id, branchSearch.trim() || undefined)
            .then((branches) => {
                if (!cancelled) setBranchOptions(branches);
            })
            .catch(() => {
                if (!cancelled) setBranchOptions([]);
            })
            .finally(() => {
                if (!cancelled) setBranchesLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [branchMode, branchReloadKey, branchSearch, selectedRepo?.id, selectedRepo?.is_git_repo, showNew]);

    if (!selectedRepo) return null;

    const resetCreateForm = () => {
        setName('');
        setAgentType('');
        setCredId(undefined);
        setSelectedRefs([]);
        setBranchMode('new');
        setBranchName('');
        setBranchSearch('');
        setBranchOptions([]);
        setFetchingRemotes(false);
        setBranchReloadKey(0);
    };

    const refreshSessions = async () => {
        if (!selectedRepo) return;
        setRefreshingSessions(true);
        setErrorMsg('');
        try {
            const nextSessions = await api.repos.sessions.list(selectedRepo.id, { includeArchived: true });
            setSessions(nextSessions);
            if (selectedSession) {
                setSelectedSession(nextSessions.find((session) => session.id === selectedSession.id) ?? null);
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to refresh sessions');
        } finally {
            setRefreshingSessions(false);
        }
    };

    const createSession = async () => {
        if (!name.trim() || !agentType) {
            setErrorMsg('Name and agent are required');
            return;
        }
        const trimmedBranchName = branchName.trim();
        if (selectedRepo.is_git_repo && branchMode !== 'root' && !trimmedBranchName) {
            setErrorMsg(branchMode === 'new' ? 'Branch name is required for git sessions' : 'Select an available branch');
            return;
        }
        setCreating(true);
        setErrorMsg('');
        try {
            const session = await api.repos.sessions.create(selectedRepo.id, {
                name: name.trim(),
                agentType,
                credentialId: credId,
                branchMode: selectedRepo.is_git_repo ? branchMode : undefined,
                branchName: selectedRepo.is_git_repo && branchMode !== 'root' ? trimmedBranchName : undefined,
            });
            // Save MD refs BEFORE connecting the terminal (terminal reads refs on PTY spawn)
            if (selectedRefs.length > 0) {
                await api.repos.sessions.mdRefs.set(selectedRepo.id, session.id, selectedRefs);
            }
            setSessions([session, ...sessions]);
            updateRepo({ ...selectedRepo, session_count: sessions.length + 1 });
            setSelectedSession(session);
            setShowNew(false);
            resetCreateForm();
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
            updateRepo({ ...selectedRepo, session_count: Math.max(0, sessions.length - 1) });
            if (selectedSession?.id === id) setSelectedSession(null);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to delete session');
        } finally {
            setDeletingSession(false);
            setConfirmDeleteSessionId(null);
        }
    };

    const startEditingSession = async (session: Session) => {
        setSelectedSession(session);
        setErrorMsg('');
        try {
            const refs = await api.repos.sessions.mdRefs.get(selectedRepo.id, session.id);
            if (useAppStore.getState().selectedSession?.id !== session.id) return;
            setSessionRefs(refs);
            setEditingSessionRefs(refs.map((file) => file.id));
        } catch {
            setEditingSessionRefs([]);
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

    const toggleSessionArchive = async (session: Session) => {
        if (!selectedRepo) return;

        setArchivingSessionId(session.id);
        setErrorMsg('');
        try {
            const updatedSession = session.archived_at
                ? await api.repos.sessions.unarchive(selectedRepo.id, session.id)
                : await api.repos.sessions.archive(selectedRepo.id, session.id);
            updateSession(updatedSession);
            if (selectedSession?.id === session.id) {
                setSelectedSession(updatedSession);
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to update session archive state');
        } finally {
            setArchivingSessionId(null);
        }
    };

    const prepareDeleteSession = async (session: Session) => {
        setConfirmDeleteSessionId(session.id);
        if (!selectedRepo.is_git_repo || !session.worktree_path) {
            return;
        }

        setLoadingDeleteDetailsId(session.id);
        try {
            const changedFiles = await api.repos.git.changedFiles(selectedRepo.id, session.id);
            setDirtySessionCounts((current) => ({ ...current, [session.id]: changedFiles.length }));
        } catch {
            setDirtySessionCounts((current) => ({ ...current, [session.id]: 0 }));
        } finally {
            setLoadingDeleteDetailsId((current) => (current === session.id ? null : current));
        }
    };

    const handleDragStart = (sessionId: number) => {
        dragSessionId.current = sessionId;
    };

    const handleDragOver = (e: React.DragEvent, sessionId: number) => {
        e.preventDefault();
        setDragOverId(sessionId);
    };

    const handleDrop = async (e: React.DragEvent, targetId: number) => {
        e.preventDefault();
        setDragOverId(null);
        const fromId = dragSessionId.current;
        dragSessionId.current = null;
        if (!fromId || fromId === targetId || !selectedRepo) return;

        const sorted = [...sessions].sort((a, b) => a.sort_order - b.sort_order);
        const fromIdx = sorted.findIndex((s) => s.id === fromId);
        const toIdx = sorted.findIndex((s) => s.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        const reordered = [...sorted];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        const orderedIds = reordered.map((s) => s.id);

        // Optimistic update
        setSessions(reordered.map((s, i) => ({ ...s, sort_order: i })));

        try {
            await api.repos.sessions.reorder(selectedRepo.id, orderedIds);
        } catch {
            // Revert on failure
            setSessions(sorted);
        }
    };

    const handleDragEnd = () => {
        dragSessionId.current = null;
        setDragOverId(null);
    };

    const orderedSessions = [...sessions].sort((a, b) => a.sort_order - b.sort_order);
    const activeSessions = orderedSessions.filter((session) => !session.archived_at);
    const archivedSessions = orderedSessions.filter((session) => Boolean(session.archived_at));

    const renderSessionRow = (session: Session) => {
        const isActive = selectedSession?.id === session.id;
        const isDiffActive =
            activeDiffTarget?.repoId === selectedRepo.id &&
            activeDiffTarget.sessionId === session.id;
        const isEditing = editingSessionId === session.id;
        const branchLabel = getSessionBranchLabel(session);
        const stateMeta = getSessionStateMeta(session.state);
        const dirtyCount = dirtySessionCounts[session.id];
        const isArchived = Boolean(session.archived_at);

        return (
            <li
                key={session.id}
                draggable={!isArchived}
                onDragStart={() => handleDragStart(session.id)}
                onDragOver={(e) => handleDragOver(e, session.id)}
                onDrop={(e) => { void handleDrop(e, session.id); }}
                onDragEnd={handleDragEnd}
                onClick={() => setSelectedSession(isActive ? null : session)}
                className={`group rounded-lg border cursor-pointer text-sm transition-all ${dragOverId === session.id
                    ? 'border-orange-400/60 bg-orange-600/10 scale-[0.98]'
                    : isArchived
                        ? 'border-gray-800/80 bg-gray-950/60 text-gray-400 hover:border-gray-700 hover:bg-gray-950/80'
                        : isActive
                            ? 'border-orange-500/40 bg-orange-600/10 text-white shadow-[0_8px_24px_rgba(234,88,12,0.12)]'
                            : 'border-gray-800 bg-gray-900/40 text-gray-200 hover:border-gray-700 hover:bg-gray-900/70'
                    }`}
            >
                <div className="px-2.5 py-2">
                    <div className="flex items-start gap-2 min-w-0">
                        <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${isArchived ? 'bg-gray-600 shadow-[0_0_0_1px_rgba(107,114,128,0.35)]' : stateMeta.dotClass} ${isActive ? 'ring-2 ring-black/45 ring-offset-1 ring-offset-orange-700/80' : ''}`} />
                        <span className={`flex-1 min-w-0 whitespace-normal break-words text-sm leading-5 font-medium ${isArchived
                            ? 'text-gray-300'
                            : isActive
                                ? 'text-white'
                                : 'text-gray-100'
                            }`}>
                            {session.name}
                        </span>
                    </div>

                    <div className="mt-2 min-h-[1.5rem] flex flex-wrap items-center gap-1">
                        <span className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${branchLabel
                            ? isActive
                                ? 'border-orange-400/40 bg-orange-500/10 text-orange-100'
                                : 'border-gray-700 bg-gray-800/90 text-gray-300'
                            : isActive
                                ? 'border-white/10 bg-black/20 text-gray-200'
                                : 'border-gray-800 bg-gray-900/60 text-gray-500'
                            }`}>
                            <span className="truncate">{branchLabel ?? 'No branch'}</span>
                        </span>
                        {isArchived && (
                            <span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-900/60 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                                Archived
                            </span>
                        )}
                    </div>

                    <div className="mt-2 flex items-start justify-between gap-2">
                        <span className={`text-xs leading-6 ${isActive ? 'text-orange-100' : 'text-gray-400'}`}>
                            {session.agent_type}
                        </span>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {!isArchived && (
                                <ActionButton
                                    title={selectedRepo.is_git_repo
                                        ? isDiffActive
                                            ? 'Hide file diffs'
                                            : 'View file diffs'
                                        : 'File diffs require a git repository'}
                                    disabled={!selectedRepo.is_git_repo}
                                    active={isDiffActive}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleDiffTarget(selectedRepo.id, session.id);
                                    }}
                                >
                                    <DiffIcon />
                                </ActionButton>
                            )}
                            {!isArchived && (
                                <ActionButton
                                    title="Restart session"
                                    disabled={restartingSessionId === session.id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void restartSession(session);
                                    }}
                                >
                                    <RefreshIcon spinning={restartingSessionId === session.id} />
                                </ActionButton>
                            )}
                            {!isArchived && (
                                <ActionButton
                                    title="Update session"
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
                            )}
                            <ActionButton
                                title={isArchived ? 'Restore session' : 'Archive session'}
                                disabled={archivingSessionId === session.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void toggleSessionArchive(session);
                                }}
                            >
                                {isArchived ? <span className="text-sm leading-none">↺</span> : <ArchiveIcon />}
                            </ActionButton>
                            <ActionButton
                                title="Delete session"
                                tone="danger"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void prepareDeleteSession(session);
                                }}
                            >
                                <span className="text-sm leading-none">×</span>
                            </ActionButton>
                        </div>
                    </div>

                    {confirmDeleteSessionId === session.id && (
                        <div className="mt-2 rounded-md border border-red-900/40 bg-red-950/20 px-2.5 py-2 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs text-red-100/90 break-words">
                                    {session.worktree_path ? `Delete ${session.name} and clean up its worktree?` : `Delete ${session.name}?`}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); void deleteSession(session.id); }}
                                        disabled={deletingSession}
                                        className="text-[10px] px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white font-medium transition-all disabled:opacity-40"
                                    >
                                        {deletingSession ? '…' : 'Yes'}
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteSessionId(null); }}
                                        className="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-all"
                                    >
                                        No
                                    </button>
                                </div>
                            </div>
                            {loadingDeleteDetailsId === session.id && (
                                <p className="text-[11px] text-red-200/80">Checking worktree status…</p>
                            )}
                            {loadingDeleteDetailsId !== session.id && dirtyCount > 0 && (
                                <p className="text-[11px] text-amber-200/90">
                                    This worktree has {dirtyCount} uncommitted change{dirtyCount === 1 ? '' : 's'}.
                                </p>
                            )}
                        </div>
                    )}
                </div>
                {isActive && !isEditing && sessionRefs.length > 0 && (
                    <div className="px-2 pb-1.5 flex flex-wrap gap-1">
                        {sessionRefs.map((file) => (
                            <span
                                key={file.id}
                                className="inline-flex items-center gap-0.5 text-[10px] bg-orange-900/60 text-orange-200/80 px-1.5 py-0.5 rounded font-medium"
                                title={file.path}
                            >
                                {file.path.split(/[/\\]/).pop()}
                            </span>
                        ))}
                    </div>
                )}
                {isActive && isEditing && (
                    <div className="px-2 pb-2 space-y-2" onClick={(e) => e.stopPropagation()}>
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
    };

    return (
        <div className="p-2 border-t border-gray-700 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Sessions
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => { void refreshSessions(); }}
                        title="Refresh sessions"
                        disabled={refreshingSessions}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <RefreshIcon spinning={refreshingSessions} />
                    </button>
                    <button
                        onClick={() => {
                            setShowNew(!showNew);
                            setErrorMsg('');
                            if (showNew) {
                                resetCreateForm();
                            }
                        }}
                        className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium ${showNew
                            ? 'bg-orange-600 border-orange-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-orange-400 hover:bg-gray-750 hover:text-orange-300 hover:border-gray-600'
                            }`}
                    >
                        {showNew ? '✕' : '+ Add'}
                    </button>
                </div>
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
                    {selectedRepo.is_git_repo && (
                        <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-2.5 space-y-2">
                            <div>
                                <div className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Git Branch</div>
                                <p className="mt-1 text-[11px] text-gray-500">
                                    Create an isolated worktree from a branch, or run directly in the shared repo root.
                                </p>
                            </div>
                            <div className="flex gap-1 p-0.5 bg-gray-950/80 rounded border border-gray-700/60">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBranchMode('new');
                                        setBranchName('');
                                        setBranchSearch('');
                                    }}
                                    className={`flex-1 text-xs py-1 rounded transition-all font-medium ${branchMode === 'new'
                                        ? 'bg-orange-600 text-white shadow-sm'
                                        : 'text-gray-400 hover:text-gray-200'
                                        }`}
                                >
                                    New branch
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBranchMode('existing');
                                        setBranchName('');
                                    }}
                                    className={`flex-1 text-xs py-1 rounded transition-all font-medium ${branchMode === 'existing'
                                        ? 'bg-orange-600 text-white shadow-sm'
                                        : 'text-gray-400 hover:text-gray-200'
                                        }`}
                                >
                                    Existing branch
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setBranchMode('root');
                                        setBranchName('');
                                        setBranchSearch('');
                                    }}
                                    className={`flex-1 text-xs py-1 rounded transition-all font-medium ${branchMode === 'root'
                                        ? 'bg-orange-600 text-white shadow-sm'
                                        : 'text-gray-400 hover:text-gray-200'
                                        }`}
                                >
                                    Repo root
                                </button>
                            </div>

                            {branchMode === 'root' ? (
                                <p className="rounded-md border border-amber-700/30 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-100/90">
                                    Uses the current checkout directly. Changes are shared with the repo root.
                                </p>
                            ) : branchMode === 'new' ? (
                                <input
                                    className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                                    placeholder="Branch name"
                                    value={branchName}
                                    onChange={(e) => setBranchName(e.target.value)}
                                />
                            ) : (
                                <div className="space-y-2">
                                    <input
                                        className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                                        placeholder={fetchingRemotes ? 'Fetching remote branches…' : 'Search local & remote branches'}
                                        value={branchSearch}
                                        onChange={(e) => setBranchSearch(e.target.value)}
                                    />
                                    {branchesLoading || fetchingRemotes ? (
                                        <p className="text-xs text-gray-500">{fetchingRemotes ? 'Fetching remote branches…' : 'Loading branches…'}</p>
                                    ) : branchOptions.length === 0 && branchSearch.trim() ? (
                                        <p className="text-xs text-gray-500">No branches match this filter.</p>
                                    ) : branchOptions.length === 0 ? (
                                        <p className="text-xs text-gray-500">No local or remote branches are available.</p>
                                    ) : (
                                        <ul className="space-y-1 max-h-40 overflow-y-auto">
                                            {branchOptions.map((branch) => {
                                                const isSelected = branchName === branch.name;
                                                return (
                                                    <li key={branch.name} className="space-y-1">
                                                        <button
                                                            type="button"
                                                            disabled={branch.in_use}
                                                            onClick={() => setBranchName(branch.name)}
                                                            className={`w-full text-left px-2.5 py-1.5 rounded-md border text-xs transition-all ${isSelected
                                                                ? 'border-orange-500 bg-orange-600/20 text-orange-100'
                                                                : branch.in_use
                                                                    ? 'border-gray-800 bg-gray-950/70 text-gray-500 cursor-not-allowed'
                                                                    : 'border-gray-700 bg-gray-900 text-gray-200 hover:border-gray-600 hover:bg-gray-850'
                                                                }`}
                                                        >
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="font-medium truncate">{branch.name}</span>
                                                                {branch.in_use ? (
                                                                    <span className="text-[10px] uppercase tracking-wider text-red-300 shrink-0">In use</span>
                                                                ) : branch.is_remote ? (
                                                                    <span className="text-[10px] uppercase tracking-wider text-sky-400 shrink-0">Remote</span>
                                                                ) : isSelected ? (
                                                                    <span className="text-[10px] uppercase tracking-wider text-orange-200 shrink-0">Selected</span>
                                                                ) : null}
                                                            </div>
                                                        </button>
                                                        {branch.disabled_reason && (
                                                            <p className="px-1 text-[11px] text-gray-500">{branch.disabled_reason}</p>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                    {branchName && (
                                        <p className="text-[11px] text-gray-400">
                                            Selected branch: <span className="font-semibold text-gray-200">{branchName}</span>
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
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
                {activeSessions.map(renderSessionRow)}
                {activeSessions.length === 0 && archivedSessions.length === 0 && (
                    <li className="text-xs text-gray-600 px-2 py-2 italic">
                        No sessions — click + Add to start one
                    </li>
                )}
                {archivedSessions.length > 0 && (
                    <li className="pt-2 pb-1 px-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        Archived
                    </li>
                )}
                {archivedSessions.map(renderSessionRow)}
            </ul>
        </div>
    );
}
