import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { api } from '../api/client';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/notify`;
const MAX_RETRY_DELAY_MS = 30_000;

export function useNotifications(): void {
  const updateSessionState = useAppStore((s) => s.updateSessionState);
  const setMdFiles = useAppStore((s) => s.setMdFiles);
  const setSelectedMdFile = useAppStore((s) => s.setSelectedMdFile);
  const setBackendConnectionState = useAppStore((s) => s.setBackendConnectionState);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1_000);
  const wsRef = useRef<WebSocket | null>(null);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function connect(): void {
      if (cancelled) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            type: string;
            sessionId: number;
            sessionName?: string;
            state: 'working' | 'idle' | 'stopped';
            scope?: 'central' | 'repo' | 'session';
            repoId?: number;
            sessionIdChanged?: number;
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
            const { selectedRepo } = useAppStore.getState();

            void api.mdfiles.list('repo', repoId).then((freshRepoFiles) => {
              const { mdFiles, selectedMdFile, selectedRepo: currentRepo } = useAppStore.getState();
              if (selectedRepo?.id !== repoId) return;
              if (currentRepo?.id !== repoId) return;
              const centralFiles = mdFiles.filter((file) => file.scope === 'central');
              const sessionFiles = mdFiles.filter((file) => file.scope === 'session');
              setMdFiles([...centralFiles, ...freshRepoFiles, ...sessionFiles]);

              if (
                selectedMdFile?.scope === 'repo' &&
                !freshRepoFiles.some((file) => file.id === selectedMdFile.id)
              ) {
                setSelectedMdFile(null);
              }
            }).catch(() => {
              // Ignore transient refresh failures.
            });
          }

          if (
            msg.type === 'md-files-changed' &&
            msg.scope === 'session' &&
            msg.sessionId !== undefined
          ) {
            const { selectedSession } = useAppStore.getState();
            if (selectedSession?.id !== msg.sessionId) return;

            void api.mdfiles.list('session', undefined, msg.sessionId).then((sessionFiles) => {
              const { mdFiles, selectedMdFile, selectedSession: currentSession } = useAppStore.getState();
              if (currentSession?.id !== msg.sessionId) return;
              const centralFiles = mdFiles.filter((file) => file.scope === 'central');
              const repoFiles = mdFiles.filter((file) => file.scope === 'repo');
              setMdFiles([...centralFiles, ...repoFiles, ...sessionFiles]);

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
        setBackendConnectionState(hasConnectedRef.current ? 'reconnecting' : 'backend-unavailable');
        if (!cancelled) {
          retryRef.current = setTimeout(() => {
            retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_DELAY_MS);
            connect();
          }, retryDelayRef.current);
        }
      };

      ws.onerror = () => {
        if (!hasConnectedRef.current) {
          setBackendConnectionState('backend-unavailable');
        }
        ws.close();
      };

      ws.onopen = () => {
        hasConnectedRef.current = true;
        retryDelayRef.current = 1_000;
        setBackendConnectionState('connected');
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
      setBackendConnectionState('disconnected');
    };
  }, [setBackendConnectionState, setMdFiles, setSelectedMdFile, updateSessionState]);
}
