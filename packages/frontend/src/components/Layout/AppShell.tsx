import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useAppStore, type ActiveView } from '../../store/appStore';
import { api, type ChangeEvent } from '../../api/client';
import RepoList from '../Sidebar/RepoList';
import SessionList from '../Sidebar/SessionList';
import TerminalView from '../Terminal/TerminalView';
import ShellTerminal from '../Terminal/ShellTerminal';
import MdEditor from '../Editor/MdEditor';
import MdFilePanel from '../Editor/MdFilePanel';
import GitDiffView from './GitDiffModal';
import PromptPanel from '../Prompt/PromptPanel';
import { ToastContainer } from './ToastContainer';
import { useNotifications } from '../../hooks/useNotifications';
import { useDragResize } from '../../hooks/useDragResize';
import { useTokenUsage } from '../../hooks/useTokenUsage';

const CredentialsModal = lazy(() => import('./CredentialsModal'));
const SettingsModal = lazy(() => import('./SettingsModal'));
const PipelineModal = lazy(() => import('./PipelineModal'));
const UsageModal = lazy(() => import('./UsageModal'));
const InstallToolsModal = lazy(() => import('./InstallToolsModal'));
const GitHistoryModal = lazy(() => import('./GitHistoryModal'));
const LogsModal = lazy(() => import('./LogsModal'));
const LogSearchModal = lazy(() => import('./LogSearchModal'));
const AutomationModal = lazy(() => import('../Automation/AutomationModal'));
const ChangesModal = lazy(() => import('./ChangesModal'));

export default function AppShell() {
    const { repos, selectedRepo, setRepos, setSelectedRepo, setAgents, setCredentials, setMdFiles, setSelectedMdFile, setSettings, activeView, setActiveView, activeDiffTarget, setActiveDiffTarget, selectedSession, selectedMdFile, sessions, sessionTerminalVersions, setSessions, setSelectedSession, settings, lock, backendReadiness, backendConnectionState, setBackendReadiness, setBackendConnectionState } = useAppStore();

    useNotifications();

    const [showCredentials, setShowCredentials] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showPipeline, setShowPipeline] = useState(false);
    const [showInstallTools, setShowInstallTools] = useState(false);
    const [toolsAnyMissing, setToolsAnyMissing] = useState(false);
    const [showPrompts, setShowPrompts] = useState(false);
    const [showAutomation, setShowAutomation] = useState(false);
    const [showChanges, setShowChanges] = useState(false);
    const [showUsage, setShowUsage] = useState(false);
    const [showGitHistory, setShowGitHistory] = useState(false);
    const [showLogs, setShowLogs] = useState(false);
    const [showLogSearch, setShowLogSearch] = useState(false);
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
    const activeDiffRepo = activeDiffTarget
        ? repos.find((repo) => repo.id === activeDiffTarget.repoId) ?? (selectedRepo?.id === activeDiffTarget.repoId ? selectedRepo : null)
        : null;
    const activeDiffSession = activeDiffTarget
        ? sessions.find((session) => session.id === activeDiffTarget.sessionId && session.repo_id === activeDiffTarget.repoId) ?? null
        : null;
    const canShowDiffView = Boolean(activeDiffRepo?.is_git_repo && activeDiffSession);

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

    const openChangeEvent = useCallback(async (event: ChangeEvent) => {
        if (event.event_type.startsWith('automation')) {
            setShowChanges(false);
            setShowAutomation(true);
            return;
        }

        if (event.repo_id !== null) {
            const targetRepo = repos.find((repo) => repo.id === event.repo_id) ?? null;
            if (targetRepo) {
                setSelectedRepo(targetRepo);

                const [centralFiles, repoFiles, repoSessions] = await Promise.all([
                    api.mdfiles.list('central'),
                    api.mdfiles.list('repo', targetRepo.id),
                    api.repos.sessions.list(targetRepo.id, { includeArchived: true }),
                ]);

                let nextFiles = [...centralFiles, ...repoFiles];
                setSessions(repoSessions);

                if (event.session_id !== null) {
                    const targetSession = repoSessions.find((session) => session.id === event.session_id) ?? null;
                    setSelectedSession(targetSession);
                    if (targetSession) {
                        const sessionFiles = await api.mdfiles.list('session', undefined, targetSession.id);
                        nextFiles = [...nextFiles, ...sessionFiles];
                    }
                } else {
                    setSelectedSession(null);
                }

                setMdFiles(nextFiles);
            }
        }

        if (event.md_file_id !== null) {
            try {
                const file = await api.mdfiles.get(event.md_file_id);
                setSelectedMdFile(file);
            } catch {
                setSelectedMdFile(null);
                throw new Error('This markdown file no longer exists.');
            }
        }

        setShowChanges(false);
    }, [repos, setMdFiles, setSelectedMdFile, setSelectedRepo, setSelectedSession, setSessions]);

    const cycleMainView = useCallback(() => {
        const views: ActiveView[] = ['terminal'];
        if (selectedMdFile) views.push('editor');
        if (canShowDiffView) views.push('diff');

        const currentIndex = views.indexOf(activeView);
        const nextView = views[(currentIndex + 1) % views.length] ?? 'terminal';
        setActiveView(nextView);
    }, [activeView, canShowDiffView, selectedMdFile, setActiveView]);

    const formatTokenUsage = useCallback((value: number) => {
        return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);
    }, []);

    const backendStatusLabel = backendReadiness?.status === 'migration-failed'
        ? 'Migration failed'
        : backendReadiness?.status === 'fatal-error'
            ? 'Backend error'
            : backendReadiness?.status === 'starting'
                ? 'Starting backend'
                : backendConnectionState === 'connected'
                    ? 'Connected'
                    : backendConnectionState === 'reconnecting'
                        ? 'Reconnecting'
                        : backendConnectionState === 'backend-unavailable'
                            ? 'Backend unavailable'
                            : 'Disconnected';

    const backendStatusClassName = backendReadiness?.status === 'ready' && backendConnectionState === 'connected'
        ? 'border-emerald-700/70 bg-emerald-950/40 text-emerald-300'
        : backendReadiness?.status === 'starting' || backendConnectionState === 'reconnecting'
            ? 'border-amber-700/70 bg-amber-950/40 text-amber-300'
            : 'border-red-800/70 bg-red-950/40 text-red-300';

    const modalFallback = (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-300 shadow-2xl">
                Loading…
            </div>
        </div>
    );

    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const bootstrap = async () => {
            try {
                const readiness = await api.system.readiness();
                if (cancelled) return;
                setBackendReadiness(readiness);

                if (readiness.status !== 'ready') {
                    retryTimer = setTimeout(bootstrap, 2_000);
                    return;
                }

                const [repos, agents, credentials, mdFiles, settings] = await Promise.all([
                    api.repos.list(),
                    api.agents.list(),
                    api.credentials.list(),
                    api.mdfiles.list(),
                    api.settings.get(),
                ]);

                if (cancelled) return;
                setRepos(repos);
                setAgents(agents);
                setCredentials(credentials);
                setSettings(settings);
                const currentRepoId = useAppStore.getState().selectedRepo?.id ?? null;
                setMdFiles(mdFiles.filter((f) => f.scope === 'central' || (currentRepoId !== null && f.scope === 'repo' && f.repo_id === currentRepoId)));
                api.tools.status().then((r) => setToolsAnyMissing(r.anyMissing)).catch(() => { });
            } catch (error) {
                if (cancelled) return;
                setBackendReadiness({
                    status: 'fatal-error',
                    db: 'failed',
                    migrations: 'failed',
                    message: error instanceof Error ? error.message : 'Backend unavailable',
                    timestamp: new Date().toISOString(),
                });
                setBackendConnectionState('backend-unavailable');
                retryTimer = setTimeout(bootstrap, 2_000);
            }
        };

        void bootstrap();

        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [setAgents, setBackendConnectionState, setBackendReadiness, setCredentials, setMdFiles, setRepos, setSettings]);

    useEffect(() => {
        if (backendConnectionState === 'connected' || backendReadiness?.status !== 'ready') {
            return;
        }

        let cancelled = false;
        const interval = setInterval(() => {
            void api.system.readiness()
                .then((readiness) => {
                    if (cancelled) return;
                    setBackendReadiness(readiness);
                })
                .catch((error) => {
                    if (cancelled) return;
                    setBackendReadiness({
                        status: 'fatal-error',
                        db: 'failed',
                        migrations: 'failed',
                        message: error instanceof Error ? error.message : 'Backend unavailable',
                        timestamp: new Date().toISOString(),
                    });
                });
        }, 2_000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [backendConnectionState, backendReadiness?.status, setBackendReadiness]);

    useEffect(() => {
        if (!selectedRepo) return;

        if (!selectedSession?.id || !selectedSession.worktree_path) {
            const { mdFiles, selectedMdFile } = useAppStore.getState();
            const visibleFiles = mdFiles.filter((file) => file.scope !== 'session');
            setMdFiles(visibleFiles);
            if (selectedMdFile?.scope === 'session') {
                setSelectedMdFile(null);
            }
            return;
        }

        let cancelled = false;
        api.mdfiles.list('session', undefined, selectedSession.id)
            .then((sessionFiles) => {
                if (cancelled) return;
                const { mdFiles, selectedMdFile, selectedRepo: currentRepo, selectedSession: currentSession } = useAppStore.getState();
                if (currentRepo?.id !== selectedRepo.id || currentSession?.id !== selectedSession.id) return;

                const centralFiles = mdFiles.filter((file) => file.scope === 'central');
                const repoFiles = mdFiles.filter((file) => file.scope === 'repo');
                setMdFiles([...centralFiles, ...repoFiles, ...sessionFiles]);

                if (
                    selectedMdFile?.scope === 'session' &&
                    !sessionFiles.some((file) => file.id === selectedMdFile.id)
                ) {
                    setSelectedMdFile(null);
                }
            })
            .catch(() => {
                if (cancelled) return;
                const { mdFiles, selectedMdFile } = useAppStore.getState();
                setMdFiles(mdFiles.filter((file) => file.scope !== 'session'));
                if (selectedMdFile?.scope === 'session') {
                    setSelectedMdFile(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [selectedRepo?.id, selectedSession?.id, selectedSession?.worktree_path, setMdFiles, setSelectedMdFile]);

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
        if (activeDiffTarget && !canShowDiffView) {
            setActiveDiffTarget(null);
        }
    }, [activeDiffTarget, canShowDiffView, setActiveDiffTarget]);

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
            // Ctrl+` cycles through available main views (Ctrl+` won't be captured by xterm)
            if (event.key === '`' && event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                cycleMainView();
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
            // Ctrl+3 — Recent changes, Ctrl+4 — Git history, Ctrl+5 — Search logs, Ctrl+6 — Open in VS Code
            if (event.key === '3' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                event.preventDefault();
                setShowChanges(true);
                return;
            }
            if (event.key === '4' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                if (canShowGitHistory) {
                    event.preventDefault();
                    setShowGitHistory(true);
                }
                return;
            }
            if (event.key === '5' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                if (selectedSession) {
                    event.preventDefault();
                    setShowLogSearch(true);
                }
                return;
            }
            if (event.key === '6' && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                if (canOpenTargetInVsCode) {
                    event.preventDefault();
                    void openSelectedContextInVsCode();
                }
                return;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleFullscreen, cycleMainView, setActiveView, sessions, selectedSession, setSelectedSession, settings, lock, canShowGitHistory, setShowGitHistory, canOpenTargetInVsCode, openSelectedContextInVsCode, setShowLogSearch]);

    // ── Shared button class strings ───────────────────────────────────────────
    const iconBtnBase = 'inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-all font-medium';
    const iconBtnDefault = `${iconBtnBase} bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600`;
    const toolbarBoxCls = 'flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/90 px-3 py-1.5 shadow-sm shadow-black/20';
    const panelHdrBtnCls = 'inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-all text-sm leading-none font-medium';
    const collapseTabCls = 'w-7 flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors text-base flex-shrink-0 font-medium';

    return (
        <div className="flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
            <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 py-2.5 border-b border-gray-800/80 bg-gray-950/40 shrink-0">
                <div className="min-w-0 flex items-center justify-start">
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
                <div className="flex items-center justify-center">
                    <div className={toolbarBoxCls}>
                        {/* ── View toggle: Terminal / Editor / Diff ── */}
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
                            <button
                                onClick={() => { if (canShowDiffView) setActiveView('diff'); }}
                                disabled={!canShowDiffView}
                                title={canShowDiffView
                                    ? `Diff view for ${activeDiffSession?.name ?? 'session'} (Ctrl+\`)`
                                    : 'Use a session diff icon to activate diff view'}
                                className={`${iconBtnBase} ${activeView === 'diff'
                                    ? 'bg-orange-600/10 border-orange-500/40 text-orange-200 shadow-[0_0_12px_rgba(234,88,12,0.25)]'
                                    : canShowDiffView
                                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
                                        : 'bg-gray-800 border-gray-700 text-gray-500 opacity-40 cursor-not-allowed'
                                    }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
                                onClick={() => setShowChanges(true)}
                                title="Recent changes (Ctrl+3)"
                                className={iconBtnDefault}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setShowGitHistory(true)}
                                title={canShowGitHistory
                                    ? selectedSession
                                        ? `Git history for ${selectedSession.name} (Ctrl+4)`
                                        : `Git history for ${gitContextRepo?.name} (Ctrl+4)`
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
                            <button
                                onClick={() => setShowLogSearch(true)}
                                title={selectedSession ? `Search logs for ${selectedSession.name} (Ctrl+5)` : 'Select a session to search its logs'}
                                disabled={!selectedSession}
                                className={`${iconBtnBase} ${selectedSession
                                    ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
                                    : 'bg-gray-800 border-gray-700 text-gray-500 opacity-40 cursor-not-allowed'
                                    }`}
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                                </svg>
                            </button>
                            {Boolean(window.electronAPI?.isDesktop) && (
                                <button
                                    onClick={() => { if (canOpenTargetInVsCode) void openSelectedContextInVsCode(); }}
                                    title={canOpenTargetInVsCode
                                        ? (selectedSession
                                            ? `Open ${selectedSession.name} worktree in VS Code (Ctrl+6)`
                                            : `Open ${gitContextRepo?.name} in VS Code (Ctrl+6)`)
                                        : 'Select a repository or session to open in VS Code'}
                                    disabled={!canOpenTargetInVsCode}
                                    className={`${iconBtnBase} ${canOpenTargetInVsCode
                                        ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white hover:border-gray-600'
                                        : 'bg-gray-800 border-gray-700 text-gray-500 opacity-40 cursor-not-allowed'
                                        }`}
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
                    <div className="flex items-center gap-3">
                        <div className={`${toolbarBoxCls} border ${backendStatusClassName}`} title={backendReadiness?.message ?? backendStatusLabel}>
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-current opacity-80" />
                            <span className="text-xs font-medium tracking-wide uppercase">{backendStatusLabel}</span>
                        </div>
                    </div>
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

                        {/* Git diff — shown only after activating a session diff target */}
                        {activeView === 'diff' && activeDiffRepo && activeDiffSession && (
                            <GitDiffView repo={activeDiffRepo} session={activeDiffSession} />
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

            {showCredentials && <Suspense fallback={modalFallback}><CredentialsModal onClose={() => setShowCredentials(false)} /></Suspense>}
            {showSettings && <Suspense fallback={modalFallback}><SettingsModal onClose={() => setShowSettings(false)} /></Suspense>}
            {showPipeline && <Suspense fallback={modalFallback}><PipelineModal onClose={() => setShowPipeline(false)} onNodesChanged={syncTokenUsageEnabled} /></Suspense>}
            {showUsage && (
                <Suspense fallback={modalFallback}>
                    <UsageModal
                        repoName={selectedRepo?.name ?? null}
                        summary={usageSummary}
                        loading={usageLoading}
                        error={usageError}
                        onRefresh={() => { void loadUsage(); }}
                        onClose={() => setShowUsage(false)}
                    />
                </Suspense>
            )}
            {showInstallTools && (
                <Suspense fallback={modalFallback}>
                    <InstallToolsModal onClose={() => { setShowInstallTools(false); api.tools.status().then((r) => setToolsAnyMissing(r.anyMissing)).catch(() => { }); }} />
                </Suspense>
            )}
            {showGitHistory && gitContextRepo && gitContextRepo.is_git_repo && (
                <Suspense fallback={modalFallback}>
                    <GitHistoryModal
                        repo={gitContextRepo}
                        session={selectedSession}
                        onClose={() => setShowGitHistory(false)}
                    />
                </Suspense>
            )}
            {showLogs && <Suspense fallback={modalFallback}><LogsModal onClose={() => setShowLogs(false)} /></Suspense>}
            {showLogSearch && selectedSession && (
                <Suspense fallback={modalFallback}>
                    <LogSearchModal
                        repo={repos.find((r) => r.id === selectedSession.repo_id) ?? { id: selectedSession.repo_id, name: '', path: '', source: 'local', git_url: null, created_at: '', is_git_repo: false }}
                        session={selectedSession}
                        onClose={() => setShowLogSearch(false)}
                    />
                </Suspense>
            )}
            {showPrompts && <PromptPanel onClose={() => setShowPrompts(false)} />}
            {showAutomation && <Suspense fallback={modalFallback}><AutomationModal onClose={() => setShowAutomation(false)} /></Suspense>}
            {showChanges && <Suspense fallback={modalFallback}><ChangesModal onClose={() => setShowChanges(false)} onOpenChange={openChangeEvent} /></Suspense>}
            <ToastContainer />
        </div>
    );
}
