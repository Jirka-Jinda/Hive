import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import type { Agent, Credential } from '../../api/client';
import { useModal } from '../../hooks/useModal';
import XCloseButton from '../ui/XCloseButton';

interface Props {
    onClose: () => void;
}

export default function CredentialsModal({ onClose }: Props) {
    const { credentials, setCredentials, agents } = useAppStore();
    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState('');
    const [agentType, setAgentType] = useState('');
    const [envVars, setEnvVars] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [confirmDeleteCredId, setConfirmDeleteCredId] = useState<number | null>(null);
    const [deletingCred, setDeletingCred] = useState(false);

    const currentAgent = agents.find((a: Agent) => a.id === agentType);
    const { overlayRef, handleOverlayClick } = useModal(onClose);

    const handleCreate = async () => {
        if (!name.trim() || !agentType) {
            setErrorMsg('Name and agent type are required');
            return;
        }
        setSaving(true);
        setErrorMsg('');
        try {
            const cred = await api.credentials.create({
                name: name.trim(),
                agentType,
                data: { envVars },
            });
            setCredentials([...credentials, cred]);
            setShowCreate(false);
            setName('');
            setAgentType('');
            setEnvVars({});
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to create credential');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        setDeletingCred(true);
        setErrorMsg('');
        try {
            await api.credentials.delete(id);
            setCredentials(credentials.filter((c: Credential) => c.id !== id));
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to delete credential');
        } finally {
            setDeletingCred(false);
            setConfirmDeleteCredId(null);
        }
    };

    return (
        <div ref={overlayRef} onClick={handleOverlayClick} className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl w-full max-w-lg mx-4 shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/80">
                    <h2 className="text-sm font-semibold text-gray-200">Credential Profiles</h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setShowCreate(!showCreate); setErrorMsg(''); }}
                            className={`inline-flex items-center gap-0.5 text-xs px-2.5 py-1 rounded border transition-all font-medium ${showCreate
                                ? 'bg-orange-600 border-orange-500 text-white'
                                : 'bg-gray-800 border-gray-700 text-orange-400 hover:bg-gray-750 hover:text-orange-300 hover:border-gray-600'
                                }`}
                        >
                            {showCreate ? '✕ Cancel' : '+ Add'}
                        </button>
                        <XCloseButton onClick={onClose} />
                    </div>
                </div>

                <div className="p-4 max-h-96 overflow-y-auto">
                    {!showCreate && errorMsg && (
                        <p className="mb-3 text-xs text-red-400">{errorMsg}</p>
                    )}

                    {showCreate && (
                        <div className="mb-4 p-3 bg-gray-800/80 border border-gray-700/60 rounded-lg space-y-2">
                            <input
                                className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md placeholder-gray-600 text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                                placeholder="Profile name (e.g. My Claude Key)"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                            <select
                                className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                                value={agentType}
                                onChange={(e) => {
                                    setAgentType(e.target.value);
                                    setEnvVars({});
                                }}
                            >
                                <option value="">Select agent type...</option>
                                {agents.map((a: Agent) => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>

                            {currentAgent?.credentialFields.map((field) => (
                                <div key={field.key}>
                                    <label className="text-xs text-gray-500 block mb-1 font-medium">{field.label}</label>
                                    <input
                                        type={field.secret ? 'password' : 'text'}
                                        className="w-full bg-gray-900 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md placeholder-gray-600 text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
                                        placeholder={field.key}
                                        value={envVars[field.key] ?? ''}
                                        onChange={(e) =>
                                            setEnvVars({ ...envVars, [field.key]: e.target.value })
                                        }
                                    />
                                </div>
                            ))}

                            {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}

                            <button
                                onClick={handleCreate}
                                disabled={saving}
                                className="w-full text-xs bg-orange-600 hover:bg-orange-500 border border-orange-500 text-white py-1.5 rounded-md font-medium shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving…' : 'Save Profile'}
                            </button>
                        </div>
                    )}

                    {credentials.length === 0 && !showCreate ? (
                        <p className="text-sm text-gray-500 italic text-center py-4">
                            No credential profiles yet. Click + Add to add one.
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {credentials.map((cred: Credential) => (
                                <li
                                    key={cred.id}
                                    className="flex items-center justify-between px-3 py-2 bg-gray-800 border border-gray-700/50 rounded-md text-sm"
                                >
                                    <div>
                                        <span className="text-gray-200 font-medium">{cred.name}</span>
                                        <span className="ml-2 text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">{cred.agent_type}</span>
                                    </div>
                                    {confirmDeleteCredId === cred.id ? (
                                        <div className="flex gap-1 shrink-0">
                                            <button
                                                onClick={() => void handleDelete(cred.id)}
                                                disabled={deletingCred}
                                                className="text-xs px-2.5 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white font-medium transition-all disabled:opacity-40"
                                            >
                                                {deletingCred ? '…' : 'Yes'}
                                            </button>
                                            <button
                                                onClick={() => setConfirmDeleteCredId(null)}
                                                className="text-xs px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-all"
                                            >
                                                No
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setConfirmDeleteCredId(cred.id)}
                                            className="inline-flex items-center text-xs px-2 py-1.5 rounded border bg-gray-900 border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-800/50 hover:bg-red-950/30 transition-all font-medium"
                                        >
                                            Delete
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}