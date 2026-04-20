import { useEffect, useState, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import MdPreview from './MdPreview';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';

export default function MdEditor() {
    const { selectedMdFile, setSelectedMdFile, mdFiles, setMdFiles } = useAppStore();
    const [content, setContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const save = useCallback(async () => {
        if (!selectedMdFile) return;
        setSaving(true);
        try {
            setErrorMsg('');
            await api.mdfiles.update(selectedMdFile.id, content);
            const updated = { ...selectedMdFile, content };
            setSelectedMdFile(updated);
            setMdFiles(mdFiles.map((f) => (f.id === selectedMdFile.id ? updated : f)));
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    }, [selectedMdFile, content, mdFiles, setSelectedMdFile, setMdFiles]);

    // Keep a stable ref so the Monaco keybinding and auto-save always call the latest save
    const saveRef = useRef(save);
    useEffect(() => { saveRef.current = save; }, [save]);

    const prevFileId = useRef<number | undefined>(undefined);

    // Auto-save when switching to a different file
    useEffect(() => {
        const prev = prevFileId.current;
        prevFileId.current = selectedMdFile?.id;
        if (prev !== undefined && prev !== selectedMdFile?.id) {
            void saveRef.current();
        }
        setContent(selectedMdFile?.content ?? '');
    }, [selectedMdFile?.id]);

    if (!selectedMdFile) return null;

    const filename = selectedMdFile.path.split(/[/\\]/).pop() ?? 'file.md';
    const typeBadgeColors: Record<string, string> = {
        skill: 'bg-purple-900 text-purple-300',
        tool: 'bg-blue-900 text-blue-300',
        instruction: 'bg-green-900 text-green-300',
        other: 'bg-gray-700 text-gray-400',
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0 bg-gray-900">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-200 truncate">{filename}</span>
                    <span
                        className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadgeColors[selectedMdFile.type] ?? typeBadgeColors.other
                            }`}
                    >
                        {selectedMdFile.type}
                    </span>
                    <span className="text-xs text-gray-600">
                        {selectedMdFile.scope === 'central' ? 'central' : 'repo'}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {errorMsg && <span className="text-xs text-red-400">{errorMsg}</span>}
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
