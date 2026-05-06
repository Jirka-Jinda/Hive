import { create } from 'zustand';
import type { Repo, Session, Agent, Credential, MdFile, AppSettings } from '../api/client';

export type ActiveView = 'terminal' | 'editor' | 'diff';

export interface GitDiffTarget {
  repoId: number;
  sessionId: number;
}

export interface AppNotification {
  id: string;
  sessionId: number;
  repoId?: number;
  sessionName: string;
  state: 'working' | 'idle' | 'stopped';
  timestamp: number;
}

interface AppState {
  repos: Repo[];
  selectedRepo: Repo | null;
  sessions: Session[];
  selectedSession: Session | null;
  sessionTerminalVersions: Record<number, number>;
  agents: Agent[];
  credentials: Credential[];
  mdFiles: MdFile[];
  selectedMdFile: (MdFile & { content: string }) | null;
  activeView: ActiveView;
  activeDiffTarget: GitDiffTarget | null;
  settings: AppSettings | null;
  notifications: AppNotification[];
  /** repoId → count of unread "agent idle" alerts for sessions in that repo */
  repoAlerts: Record<number, number>;
  isLocked: boolean;

  setRepos: (repos: Repo[]) => void;
  setSelectedRepo: (repo: Repo | null) => void;
  updateRepo: (repo: Repo) => void;
  setSessions: (sessions: Session[]) => void;
  setSelectedSession: (session: Session | null) => void;
  updateSession: (session: Session) => void;
  bumpSessionTerminalVersion: (sessionId: number) => void;
  setAgents: (agents: Agent[]) => void;
  setCredentials: (credentials: Credential[]) => void;
  setMdFiles: (files: MdFile[]) => void;
  setSelectedMdFile: (file: (MdFile & { content: string }) | null) => void;
  setActiveView: (view: ActiveView) => void;
  setActiveDiffTarget: (target: GitDiffTarget | null) => void;
  toggleDiffTarget: (repoId: number, sessionId: number) => void;
  setSettings: (settings: AppSettings) => void;
  updateSessionState: (sessionId: number, state: Session['state'], sessionName: string, repoId?: number) => void;
  pushNotification: (notification: AppNotification) => void;
  dismissNotification: (id: string) => void;
  dismissRepoAlert: (repoId: number) => void;
  lock: () => void;
  unlock: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  repos: [],
  selectedRepo: null,
  sessions: [],
  selectedSession: null,
  sessionTerminalVersions: {},
  agents: [],
  credentials: [],
  mdFiles: [],
  selectedMdFile: null,
  activeView: 'terminal',
  activeDiffTarget: null,
  settings: null,
  notifications: [],
  repoAlerts: {},
  isLocked: false,

  setRepos: (repos) => set({ repos }),
  setSelectedRepo: (repo) =>
    set((state) => {
      const selectedMdFile =
        state.selectedMdFile?.scope === 'repo' || state.selectedMdFile?.scope === 'session'
          ? null
          : state.selectedMdFile;
      const activeView: ActiveView = selectedMdFile ? 'editor' : 'terminal';

      return {
        selectedRepo: repo,
        selectedSession: null,
        sessions: [],
        mdFiles: state.mdFiles.filter((file) => file.scope === 'central'),
        selectedMdFile,
        activeView,
        activeDiffTarget: null,
      };
    }),
  updateRepo: (repo) =>
    set((state) => ({
      repos: state.repos.map((existing) => (existing.id === repo.id ? repo : existing)),
      selectedRepo: state.selectedRepo?.id === repo.id ? repo : state.selectedRepo,
    })),
  setSessions: (sessions) =>
    set((state) => {
      const target = state.activeDiffTarget;
      if (
        !target ||
        sessions.some(
          (session) =>
            session.id === target.sessionId &&
            session.repo_id === target.repoId,
        )
      ) {
        return { sessions };
      }

      return {
        sessions,
        activeDiffTarget: null,
        activeView: state.activeView === 'diff' ? 'terminal' : state.activeView,
      };
    }),
  setSelectedSession: (session) =>
    set({ selectedSession: session, activeView: 'terminal' }),
  updateSession: (session) =>
    set((state) => ({
      sessions: state.sessions.map((existing) => (existing.id === session.id ? session : existing)),
      selectedSession: state.selectedSession?.id === session.id ? session : state.selectedSession,
    })),
  bumpSessionTerminalVersion: (sessionId) =>
    set((state) => ({
      sessionTerminalVersions: {
        ...state.sessionTerminalVersions,
        [sessionId]: (state.sessionTerminalVersions[sessionId] ?? 0) + 1,
      },
    })),
  setAgents: (agents) => set({ agents }),
  setCredentials: (credentials) => set({ credentials }),
  setMdFiles: (files) => set({ mdFiles: files }),
  setSelectedMdFile: (file) =>
    set({ selectedMdFile: file, activeView: file ? 'editor' : 'terminal' }),
  setActiveView: (view) =>
    set((state) => {
      if (view === 'diff' && !state.activeDiffTarget) return {};
      return { activeView: view };
    }),
  setActiveDiffTarget: (target) =>
    set((state) => ({
      activeDiffTarget: target,
      activeView: target ? 'diff' : state.activeView === 'diff' ? 'terminal' : state.activeView,
    })),
  toggleDiffTarget: (repoId, sessionId) =>
    set((state) => {
      const sameTarget =
        state.activeDiffTarget?.repoId === repoId &&
        state.activeDiffTarget.sessionId === sessionId;

      if (sameTarget) {
        return {
          activeDiffTarget: null,
          activeView: state.activeView === 'diff' ? 'terminal' : state.activeView,
        };
      }

      return {
        activeDiffTarget: { repoId, sessionId },
        activeView: 'diff',
      };
    }),
  setSettings: (settings) => set({ settings }),

  updateSessionState: (sessionId, state, sessionName, repoId) =>
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, state } : sess
      );
      const selectedSession =
        s.selectedSession?.id === sessionId
          ? { ...s.selectedSession, state }
          : s.selectedSession;

      const previousSession = s.sessions.find((sess) => sess.id === sessionId);
      const resolvedRepoId = repoId ?? previousSession?.repo_id;
      const repoAlerts = { ...s.repoAlerts };
      const becameIdle = state === 'idle' && previousSession?.state !== 'idle';
      if (becameIdle && resolvedRepoId != null && s.selectedRepo?.id !== resolvedRepoId) {
        repoAlerts[resolvedRepoId] = (repoAlerts[resolvedRepoId] ?? 0) + 1;
      }

      // Toast notification: only when session is not currently selected
      const isSelected = s.selectedSession?.id === sessionId;
      if (becameIdle && !isSelected) {
        const notification: AppNotification = {
          id: `${sessionId}-${Date.now()}`,
          sessionId,
          repoId: resolvedRepoId,
          sessionName,
          state,
          timestamp: Date.now(),
        };
        return { sessions, selectedSession, notifications: [...s.notifications, notification], repoAlerts };
      }
      return { sessions, selectedSession, repoAlerts };
    }),

  pushNotification: (notification) =>
    set((s) => ({ notifications: [...s.notifications, notification] })),

  dismissNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  dismissRepoAlert: (repoId) =>
    set((s) => {
      const repoAlerts = { ...s.repoAlerts };
      delete repoAlerts[repoId];
      return { repoAlerts };
    }),

  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
}));
