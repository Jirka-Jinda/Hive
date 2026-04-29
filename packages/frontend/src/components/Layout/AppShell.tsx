import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { api } from '../../api/client';
import RepoList from '../Sidebar/RepoList';
import SessionList from '../Sidebar/SessionList';
import TerminalView from '../Terminal/TerminalView';
import ShellTerminal from '../Terminal/ShellTerminal';
import MdEditor from '../Editor/MdEditor';
import MdFilePanel from '../Editor/MdFilePanel';
import CredentialsModal from './CredentialsModal';
import SettingsModal from './SettingsModal';
import PipelineModal from './PipelineModal';
import UsageModal from './UsageModal';
import InstallToolsModal from './InstallToolsModal';
import GitHistoryModal from './GitHistoryModal';
import LogsModal from './LogsModal';
import PromptPanel from '../Prompt/PromptPanel';
import AutomationModal from '../Automation/AutomationModal';
import { ToastContainer } from './ToastContainer';
import { useNotifications } from '../../hooks/useNotifications';
import { useDragResize } from '../../hooks/useDragResize';
import { useTokenUsage } from '../../hooks/useTokenUsage';

export default function AppShell() {
    const { repos, selectedRepo, setRepos, setAgents, setCredentials, setMdFiles, setSettings, activeView, setActiveView, selectedSession, selectedMdFile, sessions, sessionTerminalVersions, setSelectedSession, settings, lock } = useAppStore();

    useNotifications();

    const [showCredentials, setShowCredentials] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showPipeline, setShowPipeline] = useState(false);
    const [showInstallTools, setShowInstallTools] = useState(false);
    const [toolsAnyMissing, setToolsAnyMissing] = useState(false);
    const [showPrompts, setShowPrompts] = useState(false);
    const [showAutomation, setShowAutomation] = useState(false);
    const [showUsage, setShowUsage] = useState(false);
    const [showGitHistory, setShowGitHistory] = useState(false);
    const [showLogs, setShowLogs] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const sidebar = useDragResize(320, 180, 560, 'right');
    const mdPanel = useDragResize(320, 160, 520, 'left');
    const {
        summary: usageSummary,
        loading: usageLoading,
        error: usageError,
        tokenUsageEnabled,
        refreshUsage: loadUsage,
        syncTokenUsageEnabled,
    } = useTokenUsage(selectedRepo?.id);
    const activeSessionRepo = selectedSession
        ? repos.find((repo) => repo.id === selectedSession.repo_id) ?? null
        : null;
    const gitContextRepo = selectedSession ? activeSessionRepo ?? selectedRepo : selectedRepo;
    const openInVsCodeTargetPath = selectedSession?.worktree_path ?? gitContextRepo?.path ?? null;
    const canOpenTargetInVsCode = Boolean(openInVsCodeTargetPath && window.electronAPI?.isDesktop);
    const canShowGitHistory = Boolean(gitContextRepo?.is_git_repo);

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

    const openSelectedContextInVsCode = useCallback(async () => {
        if (!openInVsCodeTargetPath || !window.electronAPI?.openInVsCode) return;

        try {
            await window.electronAPI.openInVsCode(openInVsCodeTargetPath);
        } catch (error) {
            console.error('Failed to open repository in VS Code', error);
        }
    }, [openInVsCodeTargetPath]);

    const formatTokenUsage = useCallback((value: number) => {
        return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);
    }, []);

    useEffect(() => {
        Promise.all([api.repos.list(), api.agents.list(), api.credentials.list(), api.mdfiles.list(), api.settings.get()])
            .then(([repos, agents, credentials, mdFiles, settings]) => {
                setRepos(repos); setAgents(agents); setCredentials(credentials); setSettings(settings);
                // Only load files belonging to the currently selected repo to prevent cross-repo pollution
                const currentRepoId = useAppStore.getState().selectedRepo?.id ?? null;
                setMdFiles(mdFiles.filter((f) => f.scope === 'central' || (currentRepoId !== null && f.repo_id === currentRepoId)));
            })
            .catch(console.error);
        api.tools.status().then((r) => setToolsAnyMissing(r.anyMissing)).catch(() => { });
    }, [setRepos, setAgents, setCredentials, setMdFiles, setSettings]);

    useEffect(() => {
        if (!tokenUsageEnabled) {
            setShowUsage(false);
        }
    }, [tokenUsageEnabled]);

    useEffect(() => {
        if (!canShowGitHistory) {
            setShowGitHistory(false);
        }
    }, [canShowGitHistory]);

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
            if (event.key === 'F11') {
                event.preventDefault();
                void toggleFullscreen();
                return;
            }
            // Ctrl+Shift+Tab — cycle to next idle session
            if (event.key === 'Tab' && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                const idleSessions = sessions.filter((s) => s.state === 'idle');
                if (idleSessions.length > 0) {
                    const currentIdx = idleSessions.findIndex((s) => s.id === selectedSession?.id);
                    const next = idleSessions[(currentIdx + 1) % idleSessions.length];
                    setSelectedSession(next);
                    setActiveView('terminal');
                }
                return;
            }
            // Ctrl+` cycles between terminal and editor (Ctrl+` won't be captured by xterm)
            if (event.key === '`' && event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                if (activeView === 'terminal' && selectedMdFile) {
                    setActiveView('editor');
                } else if (activeView === 'editor') {
                    setActiveView('terminal');
                }
            }
            // Ctrl+1 — Run template, Ctrl+2 — Automation tasks, Ctrl+L — Lock
            if (event.key === '1' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                event.preventDefault();
                setShowPrompts(true);
                return;
            }
            if (event.key === '2' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                event.preventDefault();
                setShowAutomation(true);
                return;
            }
            if (event.key === 'l' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                if (settings?.auth?.enabled) {
                    event.preventDefault();
                    lock();
                }
                return;
            }
            // Ctrl+3 — Git history, Ctrl+4 — Open in VS Code
            if (event.key === '3' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                if (canShowGitHistory) {
                    event.preventDefault();
                    setShowGitHistory(true);
                }
                return;
            }
            if (event.key === '4' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                if (canOpenTargetInVsCode) {
                    event.preventDefault();
                    void openSelectedContextInVsCode();
                }
                return;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleFullscreen, activeView, selectedMdFile, setActiveView, sessions, selectedSession, setSelectedSession, settings, lock, canShowGitHistory, setShowGitHistory, canOpenTargetInVsCode, openSelectedContextInVsCode]);

    // ── Shared button class strings ───────────────────────────────────────────
    const iconBtnBase = 'inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-all font-medium';
    const iconBtnDefault = `${iconBtnBase} bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600`;
    const toolbarBoxCls = 'flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/90 px-3 py-1.5 shadow-sm shadow-black/20';
    const panelHdrBtnCls = 'inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-all text-sm leading-none font-medium';
    const collapseTabCls = 'w-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors text-base flex-shrink-0 font-medium';

    return (
        <div className="flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
            <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 py-2.5 border-b border-gray-800/80 bg-gray-950/40 shrink-0">
                <div className="min-w-0" />
                <div className="flex items-center justify-center">
                    <div className={toolbarBoxCls}>
                        {/* ── View toggle: Terminal / Editor ── */}
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setActiveView('terminal')}
                                title="Terminal view (Ctrl+`)"
                                className={`${iconBtnBase} ${activeView === 'terminal'
                                    ? 'bg-orange-600/10 border-orange-500/40 text-orange-200 shadow-[0_0_12px_rgba(234,88,12,0.25)]'
                                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
                                    }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </button>
                            <button
                                onClick={() => { if (selectedMdFile) setActiveView('editor'); }}
                                title={selectedMdFile ? 'Editor view (Ctrl+`)' : 'Open an MD file to use editor view'}
                                className={`${iconBtnBase} ${activeView === 'editor'
                                    ? 'bg-orange-600/10 border-orange-500/40 text-orange-200 shadow-[0_0_12px_rgba(234,88,12,0.25)]'
                                    : selectedMdFile
                                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
                                        : 'bg-gray-800 border-gray-700 text-gray-500 opacity-40 cursor-not-allowed'
                                    }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                        </div>

                        <div className="w-px h-6 bg-gray-700/80" />

                        {/* ── Actions: Run template / Automation / VS Code ── */}
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setShowPrompts(true)}
                                title="Run template (Ctrl+1)"
                                className={iconBtnDefault}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setShowAutomation(true)}
                                title="Automation tasks (Ctrl+2)"
                                className={iconBtnDefault}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setShowGitHistory(true)}
                                title={canShowGitHistory
                                    ? selectedSession
                                        ? `Git history for ${selectedSession.name} (Ctrl+3)`
                                        : `Git history for ${gitContextRepo?.name} (Ctrl+3)`
                                    : 'Select a git repository to view history'}
                                className={`${iconBtnBase} ${canShowGitHistory
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
                                    : 'bg-gray-800 border-gray-700 text-gray-500 opacity-40 cursor-not-allowed'
                                    }`}
                                disabled={!canShowGitHistory}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <circle cx="6.5" cy="6.5" r="2.25" />
                                    <circle cx="6.5" cy="17.5" r="2.25" />
                                    <circle cx="17.5" cy="12" r="2.25" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 6.5h4a3 3 0 013 3v0M8.5 17.5h4a3 3 0 003-3v0" />
                                </svg>
                            </button>
                            {canOpenTargetInVsCode && gitContextRepo && (
                                <button
                                    onClick={() => void openSelectedContextInVsCode()}
                                    title={selectedSession
                                        ? `Open ${selectedSession.name} worktree in VS Code (Ctrl+4)`
                                        : `Open ${gitContextRepo.name} in VS Code (Ctrl+4)`}
                                    className={iconBtnDefault}
                                >
                                    <img src="/visual-studio.png" alt="" className="w-4 h-4 object-contain" />
                                </button>
                            )}
                        </div>

                        <div className="w-px h-6 bg-gray-700/80" />

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
                            {/* CLI Tools install button — amber badge when tools are missing */}
                            <button
                                onClick={() => setShowInstallTools(true)}
                                title={toolsAnyMissing ? 'CLI tools missing — click to install' : 'CLI Agent Tools'}
                                className={`${iconBtnBase} relative ${toolsAnyMissing
                                    ? 'bg-amber-600/20 border-amber-500/60 text-amber-400 hover:bg-amber-600/30 hover:border-amber-400'
                                    : iconBtnDefault.replace(`${iconBtnBase} `, '')
                                    }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                                </svg>
                                {toolsAnyMissing && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" />
                                )}
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
                            <button
                                onClick={() => setShowPipeline(true)}
                                title="Prompt Pipeline"
                                className={iconBtnDefault}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setShowLogs(true)}
                                title="Application Logs"
                                className={iconBtnDefault}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                            </button>
                        </div>

                        <div className="w-px h-6 bg-gray-700/80" />

                        <div className="flex items-center gap-1">
                            {settings?.auth?.enabled && (
                                <button
                                    onClick={lock}
                                    title="Lock (Ctrl+L)"
                                    className={iconBtnDefault}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                </button>
                            )}
                            <button
                                onClick={() => void toggleFullscreen()}
                                title={isFullscreen ? 'Exit fullscreen (F11)' : 'Enter fullscreen (F11)'}
                                className={`${iconBtnBase} ${isFullscreen
                                    ? 'bg-orange-600/10 border-orange-500/40 text-orange-200 shadow-[0_0_12px_rgba(234,88,12,0.25)]'
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

                <div className="min-w-0 flex items-center justify-end">
                    {tokenUsageEnabled && (
                        <div className={toolbarBoxCls}>
                            <button
                                onClick={() => { setShowUsage(true); void loadUsage(); }}
                                title={selectedRepo ? `Token usage for ${selectedRepo.name}` : 'Token usage across all repositories'}
                                className="inline-flex items-center gap-2 group"
                            >
                                <span
                                    className={`${iconBtnBase} ${showUsage
                                        ? 'bg-orange-600/90 border-orange-500 text-white shadow-sm shadow-orange-950/60'
                                        : 'bg-gray-800 border-gray-700 text-gray-300 group-hover:bg-gray-750 group-hover:text-white group-hover:border-gray-600'
                                        }`}
                                >
                                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 19h16M7 15l3-3 2 2 5-6" />
                                    </svg>
                                </span>
                                <span className="text-sm font-semibold text-gray-200 tabular-nums group-hover:text-white transition-colors">
                                    {usageLoading ? '…' : formatTokenUsage(usageSummary?.totals.total_tokens ?? 0)}
                                </span>
                            </button>
                        </div>
                    )}
                </div>
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
                                <h2 className="text-[11px] font-bold text-orange-400 tracking-[0.12em] uppercase">
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
                            className="w-1 cursor-col-resize bg-gray-800/60 hover:bg-orange-500/60 active:bg-orange-500 transition-colors flex-shrink-0"
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
                        {/* Shell terminal — always mounted to keep PTY alive; hidden when a session or editor is active */}
                        <ShellTerminal hidden={activeView !== 'terminal' || selectedSession !== null} />

                        {/* Session terminal — overlays the shell when a session is selected */}
                        {activeView === 'terminal' && selectedSession && (
                            <TerminalView key={`${selectedSession.id}:${sessionTerminalVersions[selectedSession.id] ?? 0}`} sessionId={selectedSession.id} />
                        )}

                        {/* MD editor — shown only when editor view and a file is open */}
                        {activeView === 'editor' && selectedMdFile && (
                            <MdEditor />
                        )}
                    </div>

                    {/* ── Right MD panel ── */}
                    {!rightPanelCollapsed ? (
                        <>
                            <div
                                onMouseDown={mdPanel.onMouseDown}
                                className="w-1 cursor-col-resize bg-gray-800/60 hover:bg-orange-500/60 active:bg-orange-500 transition-colors flex-shrink-0"
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
            {showPipeline && <PipelineModal onClose={() => setShowPipeline(false)} onNodesChanged={syncTokenUsageEnabled} />}
            {showUsage && (
                <UsageModal
                    repoName={selectedRepo?.name ?? null}
                    summary={usageSummary}
                    loading={usageLoading}
                    error={usageError}
                    onRefresh={() => { void loadUsage(); }}
                    onClose={() => setShowUsage(false)}
                />
            )}
            {showInstallTools && (
                <InstallToolsModal onClose={() => { setShowInstallTools(false); api.tools.status().then((r) => setToolsAnyMissing(r.anyMissing)).catch(() => { }); }} />
            )}
            {showGitHistory && gitContextRepo && gitContextRepo.is_git_repo && (
                <GitHistoryModal
                    repo={gitContextRepo}
                    session={selectedSession}
                    onClose={() => setShowGitHistory(false)}
                />
            )}
            {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}
            {showPrompts && <PromptPanel onClose={() => setShowPrompts(false)} />}
            {showAutomation && <AutomationModal onClose={() => setShowAutomation(false)} />}
            <ToastContainer />
        </div>
    );
}
