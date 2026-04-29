import { EventEmitter } from 'node:events';

export type SessionAttentionState = 'working' | 'idle' | 'stopped';

export interface SessionStateEvent {
  sessionId: number;
  state: SessionAttentionState;
  sessionName?: string;
}

export interface MdFilesChangedEvent {
  scope: 'central' | 'repo';
  repoId?: number;
}

export class NotificationBus extends EventEmitter {
  emitSessionState(event: SessionStateEvent): void {
    this.emit('session-state', event);
  }

  emitMdFilesChanged(event: MdFilesChangedEvent): void {
    this.emit('md-files-changed', event);
  }

  onSessionState(listener: (event: SessionStateEvent) => void): this {
    return this.on('session-state', listener);
  }

  onMdFilesChanged(listener: (event: MdFilesChangedEvent) => void): this {
    return this.on('md-files-changed', listener);
  }

  offSessionState(listener: (event: SessionStateEvent) => void): this {
    return this.off('session-state', listener);
  }

  offMdFilesChanged(listener: (event: MdFilesChangedEvent) => void): this {
    return this.off('md-files-changed', listener);
  }
}
