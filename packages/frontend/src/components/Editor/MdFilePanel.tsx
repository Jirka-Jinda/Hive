import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { MdFile } from '../../api/client';

interface Props {
    onCollapse: () => void;
}

const typeIcon: Record<MdFile['type'], string> = {
    skill: '🧠',
    tool: '🔧',
    instruction: '📋',
    other: '📄',
};

const TYPE_ORDER: Record<MdFile['type'], number> = { skill: 0, tool: 1, instruction: 2, other: 3 };
const sortByType = (files: MdFile[]) =>
    [...files].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);

export default function MdFilePanel({ onCollapse }: Props) {
    const { mdFiles, setMdFiles, selectedRepo, setSelectedMdFile, selectedMdFile } = useAppStore();
    const [createForScope, setCreateForScope] = useState<'central' | 'repo' | null>(null);
    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState<MdFile['type']>('other');
    const [creating, setCreating] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const centralFiles = sortByType(mdFiles.filter((f) => f.scope === 'central'));
    const repoFiles = sortByType(mdFiles.filter((f) => f.scope === 'repo'));

    useEffect(() => {
        if (!selectedRepo && createForScope === 'repo') setCreateForScope(null);
    }, [createForScope, selectedRepo]);

    const startCreate = (scope: 'central' | 'repo') => {
        setCreateForScope(scope);
        setNewName('');
        setNewType('other');
        setErrorMsg('');
        setConfirmDeleteId(null);
    };

    const openFile = async (file: MdFile) => {
        try {
            setErrorMsg('');
            const full = await api.mdfiles.get(file.id);
            setSelectedMdFile(full);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to open file');
        }
    };

    const deleteFile = async (id: number) => {
        setDeleting(true);
        try {
            setErrorMsg('');
            await api.mdfiles.delete(id);
            setMdFiles(mdFiles.filter((f) => f.id !== id));
            if (selectedMdFile?.id === id) setSelectedMdFile(null);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to delete file');
        } finally {
            setDeleting(false);
            setConfirmDeleteId(null);
        }
    };

    const createFile = async () => {
        if (!newName.trim() || !createForScope) return;
        setCreating(true);
        try {
            setErrorMsg('');
            const file = await api.mdfiles.create({
                scope: createForScope,
                repoPath: createForScope === 'repo' ? selectedRepo?.path : undefined,
                filename: newName.trim(),
                content: `# ${newName.trim()}\n\n`,
                type: newType,
            });
            const full = await api.mdfiles.get(file.id);
            setMdFiles([...mdFiles, file]);
            setSelectedMdFile(full);
            setCreateForScope(null);
            setNewName('');
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to create file');
        } finally {
            setCreating(false);
        }
    };

    // Called as a plain function (not a React component) to avoid remount on each render
    const renderSection = (files: MdFile[], label: string, scope: 'central' | 'repo') => {
        const isCreating = createForScope === scope;
        return (
            <div key={scope} className="mb-3">
                <div className="flex items-center justify-between gap-2 px-2 mb-1">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        {label}
                    </div>
                    <button
                        onClick={() => isCreating ? setCreateForScope(null) : startCreate(scope)}
                        className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium ${isCreating
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'bg-gray-800 border-gray-700 text-indigo-400 hover:bg-gray-750 hover:text-indigo-300 hover:border-gray-600'
                            }`}
                    >
                        {isCreating ? '\u2715' : '+ Add'}
                    </button>
                </div>

                {isCreating && (
                    <div className="mx-2 mb-2 p-2 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-1.5">
                        <input
                            className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded-md placeholder-gray-600 text-gray-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                            placeholder="filename.md"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && createFile()}
                            autoFocus
                        />
                        <select
                            className="w-full bg-gray-900 border border-gray-700 text-xs px-1.5 py-1 rounded-md text-gray-100 focus:outline-none focus:border-indigo-500 transition-all"
                            value={newType}
                            onChange={(e) => setNewType(e.target.value as MdFile['type'])}
                        >
                            <option value="skill">Skill</option>
                            <option value="tool">Tool</option>
                            <option value="instruction">Instruction</option>
                            <option value="other">Other</option>
                        </select>
                        <button
                            onClick={createFile}
                            disabled={creating || (scope === 'repo' && !selectedRepo)}
                            className="w-full text-xs bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white py-1 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {creating ? 'Creating\u2026' : 'Create File'}
                        </button>
                        {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
                    </div>
                )}

                {files.length === 0 ? (
                    <div className="text-xs text-gray-600 px-2 py-1 italic">Empty</div>
                ) : (
                    files.map((f) => {
                        const isPendingDelete = confirmDeleteId === f.id;
                        return (
                            <div
                                key={f.id}
                                onClick={() => !isPendingDelete && openFile(f)}
                                className={`group rounded-md cursor-pointer text-xs transition-all ${isPendingDelete
                                        ? 'bg-gray-800'
                                        : selectedMdFile?.id === f.id
                                            ? 'bg-indigo-700/80 text-white'
                                            : 'text-gray-300 hover:bg-gray-800'
                                    }`}
                            >
                                {isPendingDelete ? (
                                    <div className="flex items-center justify-between px-2 py-1.5 gap-2">
                                        <span className="text-xs text-gray-400 truncate">
                                            Delete {f.path.split(/[\/\\]/).pop()}?
                                        </span>
                                        <div className="flex gap-1 shrink-0">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); void deleteFile(f.id); }}
                                                disabled={deleting}
                                                className="text-[10px] px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white font-medium transition-all disabled:opacity-40"
                                            >
                                                {deleting ? '\u2026' : 'Yes'}
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                                                className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-all"
                                            >
                                                No
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between px-2 py-1.5">
                                        <span className="truncate flex items-center gap-1.5">
                                            <span className="opacity-60">{typeIcon[f.type]}</span>
                                            {f.path.split(/[\/\\]/).pop()}
                                        </span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(f.id); }}
                                            className="inline-flex items-center justify-center w-4 h-4 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/40 ml-1 opacity-0 group-hover:opacity-100 transition-all text-sm shrink-0"
                                            title="Delete"
                                        >
                                            {'×'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800/80 w-full overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800/80 bg-gray-950/40 shrink-0">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">MD Files</span>
                <button
                    onClick={onCollapse}
                    title="Collapse panel"
                    className="inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-all text-sm leading-none font-medium"
                >
                    {'›'}
                </button>
            </div>

            <div className="flex-1 p-2 overflow-y-auto">
                {renderSection(centralFiles, 'Central', 'central')}
                {selectedRepo && renderSection(repoFiles, `Repo: ${selectedRepo.name}`, 'repo')}
            </div>
        </div>
    );
}