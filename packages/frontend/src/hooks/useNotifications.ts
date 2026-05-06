import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { api } from '../api/client';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/notify`;
const MAX_RETRY_DELAY_MS = 30_000;

export function useNotifications(): void {
  const updateSessionState = useAppStore((s) => s.updateSessionState);
  const setMdFiles = useAppStore((s) => s.setMdFiles);
  const setSelectedMdFile = useAppStore((s) => s.setSelectedMdFile);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1_000);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect(): void {
      if (cancelled) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelayRef.current = 1_000;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            type: string;
            sessionId: number;
            sessionName?: string;
            state: 'working' | 'idle' | 'stopped';
            scope?: 'central' | 'repo';
            repoId?: number;
          };
          if (msg.type === 'session-state') {
            updateSessionState(msg.sessionId, msg.state, msg.sessionName ?? '', msg.repoId);
            return;
          }

          if (msg.type === 'md-files-changed' && msg.scope === 'central') {
            void api.mdfiles.list('central').then((centralFiles) => {
              const { mdFiles, selectedMdFile } = useAppStore.getState();
              const scopedFiles = mdFiles.filter((file) => file.scope !== 'central');
              setMdFiles([...centralFiles, ...scopedFiles]);

              if (
                selectedMdFile?.scope === 'central' &&
                !centralFiles.some((file) => file.id === selectedMdFile.id)
              ) {
                setSelectedMdFile(null);
              }
            }).catch(() => {
              // Ignore transient refresh failures and keep retrying via WS lifecycle.
            });
          }

          if (msg.type === 'md-files-changed' && msg.scope === 'repo' && msg.repoId !== undefined) {
            const repoId = msg.repoId;
            const { selectedRepo, selectedSession } = useAppStore.getState();
            const sessionFilesPromise = selectedSession?.repo_id === repoId && selectedSession.worktree_path
              ? api.mdfiles.list('session', undefined, selectedSession.id)
              : Promise.resolve([]);

            void Promise.all([api.mdfiles.list('repo', repoId), sessionFilesPromise]).then(([freshRepoFiles, sessionFiles]) => {
              const { mdFiles, selectedMdFile, selectedRepo: currentRepo } = useAppStore.getState();
              if (selectedRepo?.id !== repoId) return;
              if (currentRepo?.id !== repoId) return;
              const centralFiles = mdFiles.filter((file) => file.scope === 'central');
              setMdFiles([...centralFiles, ...freshRepoFiles, ...sessionFiles]);

              if (
                selectedMdFile?.scope === 'repo' &&
                !freshRepoFiles.some((file) => file.id === selectedMdFile.id)
              ) {
                setSelectedMdFile(null);
              }

              if (
                selectedMdFile?.scope === 'session' &&
                !sessionFiles.some((file) => file.id === selectedMdFile.id)
              ) {
                setSelectedMdFile(null);
              }
            }).catch(() => {
              // Ignore transient refresh failures.
            });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) {
          retryRef.current = setTimeout(() => {
            retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_DELAY_MS);
            connect();
          }, retryDelayRef.current);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [setMdFiles, setSelectedMdFile, updateSessionState]);
}
