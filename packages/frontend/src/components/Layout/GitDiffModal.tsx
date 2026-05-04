import { useEffect, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { api } from '../../api/client';
import type { GitChangedFile, GitChangeStatus, Repo, Session } from '../../api/client';

interface Props {
    repo: Repo;
    session: Session | null;
}

function statusLabel(status: GitChangeStatus): { text: string; cls: string } {
    switch (status) {
        case 'A': return { text: 'Added', cls: 'bg-green-900/60 text-green-300 border-green-700/40' };
        case 'D': return { text: 'Deleted', cls: 'bg-red-900/60 text-red-300 border-red-700/40' };
        case 'R': return { text: 'Renamed', cls: 'bg-blue-900/60 text-blue-300 border-blue-700/40' };
        case '?': return { text: 'Untracked', cls: 'bg-gray-700/60 text-gray-300 border-gray-600/40' };
        default:  return { text: 'Modified', cls: 'bg-orange-900/60 text-orange-300 border-orange-700/40' };
    }
}

function inferLanguage(filePath: string): string | undefined {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript',
        js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
        py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
        cs: 'csharp', java: 'java', kt: 'kotlin', swift: 'swift',
        c: 'c', cpp: 'cpp', h: 'cpp',
        json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
        md: 'markdown', html: 'html', css: 'css', scss: 'scss',
        sh: 'shell', ps1: 'powershell', bat: 'bat',
        sql: 'sql', xml: 'xml', dockerfile: 'dockerfile',
    };
    return ext ? map[ext] : undefined;
}

export default function GitDiffView({ repo, session }: Props) {
    const [files, setFiles] = useState<GitChangedFile[]>([]);
    const [loadingFiles, setLoadingFiles] = useState(true);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [diff, setDiff] = useState<{ original: string; modified: string } | null>(null);
    const [loadingDiff, setLoadingDiff] = useState(false);
    const [filesError, setFilesError] = useState('');
    const [diffError, setDiffError] = useState('');
    const sessionId = session?.id;

    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoadingFiles(true);
        setFilesError('');
        setSelectedFile(null);
        setDiff(null);
        api.repos.git.changedFiles(repo.id, sessionId)
            .then((result) => {
                if (cancelled) return;
                setFiles(result);
                setSelectedFile(result[0]?.path ?? null);
            })
            .catch((e: unknown) => {
                if (!cancelled) setFilesError(e instanceof Error ? e.message : 'Failed to load changed files');
            })
            .finally(() => {
                if (!cancelled) setLoadingFiles(false);
            });

        return () => {
            cancelled = true;
        };
    }, [repo.id, sessionId]);

    useEffect(() => {
        if (!selectedFile) { setDiff(null); return; }

        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        setLoadingDiff(true);
        setDiffError('');
        setDiff(null);

        api.repos.git.diff(repo.id, selectedFile, sessionId)
            .then((result) => {
                if (ctrl.signal.aborted) return;
                setDiff({ original: result.original, modified: result.modified });
            })
            .catch((e: unknown) => {
                if (ctrl.signal.aborted) return;
                setDiffError(e instanceof Error ? e.message : 'Failed to load diff');
            })
            .finally(() => {
                if (!ctrl.signal.aborted) setLoadingDiff(false);
            });

        return () => ctrl.abort();
    }, [repo.id, selectedFile, sessionId]);

    const selectedStatus = files.find((f) => f.path === selectedFile)?.status ?? 'M';
    const badge = statusLabel(selectedStatus);
    const language = selectedFile ? inferLanguage(selectedFile) : undefined;
    const scopeLabel = session ? `Session worktree • ${session.name}` : `Repo root • ${repo.name}`;

    return (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-gray-900">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0 bg-gray-900">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <h2 className="text-sm font-semibold text-gray-200 shrink-0">Changed Files</h2>
                        {selectedFile && (
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badge.cls}`}>
                                {badge.text}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 truncate text-[11px] text-gray-500">{scopeLabel}</p>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                <div className="w-64 shrink-0 border-r border-gray-800 overflow-y-auto bg-gray-950/40">
                    {loadingFiles ? (
                        <div className="px-3 py-4 text-xs text-gray-500">Loading…</div>
                    ) : filesError ? (
                        <div className="px-3 py-4 text-xs text-red-400">{filesError}</div>
                    ) : files.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-gray-500">No changes detected.</div>
                    ) : (
                        <ul className="py-1">
                            {files.map((f) => {
                                const fb = statusLabel(f.status);
                                const name = f.path.split('/').pop() ?? f.path;
                                const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
                                return (
                                    <li key={f.path}>
                                        <button
                                            onClick={() => setSelectedFile(f.path)}
                                            className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                                                selectedFile === f.path
                                                    ? 'bg-orange-600/15 border-l-2 border-orange-500'
                                                    : 'hover:bg-gray-800/60 border-l-2 border-transparent'
                                            }`}
                                        >
                                            <span className={`mt-px shrink-0 inline-flex items-center rounded border px-1 py-px text-[9px] font-bold leading-none ${fb.cls}`}>
                                                {f.status}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-xs text-gray-200 truncate">{name}</span>
                                                {dir && <span className="block text-[10px] text-gray-600 truncate">{dir}</span>}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    {selectedFile && (
                        <div className="px-3 py-1.5 border-b border-gray-800 bg-gray-950/40 shrink-0">
                            <span className="font-mono text-xs text-gray-400 truncate">{selectedFile}</span>
                        </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                        {!selectedFile ? (
                            <div className="flex h-full items-center justify-center text-xs text-gray-600">
                                Select a file to view its diff
                            </div>
                        ) : loadingDiff ? (
                            <div className="flex h-full items-center justify-center text-xs text-gray-500">
                                Loading diff…
                            </div>
                        ) : diffError ? (
                            <div className="flex h-full items-center justify-center text-xs text-red-400">
                                {diffError}
                            </div>
                        ) : diff ? (
                            <DiffEditor
                                key={`${repo.id}:${sessionId ?? 'root'}:${selectedFile}`}
                                original={diff.original}
                                modified={diff.modified}
                                language={language}
                                theme="vs-dark"
                                options={{
                                    readOnly: true,
                                    renderSideBySide: true,
                                    fontSize: 12,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    wordWrap: 'off',
                                    renderOverviewRuler: false,
                                    originalEditable: false,
                                }}
                            />
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
