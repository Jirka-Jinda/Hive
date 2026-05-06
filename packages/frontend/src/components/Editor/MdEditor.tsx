import { useEffect, useState, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import MdPreview from './MdPreview';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';

export default function MdEditor() {
    const { selectedMdFile, setSelectedMdFile, setMdFiles, selectedRepo, selectedSession } = useAppStore();
    const [content, setContent] = useState('');
    const [draftType, setDraftType] = useState<'documentation' | 'skill' | 'tool' | 'instruction' | 'prompt' | 'other'>('other');
    const [draftScope, setDraftScope] = useState<'central' | 'repo' | 'session'>('central');
    const [saving, setSaving] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const save = useCallback(async () => {
        if (!selectedMdFile) return;
        const repoPath = draftScope === 'repo' ? selectedRepo?.path : undefined;
        const sessionId = draftScope === 'session' ? selectedSession?.id : undefined;
        if (draftScope === 'repo' && !repoPath) {
            setErrorMsg('Select a repository before moving this file to repo scope.');
            return;
        }
        if (draftScope === 'session' && (!selectedSession?.id || !selectedSession.worktree_path)) {
            setErrorMsg('Select a branch worktree session before moving this file to session scope.');
            return;
        }

        setSaving(true);
        try {
            setErrorMsg('');
            const saved = await api.mdfiles.update(selectedMdFile.id, {
                content,
                scope: draftScope,
                repoPath,
                sessionId,
                type: draftType,
            });
            const updated = { ...selectedMdFile, ...saved, content };
            const { selectedMdFile: currentSelectedMdFile, mdFiles: currentMdFiles } = useAppStore.getState();

            if (currentSelectedMdFile?.id === selectedMdFile.id) {
                setSelectedMdFile(updated);
            }

            setMdFiles(currentMdFiles.map((f) => (f.id === selectedMdFile.id ? { ...f, ...saved } : f)));
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }, [selectedMdFile, content, draftScope, draftType, selectedRepo?.path, selectedSession?.id, selectedSession?.worktree_path, setSelectedMdFile, setMdFiles]);

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
        setDraftScope(selectedMdFile?.scope ?? 'central');
        setErrorMsg('');
    }, [selectedMdFile?.id]);

    useEffect(() => {
        saveRef.current = save;
    }, [save]);

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
    const canSave =
        (draftScope !== 'repo' || Boolean(selectedRepo?.path)) &&
        (draftScope !== 'session' || Boolean(selectedSession?.worktree_path));

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
                        {draftScope === 'central'
                            ? 'central'
                            : draftScope === 'repo'
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
                        <span className="sr-only">MD file scope</span>
                        <select
                            aria-label="MD file scope"
                            value={draftScope}
                            onChange={(event) => setDraftScope(event.target.value as typeof draftScope)}
                            className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-500"
                        >
                            <option value="central">Central</option>
                            <option value="repo" disabled={!selectedRepo}>Repo</option>
                            <option value="session" disabled={!selectedSession?.worktree_path}>Session</option>
                        </select>
                    </label>
                    {errorMsg && <span className="text-xs text-red-400">{errorMsg}</span>}
                    {selectedSession?.worktree_path && selectedMdFile.scope !== 'session' && (
                        <button
                            onClick={duplicateToSession}
                            disabled={duplicating}
                            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50 transition-colors"
                        >
                            {duplicating ? 'Duplicating…' : 'Duplicate to Session'}
                        </button>
                    )}
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
                        disabled={saving || !canSave}
                        className="text-xs px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded disabled:opacity-50 transition-colors"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Editor + Preview */}
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
        </div>
    );
}
