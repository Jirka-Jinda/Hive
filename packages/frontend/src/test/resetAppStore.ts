import { useAppStore } from '../store/appStore';

export function resetAppStore(partial: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
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
    ...partial,
  });
}
