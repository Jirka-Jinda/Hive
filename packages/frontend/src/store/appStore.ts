import { create } from 'zustand';
import type { Repo, Session, Agent, Credential, MdFile, AppSettings } from '../api/client';

export interface AppNotification {
  id: string;
  sessionId: number;
  sessionName: string;
  state: 'working' | 'idle' | 'stopped';
  timestamp: number;
}

interface AppState {
  repos: Repo[];
  selectedRepo: Repo | null;
  sessions: Session[];
  selectedSession: Session | null;
  agents: Agent[];
  credentials: Credential[];
  mdFiles: MdFile[];
  selectedMdFile: (MdFile & { content: string }) | null;
  activeView: 'terminal' | 'editor';
  settings: AppSettings | null;
  notifications: AppNotification[];
  isLocked: boolean;

  setRepos: (repos: Repo[]) => void;
  setSelectedRepo: (repo: Repo | null) => void;
  setSessions: (sessions: Session[]) => void;
  setSelectedSession: (session: Session | null) => void;
  setAgents: (agents: Agent[]) => void;
  setCredentials: (credentials: Credential[]) => void;
  setMdFiles: (files: MdFile[]) => void;
  setSelectedMdFile: (file: (MdFile & { content: string }) | null) => void;
  setActiveView: (view: 'terminal' | 'editor') => void;
  setSettings: (settings: AppSettings) => void;
  updateSessionState: (sessionId: number, state: Session['state'], sessionName: string) => void;
  pushNotification: (notification: AppNotification) => void;
  dismissNotification: (id: string) => void;
  lock: () => void;
  unlock: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  repos: [],
  selectedRepo: null,
  sessions: [],
  selectedSession: null,
  agents: [],
  credentials: [],
  mdFiles: [],
  selectedMdFile: null,
  activeView: 'terminal',
  settings: null,
  notifications: [],
  isLocked: false,

  setRepos: (repos) => set({ repos }),
  setSelectedRepo: (repo) =>
    set((state) => {
      const selectedMdFile =
        state.selectedMdFile?.scope === 'repo' ? null : state.selectedMdFile;
      const activeView: 'terminal' | 'editor' = selectedMdFile ? 'editor' : 'terminal';

      return {
        selectedRepo: repo,
        selectedSession: null,
        sessions: [],
        mdFiles: state.mdFiles.filter((file) => file.scope !== 'repo'),
        selectedMdFile,
        activeView,
      };
    }),
  setSessions: (sessions) => set({ sessions }),
  setSelectedSession: (session) =>
    set({ selectedSession: session, activeView: 'terminal' }),
  setAgents: (agents) => set({ agents }),
  setCredentials: (credentials) => set({ credentials }),
  setMdFiles: (files) => set({ mdFiles: files }),
  setSelectedMdFile: (file) =>
    set({ selectedMdFile: file, activeView: file ? 'editor' : 'terminal' }),
  setActiveView: (view) => set({ activeView: view }),
  setSettings: (settings) => set({ settings }),

  updateSessionState: (sessionId, state, sessionName) =>
    set((s) => {
      const sessions = s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, state } : sess
      );
      // Push notification only when idle and session is not currently selected
      const isSelected = s.selectedSession?.id === sessionId;
      if (state === 'idle' && !isSelected) {
        const notification: AppNotification = {
          id: `${sessionId}-${Date.now()}`,
          sessionId,
          sessionName,
          state,
          timestamp: Date.now(),
        };
        return { sessions, notifications: [...s.notifications, notification] };
      }
      return { sessions };
    }),

  pushNotification: (notification) =>
    set((s) => ({ notifications: [...s.notifications, notification] })),

  dismissNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
}));
