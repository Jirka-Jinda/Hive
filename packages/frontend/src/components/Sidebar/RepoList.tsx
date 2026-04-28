import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { MdFile, Repo } from '../../api/client';
import MdFilePicker from './MdFilePicker';

function RepoIcon({ isGitRepo, className = 'w-4 h-4' }: { isGitRepo: boolean; className?: string }) {
    if (isGitRepo) {
        return (
            <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="7" cy="5.5" r="2" />
                <circle cx="17" cy="8.5" r="2" />
                <circle cx="7" cy="18.5" r="2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5.5v7a4 4 0 004 4h2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.5a4 4 0 004 4h2" />
            </svg>
        );
    }

    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 7.75A1.75 1.75 0 015.5 6h4.02c.46 0 .9.18 1.22.51l1.25 1.23c.33.33.77.51 1.23.51h5.28a1.75 1.75 0 011.75 1.75v6.25A1.75 1.75 0 0118.5 18H5.5a1.75 1.75 0 01-1.75-1.75v-8.5z"
            />
        </svg>
    );
}

function EditIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49a2.1 2.1 0 112.97 2.97L9 18.3l-4 1 1-4L16.86 4.49z" />
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

export default function RepoList() {
    const { repos, selectedRepo, setRepos, setSelectedRepo, updateRepo, setSessions, setMdFiles, mdFiles } =
        useAppStore();
    const [showAdd, setShowAdd] = useState(false);
    const [isGit, setIsGit] = useState(false);
    const [gitInput, setGitInput] = useState('');
    const [discovered, setDiscovered] = useState<{ name: string; path: string }[]>([]);
    const [selectedPath, setSelectedPath] = useState<string>('');
    const [discoverLoading, setDiscoverLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    // Step 2: link central MD files to the newly created repo
    const [pendingRepo, setPendingRepo] = useState<Repo | null>(null);
    const [selectedRefs, setSelectedRefs] = useState<number[]>([]);
    const [savingRefs, setSavingRefs] = useState(false);
    // Active repo context display
    const [repoRefs, setRepoRefs] = useState<import('../../api/client').MdFile[]>([]);
    const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
    const [removing, setRemoving] = useState(false);
    const [deleteFromDisk, setDeleteFromDisk] = useState(false);
    const [editingRepoId, setEditingRepoId] = useState<number | null>(null);
    const [editingRepoName, setEditingRepoName] = useState('');
    const [editingRepoRefs, setEditingRepoRefs] = useState<number[]>([]);
    const [savingEdit, setSavingEdit] = useState(false);

    // Fetch discovered repos whenever the local-path tab is active and form is open
    useEffect(() => {
        if (!showAdd || isGit) return;
        setDiscoverLoading(true);
        api.repos.discover()
            .then((list) => {
                const trackedPaths = new Set(repos.map((r) => r.path));
                setDiscovered(list.filter((d) => !trackedPaths.has(d.path)));
                setSelectedPath('');
            })
            .catch(() => setDiscovered([]))
            .finally(() => setDiscoverLoading(false));
    }, [showAdd, isGit]);

    const selectRepo = async (repo: Repo) => {
        setSelectedRepo(repo);
        setRepoRefs([]);
        const [sessions, repoMdFiles, refs] = await Promise.all([
            api.repos.sessions.list(repo.id),
            api.mdfiles.list('repo', repo.id),
            api.repos.mdRefs.get(repo.id),
        ]);
        if (useAppStore.getState().selectedRepo?.id !== repo.id) return;
        const centralFiles = useAppStore.getState().mdFiles.filter((file) => file.scope === 'central');
        updateRepo({ ...repo, session_count: sessions.length });
        setSessions(sessions);
        setMdFiles([...centralFiles, ...repoMdFiles]);
        setRepoRefs(refs);
    };

    const addRepo = async () => {
        const value = isGit ? gitInput.trim() : selectedPath;
        if (!value) return;
        setLoading(true);
        setErrorMsg('');
        try {
            const body = isGit ? { gitUrl: value } : { path: value };
            const repo = await api.repos.create(body);
            setRepos([...repos, repo]);
            setGitInput('');
            setSelectedPath('');
            setShowAdd(false);
            // Transition to step 2 only if there are central files to pick
            const central = useAppStore.getState().mdFiles.filter((f) => f.scope === 'central');
            if (central.length > 0) {
                setPendingRepo(repo);
                setSelectedRefs([]);
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to add repository');
        } finally {
            setLoading(false);
        }
    };

    const saveRefs = async () => {
        if (!pendingRepo) return;
        setSavingRefs(true);
        try {
            if (selectedRefs.length > 0) {
                await api.repos.mdRefs.set(pendingRepo.id, selectedRefs);
            }
        } catch {
            // Non-critical — silently ignore
        } finally {
            setSavingRefs(false);
            setPendingRepo(null);
            setSelectedRefs([]);
        }
    };

    const removeRepo = async (id: number) => {
        setRemoving(true);
        setErrorMsg('');
        try {
            await api.repos.delete(id, deleteFromDisk);
            setRepos(repos.filter((r) => r.id !== id));
            if (selectedRepo?.id === id) setSelectedRepo(null);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to remove repository');
        } finally {
            setRemoving(false);
            setConfirmRemoveId(null);
            setDeleteFromDisk(false);
        }
    };

    const startEditingRepo = async (repo: Repo) => {
        if (selectedRepo?.id !== repo.id) return;
        setErrorMsg('');
        try {
            const refs = await api.repos.mdRefs.get(repo.id);
            if (useAppStore.getState().selectedRepo?.id !== repo.id) return;
            setRepoRefs(refs);
            setEditingRepoRefs(refs.map((file) => file.id));
        } catch {
            setEditingRepoRefs(repoRefs.map((file) => file.id));
        }
        setEditingRepoId(repo.id);
        setEditingRepoName(repo.name);
    };

    const cancelEditingRepo = () => {
        setEditingRepoId(null);
        setEditingRepoName('');
        setEditingRepoRefs([]);
    };

    const saveRepoEdit = async () => {
        if (!selectedRepo || editingRepoId !== selectedRepo.id) return;
        const nextName = editingRepoName.trim();
        if (!nextName) {
            setErrorMsg('Repository name is required');
            return;
        }

        setSavingEdit(true);
        setErrorMsg('');
        try {
            const updatedRepo = await api.repos.update(selectedRepo.id, { name: nextName });
            await api.repos.mdRefs.set(selectedRepo.id, editingRepoRefs);
            const refs = await api.repos.mdRefs.get(selectedRepo.id);
            updateRepo(updatedRepo);
            setRepoRefs(refs);
            cancelEditingRepo();
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to update repository');
        } finally {
            setSavingEdit(false);
        }
    };

    return (
        <div className="p-2">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Repositories
                </span>
                <button
                    onClick={() => { setShowAdd(!showAdd); setErrorMsg(''); }}
                    className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium ${showAdd
                        ? 'bg-orange-600 border-orange-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-orange-400 hover:bg-gray-750 hover:text-orange-300 hover:border-gray-600'
                        }`}
                >
                    {showAdd ? '✕' : '+ Add'}
                </button>
            </div>

            {showAdd && (
                <div className="mb-2 p-2.5 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-2">
                    <div className="flex gap-1 p-0.5 bg-gray-900/60 rounded border border-gray-700/50">
                        <button
                            onClick={() => { setIsGit(false); setErrorMsg(''); }}
                            className={`flex-1 text-xs py-1 rounded transition-all font-medium ${!isGit
                                ? 'bg-orange-600 text-white shadow-sm'
                                : 'text-gray-400 hover:text-gray-200'
                                }`}
                        >
                            Local path
                        </button>
                        <button
                            onClick={() => { setIsGit(true); setErrorMsg(''); }}
                            className={`flex-1 text-xs py-1 rounded transition-all font-medium ${isGit
                                ? 'bg-orange-600 text-white shadow-sm'
                                : 'text-gray-400 hover:text-gray-200'
                                }`}
                        >
                            Git URL
                        </button>
                    </div>

                    {isGit ? (
                        <input
                            className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                            placeholder="https://github.com/org/repo.git"
                            value={gitInput}
                            onChange={(e) => setGitInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addRepo()}
                            autoFocus
                        />
                    ) : discoverLoading ? (
                        <p className="text-xs text-gray-500 py-1 px-1">Scanning repos folder…</p>
                    ) : discovered.length === 0 ? (
                        <p className="text-xs text-gray-500 py-1 px-1 italic">
                            No untracked repositories found in the repos folder.
                        </p>
                    ) : (
                        <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                            {discovered.map((d) => (
                                <li
                                    key={d.path}
                                    onClick={() => setSelectedPath(d.path === selectedPath ? '' : d.path)}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-all ${selectedPath === d.path
                                        ? 'bg-orange-700 text-white'
                                        : 'text-gray-300 hover:bg-gray-700'
                                        }`}
                                >
                                    <span className={`inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-md ${selectedPath === d.path
                                        ? 'bg-black/20 ring-1 ring-black/10 text-white'
                                        : 'text-gray-400'
                                        }`}>
                                        <RepoIcon isGitRepo={true} />
                                    </span>
                                    <span className="truncate">{d.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
                    <button
                        onClick={addRepo}
                        disabled={loading || (isGit ? !gitInput.trim() : !selectedPath)}
                        className="w-full text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {loading ? (isGit ? 'Cloning…' : 'Adding…') : 'Add Repository'}
                    </button>
                </div>
            )}

            {/* Step 2 — link central MD files to the just-created repo */}
            {pendingRepo && (
                <div className="mb-2 p-2.5 bg-gray-800/80 border border-orange-600/40 rounded-lg space-y-2">
                    <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">
                        Context files for {pendingRepo.name}
                    </p>
                    <p className="text-xs text-gray-500">
                        Select central MD files to inject as context when sessions start.
                    </p>
                    <MdFilePicker
                        files={mdFiles.filter((f) => f.scope === 'central' && f.type !== 'prompt')}
                        selected={selectedRefs}
                        onChange={setSelectedRefs}
                    />
                    <div className="flex gap-1.5">
                        <button
                            onClick={saveRefs}
                            disabled={savingRefs}
                            className="flex-1 text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {savingRefs ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            onClick={() => { setPendingRepo(null); setSelectedRefs([]); }}
                            className="text-xs px-3 py-1.5 rounded-md border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 font-medium transition-all"
                        >
                            Skip
                        </button>
                    </div>
                </div>
            )}

            {!showAdd && !pendingRepo && errorMsg && <p className="px-2 pb-2 text-xs text-red-400">{errorMsg}</p>}

            <ul className="space-y-0.5">
                {repos.map((repo) => {
                    const isActive = selectedRepo?.id === repo.id;
                    const isPendingRemove = confirmRemoveId === repo.id;
                    const isEditing = editingRepoId === repo.id;
                    return (
                        <li
                            key={repo.id}
                            onClick={() => !isPendingRemove && selectRepo(repo)}
                            className={`group rounded-lg border cursor-pointer text-sm ${isActive
                                ? 'border-orange-500/40 bg-orange-600/10 text-white shadow-[0_8px_24px_rgba(234,88,12,0.12)]'
                                : 'border-gray-800 bg-gray-900/40 text-gray-200 hover:border-gray-700 hover:bg-gray-900/70'
                                }`}
                        >
                            <div className="flex items-center justify-between px-2 py-1.5">
                                {isPendingRemove ? (
                                    <>
                                        <div className="flex flex-col gap-1 w-full">
                                            <span className="text-xs text-gray-300 truncate">Remove {repo.name}?</span>
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={deleteFromDisk}
                                                    onChange={(e) => setDeleteFromDisk(e.target.checked)}
                                                    className="w-3 h-3 accent-red-500"
                                                />
                                                <span className="text-[10px] text-gray-400">Also delete from disk</span>
                                            </label>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); void removeRepo(repo.id); }}
                                                    disabled={removing}
                                                    className="text-[10px] px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white font-medium transition-all disabled:opacity-40"
                                                >
                                                    {removing ? '…' : 'Yes'}
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(null); setDeleteFromDisk(false); }}
                                                    className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-all"
                                                >
                                                    No
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className={`inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-md ${isActive
                                                ? 'bg-black/20 ring-1 ring-black/10 text-white shadow-sm'
                                                : 'text-gray-300 group-hover:text-gray-100'
                                                }`}>
                                                <RepoIcon isGitRepo={repo.is_git_repo} className="w-4 h-4" />
                                            </span>
                                            <span className="truncate">{repo.name}</span>
                                            {(repo.session_count ?? 0) > 0 && (
                                                <span
                                                    className={`inline-flex items-center justify-center min-w-[1.15rem] h-4 px-1 rounded-full text-[10px] font-medium ${isActive
                                                        ? 'bg-black/20 text-orange-100 ring-1 ring-black/10'
                                                        : 'border border-gray-700/80 bg-gray-800 text-gray-400'
                                                        }`}
                                                    title={`${repo.session_count} session${repo.session_count === 1 ? '' : 's'}`}
                                                >
                                                    {repo.session_count}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center shrink-0">
                                            <ActionButton
                                                title="Update repository"
                                                visible={isActive}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isEditing) {
                                                        cancelEditingRepo();
                                                        return;
                                                    }
                                                    void startEditingRepo(repo);
                                                }}
                                            >
                                                <EditIcon />
                                            </ActionButton>
                                            <ActionButton
                                                title="Remove repository"
                                                visible={isActive}
                                                tone="danger"
                                                onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(repo.id); }}
                                            >
                                                <span className="text-sm leading-none">×</span>
                                            </ActionButton>
                                        </div>
                                    </>
                                )}
                            </div>
                            {isActive && !isEditing && repoRefs.length > 0 && (
                                <div className="px-2 pb-1.5 flex flex-wrap gap-1">
                                    {repoRefs.map((f) => (
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
                                        value={editingRepoName}
                                        onChange={(e) => setEditingRepoName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && void saveRepoEdit()}
                                        placeholder="Repository name"
                                    />
                                    <MdFilePicker
                                        files={mdFiles.filter((file) => file.scope === 'central' && file.type !== 'prompt')}
                                        selected={editingRepoRefs}
                                        onChange={setEditingRepoRefs}
                                        label="Context files"
                                    />
                                    <div className="flex gap-1.5">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); void saveRepoEdit(); }}
                                            disabled={savingEdit}
                                            className="flex-1 text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {savingEdit ? 'Saving…' : 'Save'}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); cancelEditingRepo(); }}
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
                {repos.length === 0 && (
                    <li className="text-xs text-gray-600 px-2 py-2 italic">
                        No repositories — click + Add to get started
                    </li>
                )}
            </ul>
        </div>
    );
}
