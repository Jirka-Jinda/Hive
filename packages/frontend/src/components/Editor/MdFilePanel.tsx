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
    prompt: '📝',
    other: '📄',
};

const TYPE_ORDER: Record<MdFile['type'], number> = { skill: 0, tool: 1, instruction: 2, prompt: 3, other: 4 };
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
    const [dropContent, setDropContent] = useState<string | null>(null);
    const [dragOverScope, setDragOverScope] = useState<'central' | 'repo' | null>(null);
    const [showGuide, setShowGuide] = useState(false);
    const [promptCreating, setPromptCreating] = useState(false);
    const [promptNewName, setPromptNewName] = useState('');
    const [promptCreatingBusy, setPromptCreatingBusy] = useState(false);

    const centralFiles = sortByType(mdFiles.filter((f) => f.scope === 'central'));
    const centralNonPromptFiles = centralFiles.filter((f) => f.type !== 'prompt');
    const promptFiles = centralFiles.filter((f) => f.type === 'prompt');
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

    const handleDragOver = (e: React.DragEvent, scope: 'central' | 'repo') => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverScope(scope);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        // Only clear if leaving the section entirely (not entering a child)
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOverScope(null);
        }
    };

    const handleDrop = (e: React.DragEvent, scope: 'central' | 'repo') => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverScope(null);

        const file = e.dataTransfer.files[0];
        if (!file) return;

        if (!file.name.endsWith('.md')) {
            setErrorMsg('Only .md files can be dropped here.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = (ev.target?.result as string) ?? '';
            setDropContent(content);
            setNewName(file.name);
            setNewType('other');
            setErrorMsg('');
            setConfirmDeleteId(null);
            setCreateForScope(scope);
        };
        reader.readAsText(file);
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
            const content = dropContent ?? `# ${newName.trim()}\n\n`;
            const file = await api.mdfiles.create({
                scope: createForScope,
                repoPath: createForScope === 'repo' ? selectedRepo?.path : undefined,
                filename: newName.trim(),
                content,
                type: newType,
            });
            const full = await api.mdfiles.get(file.id);
            setMdFiles([...mdFiles, file]);
            setSelectedMdFile(full);
            setCreateForScope(null);
            setNewName('');
            setDropContent(null);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to create file');
        } finally {
            setCreating(false);
        }
    };

    const createPromptFile = async () => {
        if (!promptNewName.trim()) return;
        setPromptCreatingBusy(true);
        try {
            const name = promptNewName.trim().endsWith('.md') ? promptNewName.trim() : `${promptNewName.trim()}.md`;
            const content = `---
name: ${name.replace(/\.md$/, '')}
description: 
params:
  - name: repo
    type: repo
  - name: session
    type: session
  - name: focus
    type: text
    default: "quality and correctness"
---

# {{name}}

Repo: {{repo}}  \nSession: {{session}}

{{focus}}
`;
            const file = await api.mdfiles.create({
                scope: 'central',
                filename: name,
                content,
                type: 'prompt',
            });
            const full = await api.mdfiles.get(file.id);
            setMdFiles([...mdFiles, file]);
            setSelectedMdFile(full);
            setPromptCreating(false);
            setPromptNewName('');
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to create file');
        } finally {
            setPromptCreatingBusy(false);
        }
    };

    // Called as a plain function (not a React component) to avoid remount on each render
    const renderSection = (files: MdFile[], label: string, scope: 'central' | 'repo') => {
        const isCreating = createForScope === scope;
        const isDragOver = dragOverScope === scope;
        return (
            <div
                key={scope}
                className={`mb-3 rounded-lg transition-all ${isDragOver ? 'ring-2 ring-orange-500/60 bg-orange-950/30' : ''}`}
                onDragOver={(e) => handleDragOver(e, scope)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, scope)}
            >
                <div className="flex items-center justify-between gap-2 px-2 mb-1">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        {label}
                    </div>
                    <button
                        onClick={() => { if (isCreating) { setCreateForScope(null); setDropContent(null); } else { startCreate(scope); } }}
                        className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium ${isCreating
                            ? 'bg-orange-600 border-orange-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-orange-400 hover:bg-gray-750 hover:text-orange-300 hover:border-gray-600'
                            }`}
                    >
                        {isCreating ? '\u2715' : '+ Add'}
                    </button>
                </div>

                {isCreating && (
                    <div className="mx-2 mb-2 p-2 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-1.5">
                        <input
                            className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded-md placeholder-gray-600 text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                            placeholder="filename.md"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && createFile()}
                            autoFocus
                        />
                        <select
                            className="w-full bg-gray-900 border border-gray-700 text-xs px-1.5 py-1 rounded-md text-gray-100 focus:outline-none focus:border-orange-500 transition-all"
                            value={newType}
                            onChange={(e) => setNewType(e.target.value as MdFile['type'])}
                        >
                            <option value="skill">Skill</option>
                            <option value="tool">Tool</option>
                            <option value="instruction">Instruction</option>
                            <option value="prompt">Prompt Template</option>
                            <option value="other">Other</option>
                        </select>
                        <button
                            onClick={createFile}
                            disabled={creating || (scope === 'repo' && !selectedRepo)}
                            className="w-full text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {creating ? 'Creating\u2026' : 'Create File'}
                        </button>
                        {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
                    </div>
                )}

                {files.length === 0 && !isDragOver ? (
                    <div className="text-xs text-gray-600 px-2 py-1 italic">Empty — drop a .md file here</div>
                ) : isDragOver ? (
                    <div className="text-xs text-orange-400 px-2 py-2 text-center border border-dashed border-orange-500/60 rounded-md mx-1 mb-1">
                        Drop to import .md file
                    </div>
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
                                        ? 'bg-orange-700/80 text-white'
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
                <span className="text-[11px] font-bold text-orange-400 tracking-[0.12em] uppercase">MD Files</span>
                <button
                    onClick={onCollapse}
                    title="Collapse panel"
                    className="inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-all text-sm leading-none font-medium"
                >
                    {'›'}
                </button>
            </div>

            <div className="flex-1 p-2 overflow-y-auto">
                {renderSection(centralNonPromptFiles, 'Central', 'central')}
                {selectedRepo && renderSection(repoFiles, `Repo: ${selectedRepo.name}`, 'repo')}

                {/* ── Prompt Templates section ─────────────────────── */}
                <div className="mt-1 mb-3">
                    <div className="flex items-center justify-between gap-2 px-2 mb-1">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Prompt Templates</div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setShowGuide((v) => !v)}
                                title="Template syntax guide"
                                className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold transition-all ${showGuide
                                        ? 'bg-orange-600/30 border-orange-500/60 text-orange-300'
                                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                                    }`}
                            >
                                ?
                            </button>
                            <button
                                onClick={() => { setPromptCreating((v) => !v); setPromptNewName(''); setErrorMsg(''); }}
                                className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded border transition-all font-medium ${promptCreating
                                        ? 'bg-orange-600 border-orange-500 text-white'
                                        : 'bg-gray-800 border-gray-700 text-orange-400 hover:bg-gray-750 hover:text-orange-300 hover:border-gray-600'
                                    }`}
                            >
                                {promptCreating ? '✕' : '+ Add'}
                            </button>
                        </div>
                    </div>

                    {showGuide && (
                        <div className="mx-2 mb-2 rounded-lg border border-orange-500/30 bg-gray-950/80 overflow-hidden">
                            <div className="px-3 py-2 border-b border-orange-500/20 flex items-center gap-1.5">
                                <span className="text-orange-400 text-xs font-semibold">Template syntax</span>
                            </div>
                            <pre className="px-3 py-2 text-[10px] leading-relaxed text-gray-400 whitespace-pre overflow-x-auto">{
                                `---
name: My Prompt
description: What this prompt does
params:
  - name: repo     # filled from repo dropdown
    type: repo
  - name: session  # filled from session dropdown
    type: session
  - name: focus    # free-text input
    type: text
    default: "security"
    description: What to focus on
---

Review {{repo}} (session: {{session}}).
Focus on {{focus}}.`
                            }</pre>
                            <div className="px-3 py-2 border-t border-orange-500/20">
                                <p className="text-[10px] text-gray-500">
                                    Param types: <span className="text-orange-300/80">text</span> · <span className="text-orange-300/80">repo</span> · <span className="text-orange-300/80">session</span>
                                    <span className="ml-2 text-gray-600">— Use</span> <span className="text-orange-300/80">{'{{'}<span>param</span>{'}}'}</span> <span className="text-gray-600">to insert values.</span>
                                </p>
                            </div>
                        </div>
                    )}

                    {promptCreating && (
                        <div className="mx-2 mb-2 p-2 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-1.5">
                            <input
                                className="w-full bg-gray-900 border border-gray-700 text-xs px-2 py-1.5 rounded-md placeholder-gray-600 text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                                placeholder="my-prompt.md"
                                value={promptNewName}
                                onChange={(e) => setPromptNewName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && createPromptFile()}
                                autoFocus
                            />
                            <p className="text-[10px] text-gray-500">Creates a prompt template with sample YAML frontmatter.</p>
                            <button
                                onClick={createPromptFile}
                                disabled={promptCreatingBusy || !promptNewName.trim()}
                                className="w-full text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {promptCreatingBusy ? 'Creating…' : 'Create Prompt'}
                            </button>
                            {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
                        </div>
                    )}

                    {promptFiles.length === 0 && !promptCreating ? (
                        <div className="text-xs text-gray-600 px-2 py-1 italic">No prompt templates yet</div>
                    ) : (
                        promptFiles.map((f) => {
                            const isPendingDelete = confirmDeleteId === f.id;
                            return (
                                <div
                                    key={f.id}
                                    onClick={() => !isPendingDelete && openFile(f)}
                                    className={`group rounded-md cursor-pointer text-xs transition-all ${isPendingDelete
                                            ? 'bg-gray-800'
                                            : selectedMdFile?.id === f.id
                                                ? 'bg-orange-700/80 text-white'
                                                : 'text-gray-300 hover:bg-gray-800'
                                        }`}
                                >
                                    {isPendingDelete ? (
                                        <div className="flex items-center justify-between px-2 py-1.5 gap-2">
                                            <span className="text-xs text-gray-400 truncate">Delete {f.path.split(/[\/\\]/).pop()}?</span>
                                            <div className="flex gap-1 shrink-0">
                                                <button onClick={(e) => { e.stopPropagation(); void deleteFile(f.id); }} disabled={deleting} className="text-[10px] px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white font-medium transition-all disabled:opacity-40">{deleting ? '…' : 'Yes'}</button>
                                                <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-all">No</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between px-2 py-1.5">
                                            <span className="truncate flex items-center gap-1.5">
                                                <span className="opacity-60">📝</span>
                                                {f.path.split(/[\/\\]/).pop()}
                                            </span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(f.id); }}
                                                className="inline-flex items-center justify-center w-4 h-4 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/40 ml-1 opacity-0 group-hover:opacity-100 transition-all text-sm shrink-0"
                                                title="Delete"
                                            >×</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}