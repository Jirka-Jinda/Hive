import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { Repo } from '../../api/client';
import MdFilePicker from './MdFilePicker';

export default function RepoList() {
    const { repos, selectedRepo, setRepos, setSelectedRepo, setSessions, setMdFiles, mdFiles } =
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
                                    <span className="text-gray-400 shrink-0">◈</span>
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
                    return (
                        <li
                            key={repo.id}
                            onClick={() => !isPendingRemove && selectRepo(repo)}
                            className={`group rounded cursor-pointer text-sm ${isActive
                                ? 'bg-orange-700 text-white'
                                : 'text-gray-300 hover:bg-gray-800'
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
                                            <span className="text-gray-500 text-xs shrink-0">
                                                {repo.source === 'git' ? '⧡' : '◈'}
                                            </span>
                                            <span className="truncate">{repo.name}</span>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(repo.id); }}
                                            className="inline-flex items-center justify-center w-5 h-5 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/40 ml-1 shrink-0 opacity-0 group-hover:opacity-100 transition-all text-sm"
                                            title="Remove repository"
                                        >
                                            ×
                                        </button>
                                    </>
                                )}
                            </div>
                            {isActive && repoRefs.length > 0 && (
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
