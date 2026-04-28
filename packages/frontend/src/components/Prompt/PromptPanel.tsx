import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { MdFile, ParamDef } from '../../api/client';
import XCloseButton from '../ui/XCloseButton';

interface Props {
    onClose: () => void;
}

interface ParamValues {
    [key: string]: string;
}

export default function PromptPanel({ onClose }: Props) {
    const { mdFiles, repos, sessions, selectedRepo, selectedSession } = useAppStore();
    const promptFiles = mdFiles.filter((f) => f.type === 'prompt' && f.scope === 'central');

    const [selectedFile, setSelectedFile] = useState<MdFile | null>(null);
    const [params, setParams] = useState<ParamDef[]>([]);
    const [paramName, setParamName] = useState('');
    const [values, setValues] = useState<ParamValues>({});
    const [running, setRunning] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (!selectedFile) return;
        setError('');
        setSuccess('');
        api.mdfiles.params(selectedFile.id).then((data) => {
            setParamName(data.name || selectedFile.path);
            setParams(data.params ?? []);
            // Pre-fill repo + session params from current selection
            const initial: ParamValues = {};
            for (const p of data.params ?? []) {
                if (p.type === 'repo' && selectedRepo) {
                    initial[p.name] = selectedRepo.path;
                } else if (p.type === 'session' && selectedSession) {
                    initial[p.name] = selectedSession.name;
                } else if (p.default !== undefined) {
                    initial[p.name] = p.default;
                } else {
                    initial[p.name] = '';
                }
            }
            setValues(initial);
        }).catch((e: Error) => setError(e.message));
    }, [selectedFile, selectedRepo, selectedSession]);

    const handleRun = async () => {
        if (!selectedFile) return;
        if (!selectedSession) { setError('No active session selected.'); return; }
        const targetRepo = repos.find((r) => r.id === selectedSession.repo_id);
        if (!targetRepo) { setError('Cannot find repo for selected session.'); return; }

        setRunning(true);
        setError('');
        setSuccess('');
        try {
            const { rendered } = await api.mdfiles.render(selectedFile.id, values);
            await api.repos.sessions.inject(targetRepo.id, selectedSession.id, rendered + '\n');
            setSuccess('Prompt sent to session.');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-[820px] max-h-[80vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <h2 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Prompt Templates
                    </h2>
                    <XCloseButton onClick={onClose} />
                </div>

                <div className="flex flex-1 overflow-hidden min-h-0">
                    {/* Template list */}
                    <div className="w-44 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
                        {promptFiles.length === 0 ? (
                            <p className="px-3 py-4 text-xs text-gray-500">
                                No prompt templates found.<br />
                                Create a central MD file with type "Prompt Template".
                            </p>
                        ) : (
                            <ul className="py-1">
                                {promptFiles.map((f) => (
                                    <li key={f.id}>
                                        <button
                                            onClick={() => setSelectedFile(f)}
                                            className={`w-full text-left px-3 py-2 text-xs truncate transition-colors ${selectedFile?.id === f.id
                                                ? 'bg-orange-600/30 text-orange-200 border-r-2 border-orange-500'
                                                : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                                                }`}
                                        >
                                            {f.path}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Params form */}
                    <div className="flex-1 flex flex-col overflow-y-auto px-4 py-3 gap-3 min-w-0">
                        {!selectedFile ? (
                            <p className="text-xs text-gray-500 mt-2">Select a template on the left.</p>
                        ) : (
                            <>
                                <p className="text-sm font-medium text-gray-200">{paramName}</p>

                                {params.length === 0 && (
                                    <p className="text-xs text-gray-500">No parameters — template will be sent as-is.</p>
                                )}

                                {params.map((p) => (
                                    <div key={p.name} className="flex flex-col gap-1">
                                        <label className="text-xs text-gray-400 font-medium">
                                            {p.name}
                                            {p.description && (
                                                <span className="ml-1 text-gray-500 font-normal">— {p.description}</span>
                                            )}
                                        </label>

                                        {p.type === 'repo' ? (
                                            <select
                                                value={values[p.name] ?? ''}
                                                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-orange-500"
                                            >
                                                <option value="">— select repo —</option>
                                                {repos.map((r) => (
                                                    <option key={r.id} value={r.path}>{r.name}</option>
                                                ))}
                                            </select>
                                        ) : p.type === 'session' ? (
                                            <select
                                                value={values[p.name] ?? ''}
                                                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-orange-500"
                                            >
                                                <option value="">— select session —</option>
                                                {sessions.map((s) => (
                                                    <option key={s.id} value={s.name}>{s.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={values[p.name] ?? ''}
                                                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                                                placeholder={p.default ?? ''}
                                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-orange-500"
                                            />
                                        )}
                                    </div>
                                ))}

                                {error && <p className="text-xs text-red-400">{error}</p>}
                                {success && <p className="text-xs text-emerald-400">{success}</p>}
                            </>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                    <p className="text-xs text-gray-500">
                        {selectedSession
                            ? `→ ${selectedSession.name}`
                            : 'No active session'}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => void handleRun()}
                            disabled={!selectedFile || !selectedSession || running}
                            className="px-3 py-1.5 text-xs rounded bg-orange-600 text-white hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {running ? 'Sending…' : 'Run →'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
