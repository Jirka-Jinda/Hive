import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import PinSetup from '../Auth/PinSetup';

interface Props {
    onClose: () => void;
}

type AuthView = 'idle' | 'setup' | 'change';

export default function SettingsModal({ onClose }: Props) {
    const { settings, setSettings } = useAppStore();
    const [reposDir, setReposDir] = useState(settings?.reposDir ?? '');
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [saved, setSaved] = useState(false);
    const [authView, setAuthView] = useState<AuthView>('idle');
    const [authSaving, setAuthSaving] = useState(false);

    const authEnabled = settings?.auth?.enabled ?? false;

    const handleSave = async () => {
        if (!reposDir.trim()) return;
        setSaving(true);
        setErrorMsg('');
        setSaved(false);
        try {
            const updated = await api.settings.update({ reposDir: reposDir.trim() });
            setSettings(updated);
            setSaved(true);
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleAuth = async () => {
        if (!authEnabled) {
            // Enable: show PIN setup first
            setAuthView('setup');
        } else {
            // Disable immediately
            setAuthSaving(true);
            try {
                const updated = await api.settings.update({ auth: { enabled: false, pin: '' } });
                setSettings(updated);
            } catch { /* ignore */ }
            setAuthSaving(false);
        }
    };

    const handlePinConfirmed = async (pin: string) => {
        const encoded = btoa(pin);
        setAuthSaving(true);
        try {
            const updated = await api.settings.update({ auth: { enabled: true, pin: encoded } });
            setSettings(updated);
        } catch { /* ignore */ }
        setAuthSaving(false);
        setAuthView('idle');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl w-full max-w-md mx-4">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <span className="text-sm font-semibold text-gray-200">App Settings</span>
                    <button
                        onClick={onClose}
                        className="inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-600 transition-all text-xs font-medium"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-5">
                    {/* Repos dir */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            Repositories Folder
                        </label>
                        <input
                            className="w-full bg-gray-950 border border-gray-700 text-sm px-2.5 py-1.5 rounded-md text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all font-mono"
                            placeholder="C:\Code\Automation\repos"
                            value={reposDir}
                            onChange={(e) => { setReposDir(e.target.value); setSaved(false); }}
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                            spellCheck={false}
                        />
                        <p className="text-[11px] text-gray-600">
                            All repositories will be cloned into this folder. The local-path picker also reads from here.
                        </p>
                    </div>

                    {/* Auth section */}
                    <div className="space-y-3 pt-1 border-t border-gray-800">
                        <div className="flex items-center justify-between pt-3">
                            <div>
                                <p className="text-xs font-semibold text-gray-300">PIN Lock</p>
                                <p className="text-[11px] text-gray-600 mt-0.5">Require a 4-digit PIN on launch.</p>
                            </div>
                            <button
                                onClick={handleToggleAuth}
                                disabled={authSaving}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${authEnabled ? 'bg-amber-500' : 'bg-gray-700'}`}
                            >
                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${authEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                        </div>

                        {authEnabled && authView === 'idle' && (
                            <button
                                onClick={() => setAuthView('change')}
                                className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-amber-400 hover:border-amber-500/40 font-medium transition-all"
                            >
                                Change PIN
                            </button>
                        )}

                        {(authView === 'setup' || authView === 'change') && (
                            <div className="bg-gray-950 border border-gray-700/60 rounded-lg p-4">
                                <PinSetup
                                    title={authView === 'change' ? 'New PIN' : 'Set a PIN'}
                                    description={authView === 'change' ? 'Enter a new 4-digit PIN.' : 'Choose a 4-digit PIN to protect Hive.'}
                                    onConfirm={handlePinConfirmed}
                                    onCancel={() => setAuthView('idle')}
                                />
                            </div>
                        )}
                    </div>

                    {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
                    {saved && <p className="text-xs text-green-500">Settings saved.</p>}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-800">
                    <button
                        onClick={onClose}
                        className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 font-medium transition-all"
                    >
                        Close
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !reposDir.trim()}
                        className="text-xs px-4 py-1.5 rounded border border-indigo-500 bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
