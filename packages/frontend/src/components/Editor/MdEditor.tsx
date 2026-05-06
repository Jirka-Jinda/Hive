import { useEffect, useState, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import MdPreview from './MdPreview';
import { useAppStore } from '../../store/appStore';
import { api, type MdFileRevision } from '../../api/client';

export default function MdEditor() {
    const { selectedMdFile, setSelectedMdFile, setMdFiles, selectedRepo, selectedSession } = useAppStore();
    const [content, setContent] = useState('');
    const [draftType, setDraftType] = useState<'documentation' | 'skill' | 'tool' | 'instruction' | 'prompt' | 'other'>('other');
    const [targetScope, setTargetScope] = useState<'central' | 'repo' | 'session'>('central');
    const [saving, setSaving] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [moving, setMoving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [revisions, setRevisions] = useState<MdFileRevision[]>([]);
    const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
    const [loadingRevisions, setLoadingRevisions] = useState(false);
    const [restoringRevision, setRestoringRevision] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const selectedRevision = revisions.find((revision) => revision.id === selectedRevisionId) ?? revisions[0] ?? null;

    const loadRevisions = useCallback(async (fileId = selectedMdFile?.id) => {
        if (!fileId) {
            setRevisions([]);
            setSelectedRevisionId(null);
            return;
        }

        setLoadingRevisions(true);
        try {
            const nextRevisions = await api.mdfiles.revisions.list(fileId);
            setRevisions(nextRevisions);
            setSelectedRevisionId((currentRevisionId) => {
                if (currentRevisionId && nextRevisions.some((revision) => revision.id === currentRevisionId)) {
                    return currentRevisionId;
                }
                return nextRevisions[0]?.id ?? null;
            });
        } catch {
            setRevisions([]);
            setSelectedRevisionId(null);
        } finally {
            setLoadingRevisions(false);
        }
    }, [selectedMdFile?.id]);

    const save = useCallback(async () => {
        if (!selectedMdFile) return;

        setSaving(true);
        try {
            setErrorMsg('');
            const saved = await api.mdfiles.update(selectedMdFile.id, {
                content,
                type: draftType,
            });
            const updated = { ...selectedMdFile, ...saved, content };
            const { selectedMdFile: currentSelectedMdFile, mdFiles: currentMdFiles } = useAppStore.getState();

            if (currentSelectedMdFile?.id === selectedMdFile.id) {
                setSelectedMdFile(updated);
            }

            setMdFiles(currentMdFiles.map((f) => (f.id === selectedMdFile.id ? { ...f, ...saved } : f)));
            if (showHistory) {
                void loadRevisions(selectedMdFile.id);
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }, [selectedMdFile, content, draftType, setSelectedMdFile, setMdFiles, showHistory, loadRevisions]);

    const duplicateToSession = useCallback(async () => {
        if (!selectedMdFile || !selectedSession?.id || !selectedSession.worktree_path) return;

        setDuplicating(true);
        try {
            setErrorMsg('');
            const filename = selectedMdFile.path.split(/[/\\]/).pop() ?? selectedMdFile.path;
            const created = await api.mdfiles.create({
                scope: 'session',
                sessionId: selectedSession.id,
                filename,
                content,
                type: draftType,
            });
            const full = await api.mdfiles.get(created.id);
            const { mdFiles: currentMdFiles } = useAppStore.getState();
            setMdFiles([...currentMdFiles.filter((file) => file.id !== created.id), created]);
            setSelectedMdFile(full);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to duplicate to session');
        } finally {
            setDuplicating(false);
        }
    }, [selectedMdFile, selectedSession?.id, selectedSession?.worktree_path, content, draftType, setMdFiles, setSelectedMdFile]);

    const moveToScope = useCallback(async () => {
        if (!selectedMdFile || targetScope === selectedMdFile.scope) return;

        if (targetScope === 'session') {
            await duplicateToSession();
            return;
        }

        const repoPath = targetScope === 'repo' ? selectedRepo?.path : undefined;
        if (targetScope === 'repo' && !repoPath) {
            setErrorMsg('Select a repository before moving this file to repo scope.');
            return;
        }

        setMoving(true);
        try {
            setErrorMsg('');
            const moved = await api.mdfiles.update(selectedMdFile.id, {
                content,
                scope: targetScope,
                repoPath,
                type: draftType,
            });
            const full = await api.mdfiles.get(selectedMdFile.id);
            const { mdFiles: currentMdFiles, selectedMdFile: currentSelectedMdFile } = useAppStore.getState();
            setMdFiles(currentMdFiles.map((file) => (file.id === selectedMdFile.id ? { ...file, ...moved } : file)));
            if (currentSelectedMdFile?.id === selectedMdFile.id) {
                setSelectedMdFile(full);
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Move failed');
        } finally {
            setMoving(false);
        }
    }, [content, draftType, duplicateToSession, selectedMdFile, selectedRepo?.path, setMdFiles, setSelectedMdFile, targetScope]);

    const restoreRevision = useCallback(async () => {
        if (!selectedMdFile || !selectedRevision) return;

        setRestoringRevision(true);
        try {
            setErrorMsg('');
            await api.mdfiles.revisions.restore(selectedMdFile.id, selectedRevision.id);
            const full = await api.mdfiles.get(selectedMdFile.id);
            const { mdFiles: currentMdFiles, selectedMdFile: currentSelectedMdFile } = useAppStore.getState();
            setMdFiles(currentMdFiles.map((file) => (file.id === selectedMdFile.id ? { ...file, ...full } : file)));
            if (currentSelectedMdFile?.id === selectedMdFile.id) {
                setSelectedMdFile(full);
            }
            setContent(full.content);
            setDraftType(full.type);
            setTargetScope(full.scope);
            await loadRevisions(selectedMdFile.id);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Restore failed');
        } finally {
            setRestoringRevision(false);
        }
    }, [loadRevisions, selectedMdFile, selectedRevision, setMdFiles, setSelectedMdFile]);

    // Keep a stable ref so the Monaco keybinding and auto-save always call the latest save.
    // The ref is updated after the file-switch effect so switching files saves the outgoing draft.
    const saveRef = useRef(save);

    const prevFileId = useRef<number | undefined>(undefined);

    // Auto-save when switching to a different file
    useEffect(() => {
        const prev = prevFileId.current;
        prevFileId.current = selectedMdFile?.id;
        if (prev !== undefined && prev !== selectedMdFile?.id) {
            void saveRef.current();
        }
        setContent(selectedMdFile?.content ?? '');
        setDraftType(selectedMdFile?.type ?? 'other');
        setTargetScope(selectedMdFile?.scope ?? 'central');
        setRevisions([]);
        setSelectedRevisionId(null);
        setErrorMsg('');
    }, [selectedMdFile?.id]);

    useEffect(() => {
        saveRef.current = save;
    }, [save]);

    useEffect(() => {
        if (!showHistory || !selectedMdFile?.id) return;
        void loadRevisions(selectedMdFile.id);
    }, [showHistory, selectedMdFile?.id, loadRevisions]);

    if (!selectedMdFile) return null;

    const filename = selectedMdFile.path.split(/[/\\]/).pop() ?? 'file.md';
    const typeBadgeColors: Record<string, string> = {
        documentation: 'bg-teal-900 text-teal-300',
        skill: 'bg-purple-900 text-purple-300',
        tool: 'bg-blue-900 text-blue-300',
        instruction: 'bg-green-900 text-green-300',
        prompt: 'bg-orange-900 text-orange-300',
        other: 'bg-gray-700 text-gray-400',
    };
    const currentScope = selectedMdFile.scope;
    const hasScopeChange = targetScope !== currentScope;
    const scopeActionLabel = !hasScopeChange
        ? null
        : targetScope === 'session'
            ? 'Duplicate to Session'
            : targetScope === 'repo'
                ? 'Move to Repo'
                : 'Move to Central';
    const scopeHelpText = !hasScopeChange
        ? null
        : targetScope === 'session'
            ? 'This creates a branch-local copy for the selected session. The current file stays where it is.'
            : targetScope === 'repo'
                ? 'This moves the file into repo scope and makes it shared across the repository.'
                : 'This moves the file into the central library for reuse across repositories.';

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0 bg-gray-900">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-200 truncate">{filename}</span>
                    <span
                        className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadgeColors[draftType] ?? typeBadgeColors.other
                            }`}
                    >
                        {draftType}
                    </span>
                    <span className="text-xs text-gray-600">
                        {currentScope === 'central'
                            ? 'central'
                            : currentScope === 'repo'
                                ? `repo${selectedRepo ? `: ${selectedRepo.name}` : ''}`
                                : `session${selectedSession ? `: ${selectedSession.name}` : ''}`}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1 text-xs text-gray-400">
                        <span className="sr-only">MD file type</span>
                        <select
                            aria-label="MD file type"
                            value={draftType}
                            onChange={(event) => setDraftType(event.target.value as typeof draftType)}
                            className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-500"
                        >
                            <option value="documentation">Documentation</option>
                            <option value="skill">Skill</option>
                            <option value="tool">Tool</option>
                            <option value="instruction">Instruction</option>
                            <option value="prompt">Prompt</option>
                            <option value="other">Other</option>
                        </select>
                    </label>
                    <label className="flex items-center gap-1 text-xs text-gray-400">
                        <span className="sr-only">MD file target scope</span>
                        <select
                            aria-label="MD file target scope"
                            value={targetScope}
                            onChange={(event) => setTargetScope(event.target.value as typeof targetScope)}
                            className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-500"
                        >
                            <option value="central">Central</option>
                            <option value="repo" disabled={!selectedRepo}>Repo</option>
                            <option value="session" disabled={!selectedSession?.worktree_path}>Session</option>
                        </select>
                    </label>
                    {errorMsg && <span className="text-xs text-red-400">{errorMsg}</span>}
                    {!hasScopeChange && selectedSession?.worktree_path && selectedMdFile.scope !== 'session' && (
                        <button
                            onClick={duplicateToSession}
                            disabled={duplicating}
                            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50 transition-colors"
                        >
                            {duplicating ? 'Duplicating…' : 'Duplicate to Session'}
                        </button>
                    )}
                    {hasScopeChange && scopeActionLabel && (
                        <button
                            onClick={moveToScope}
                            disabled={moving || (targetScope === 'session' && (!selectedSession?.id || !selectedSession.worktree_path)) || (targetScope === 'repo' && !selectedRepo?.path)}
                            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50 transition-colors"
                            title={scopeHelpText ?? undefined}
                        >
                            {moving || duplicating ? 'Applying…' : scopeActionLabel}
                        </button>
                    )}
                    <button
                        onClick={() => setShowHistory((current) => !current)}
                        className={`text-xs px-2 py-1 rounded transition-colors ${showHistory
                            ? 'bg-orange-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                    >
                        History
                    </button>
                    <button
                        onClick={() => setShowPreview(!showPreview)}
                        className={`text-xs px-2 py-1 rounded transition-colors ${showPreview
                            ? 'bg-orange-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                    >
                        Preview
                    </button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="text-xs px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded disabled:opacity-50 transition-colors"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
            {scopeHelpText && (
                <div className="px-4 py-2 border-b border-gray-800 bg-gray-950/60 text-[11px] text-gray-400">
                    {scopeHelpText}
                </div>
            )}

            {/* Editor + Preview */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 flex overflow-hidden">
                    <div className={showPreview ? 'w-1/2 border-r border-gray-700' : 'w-full'}>
                        <Editor
                            defaultLanguage="markdown"
                            value={content}
                            onChange={(v) => setContent(v ?? '')}
                            theme="vs-dark"
                            options={{
                                wordWrap: 'on',
                                minimap: { enabled: false },
                                fontSize: 14,
                                lineNumbers: 'off',
                                renderWhitespace: 'boundary',
                                scrollBeyondLastLine: false,
                            }}
                            onMount={(editor) => {
                                // Ctrl+S / Cmd+S — use ref so the binding always calls
                                // the latest save (avoids stale closure over `content`)
                                editor.addCommand(2048 | 49 /* CtrlCmd+S */, () => saveRef.current());
                            }}
                        />
                    </div>
                    {showPreview && (
                        <div className="w-1/2">
                            <MdPreview content={content} />
                        </div>
                    )}
                </div>
                {showHistory && (
                    <div className="h-64 border-t border-gray-800 bg-gray-950/60 flex overflow-hidden">
                        <div className="w-64 border-r border-gray-800 overflow-y-auto">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 text-[11px] uppercase tracking-widest text-gray-500">
                                <span>Revision History</span>
                                <span>{loadingRevisions ? 'Loading…' : `${revisions.length} saved`}</span>
                            </div>
                            {revisions.length === 0 ? (
                                <div className="px-3 py-4 text-xs text-gray-500">
                                    {loadingRevisions ? 'Loading revisions…' : 'No saved revisions yet.'}
                                </div>
                            ) : (
                                <ul className="p-2 space-y-1">
                                    {revisions.map((revision) => {
                                        const isSelected = selectedRevision?.id === revision.id;
                                        return (
                                            <li key={revision.id}>
                                                <button
                                                    onClick={() => setSelectedRevisionId(revision.id)}
                                                    className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${isSelected
                                                        ? 'border-orange-500/40 bg-orange-600/10 text-orange-100'
                                                        : 'border-gray-800 bg-gray-900/60 text-gray-300 hover:border-gray-700 hover:bg-gray-900'
                                                        }`}
                                                >
                                                    <div className="flex items-center justify-between gap-2 text-xs font-medium">
                                                        <span>Revision {revision.revision_number}</span>
                                                        {revision.author_source && (
                                                            <span className="text-[10px] uppercase tracking-wide text-gray-500">{revision.author_source}</span>
                                                        )}
                                                    </div>
                                                    <div className="mt-1 text-[11px] text-gray-500">
                                                        {new Date(revision.created_at).toLocaleString()}
                                                    </div>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                                <div>
                                    <div className="text-xs font-medium text-gray-200">
                                        {selectedRevision ? `Compare with revision ${selectedRevision.revision_number}` : 'Select a revision'}
                                    </div>
                                    {selectedRevision && (
                                        <div className="text-[11px] text-gray-500 mt-0.5">
                                            Restoring creates a new saved revision with the restored content.
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => void restoreRevision()}
                                    disabled={!selectedRevision || restoringRevision}
                                    className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50 transition-colors"
                                >
                                    {restoringRevision ? 'Restoring…' : 'Restore Revision'}
                                </button>
                            </div>
                            {selectedRevision ? (
                                <div className="flex-1 grid grid-cols-2 gap-px bg-gray-800 overflow-hidden">
                                    <div className="bg-gray-950/70 overflow-auto">
                                        <div className="px-3 py-2 border-b border-gray-800 text-[11px] uppercase tracking-widest text-gray-500">Current Draft</div>
                                        <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-words">{content}</pre>
                                    </div>
                                    <div className="bg-gray-950/70 overflow-auto">
                                        <div className="px-3 py-2 border-b border-gray-800 text-[11px] uppercase tracking-widest text-gray-500">Selected Revision</div>
                                        <pre className="p-3 text-xs text-gray-200 whitespace-pre-wrap break-words">{selectedRevision.content}</pre>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
                                    Select a saved revision to compare or restore it.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
