import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import RepoList from '../Sidebar/RepoList';
import SessionList from '../Sidebar/SessionList';
import TerminalView from '../Terminal/TerminalView';
import MdEditor from '../Editor/MdEditor';
import MdFilePanel from '../Editor/MdFilePanel';
import CredentialsModal from './CredentialsModal';
import SettingsModal from './SettingsModal';

/** Drag-to-resize hook */
function useDragResize(initial: number, min: number, max: number, side: 'right' | 'left' = 'right') {
    const [width, setWidth] = useState(initial);
    const dragging = useRef(false);
    const startX = useRef(0);
    const startW = useRef(0);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        dragging.current = true;
        startX.current = e.clientX;
        startW.current = width;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    }, [width]);

    useEffect(() => {
        const move = (e: MouseEvent) => {
            if (!dragging.current) return;
            const delta = side === 'right' ? e.clientX - startX.current : startX.current - e.clientX;
            setWidth(Math.max(min, Math.min(max, startW.current + delta)));
        };
        const up = () => {
            if (!dragging.current) return;
            dragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    }, [min, max, side]);

    return { width, onMouseDown };
}

export default function AppShell() {
    const { setRepos, setAgents, setCredentials, setMdFiles, setSettings, activeView, selectedSession, selectedMdFile } = useAppStore();

    const [showCredentials, setShowCredentials] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const sidebar = useDragResize(260, 180, 520, 'right');
    const mdPanel = useDragResize(260, 160, 440, 'left');

    const syncBrowserFullscreen = useCallback(() => {
        setIsFullscreen(Boolean(document.fullscreenElement));
    }, []);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (window.electronAPI?.isDesktop) {
                const nextState = await window.electronAPI.toggleFullscreen();
                setIsFullscreen(nextState);
                return;
            }

            if (document.fullscreenElement) {
                await document.exitFullscreen();
                return;
            }

            await document.documentElement.requestFullscreen();
        } catch (error) {
            console.error('Failed to toggle fullscreen', error);
        }
    }, []);

    useEffect(() => {
        Promise.all([api.repos.list(), api.agents.list(), api.credentials.list(), api.mdfiles.list(), api.settings.get()])
            .then(([repos, agents, credentials, mdFiles, settings]) => {
                setRepos(repos); setAgents(agents); setCredentials(credentials); setMdFiles(mdFiles); setSettings(settings);
            })
            .catch(console.error);
    }, [setRepos, setAgents, setCredentials, setMdFiles, setSettings]);

    useEffect(() => {
        if (window.electronAPI?.isDesktop) {
            window.electronAPI.isFullscreen().then(setIsFullscreen).catch(console.error);
            return window.electronAPI.onFullscreenChange(setIsFullscreen);
        }

        syncBrowserFullscreen();
        document.addEventListener('fullscreenchange', syncBrowserFullscreen);
        return () => document.removeEventListener('fullscreenchange', syncBrowserFullscreen);
    }, [syncBrowserFullscreen]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'F11') return;
            event.preventDefault();
            void toggleFullscreen();
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleFullscreen]);

    // ── Shared button class strings ───────────────────────────────────────────
    const iconBtnBase = 'inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-all font-medium';
    const iconBtnDefault = `${iconBtnBase} bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600`;
    const panelHdrBtnCls = 'inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-all text-sm leading-none font-medium';
    const collapseTabCls = 'w-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors text-base flex-shrink-0 font-medium';

    return (
        <div className="flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
            <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 py-2.5 border-b border-gray-800/80 bg-gray-950/40 shrink-0">
                <div className="min-w-0">
                    <h1 className="truncate text-sm font-semibold text-gray-100 tracking-[0.08em] uppercase">
                        AI Workspace Manager
                    </h1>
                </div>

                <div className="flex items-center justify-center">
                    <div className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/90 px-3 py-1.5 shadow-sm shadow-black/20">
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setShowCredentials(true)}
                                title="Credential Profiles"
                                className={iconBtnDefault}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setShowSettings(true)}
                                title="App Settings"
                                className={iconBtnDefault}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                        </div>

                        <div className="w-px h-6 bg-gray-700/80" />

                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => void toggleFullscreen()}
                                title={isFullscreen ? 'Exit fullscreen (F11)' : 'Enter fullscreen (F11)'}
                                className={`${iconBtnBase} ${isFullscreen
                                    ? 'bg-emerald-600/90 border-emerald-500 text-white shadow-sm shadow-emerald-950/60'
                                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
                                    }`}
                            >
                                {isFullscreen ? (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9H5V5m10 4h4V5m-4 10h4v4m-10-4H5v4" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                <div />
            </header>

            <div className="flex flex-1 overflow-hidden min-w-0">
                {/* ── Left sidebar ── */}
                {!sidebarCollapsed ? (
                    <>
                        <aside
                            className="flex flex-col border-r border-gray-800/80 bg-gray-900 overflow-hidden flex-shrink-0"
                            style={{ width: sidebar.width }}
                        >
                            <header className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800/80 bg-gray-950/40 shrink-0">
                                <h2 className="text-[11px] font-bold text-indigo-400 tracking-[0.12em] uppercase">
                                    Workspace
                                </h2>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setSidebarCollapsed(true)}
                                        title="Collapse sidebar"
                                        className={panelHdrBtnCls}
                                    >
                                        ‹
                                    </button>
                                </div>
                            </header>
                            <div className="flex-1 flex flex-col overflow-y-auto">
                                <RepoList />
                                <SessionList />
                            </div>
                        </aside>
                        <div
                            onMouseDown={sidebar.onMouseDown}
                            className="w-1 cursor-col-resize bg-gray-800/60 hover:bg-indigo-500/60 active:bg-indigo-500 transition-colors flex-shrink-0"
                        />
                    </>
                ) : (
                    <button
                        onClick={() => setSidebarCollapsed(false)}
                        title="Expand sidebar"
                        className={`${collapseTabCls} border-r border-gray-800`}
                    >
                        ›
                    </button>
                )}

                {/* ── Main area ── */}
                <div className="flex-1 flex overflow-hidden min-w-0">
                    <div className="flex-1 flex overflow-hidden min-w-0">
                        {activeView === 'terminal' && selectedSession ? (
                            <TerminalView key={selectedSession.id} sessionId={selectedSession.id} />
                        ) : activeView === 'editor' && selectedMdFile ? (
                            <MdEditor />
                        ) : (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center space-y-3 select-none">
                                    <div className="w-12 h-12 mx-auto rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
                                        <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-gray-500">No active view</p>
                                        <p className="text-xs text-gray-600 mt-0.5">Select a session or open an .md file</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Right MD panel ── */}
                    {!rightPanelCollapsed ? (
                        <>
                            <div
                                onMouseDown={mdPanel.onMouseDown}
                                className="w-1 cursor-col-resize bg-gray-800/60 hover:bg-indigo-500/60 active:bg-indigo-500 transition-colors flex-shrink-0"
                            />
                            <div className="flex-shrink-0 overflow-hidden" style={{ width: mdPanel.width }}>
                                <MdFilePanel onCollapse={() => setRightPanelCollapsed(true)} />
                            </div>
                        </>
                    ) : (
                        <button
                            onClick={() => setRightPanelCollapsed(false)}
                            title="Expand docs panel"
                            className={`${collapseTabCls} border-l border-gray-800`}
                        >
                            ‹
                        </button>
                    )}
                </div>
            </div>

            {showCredentials && <CredentialsModal onClose={() => setShowCredentials(false)} />}
            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        </div>
    );
}
