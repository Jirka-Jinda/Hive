import { create } from 'zustand';
import type { Repo, Session, Agent, Credential, MdFile, AppSettings } from '../api/client';

interface AppState {
  repos: Repo[];
  selectedRepo: Repo | null;
  sessions: Session[];
  selectedSession: Session | null;
  agents: Agent[];
  credentials: Credential[];
  mdFiles: MdFile[];
  selectedMdFile: (MdFile & { content: string }) | null;
  activeView: 'terminal' | 'editor' | 'none';
  settings: AppSettings | null;

  setRepos: (repos: Repo[]) => void;
  setSelectedRepo: (repo: Repo | null) => void;
  setSessions: (sessions: Session[]) => void;
  setSelectedSession: (session: Session | null) => void;
  setAgents: (agents: Agent[]) => void;
  setCredentials: (credentials: Credential[]) => void;
  setMdFiles: (files: MdFile[]) => void;
  setSelectedMdFile: (file: (MdFile & { content: string }) | null) => void;
  setActiveView: (view: 'terminal' | 'editor' | 'none') => void;
  setSettings: (settings: AppSettings) => void;
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
  activeView: 'none',
  settings: null,

  setRepos: (repos) => set({ repos }),
  setSelectedRepo: (repo) =>
    set((state) => {
      const selectedMdFile =
        state.selectedMdFile?.scope === 'repo' ? null : state.selectedMdFile;
      const activeView = selectedMdFile ? 'editor' : 'none';

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
    set({ selectedSession: session, activeView: session ? 'terminal' : 'none' }),
  setAgents: (agents) => set({ agents }),
  setCredentials: (credentials) => set({ credentials }),
  setMdFiles: (files) => set({ mdFiles: files }),
  setSelectedMdFile: (file) =>
    set({ selectedMdFile: file, activeView: file ? 'editor' : 'none' }),
  setActiveView: (view) => set({ activeView: view }),
  setSettings: (settings) => set({ settings }),
}));
