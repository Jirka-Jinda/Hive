import { EventEmitter } from 'node:events';

export type SessionAttentionState = 'working' | 'idle' | 'stopped';

export interface SessionStateEvent {
  sessionId: number;
  state: SessionAttentionState;
  sessionName?: string;
}

export class NotificationBus extends EventEmitter {
  emitSessionState(event: SessionStateEvent): void {
    this.emit('session-state', event);
  }

  onSessionState(listener: (event: SessionStateEvent) => void): this {
    return this.on('session-state', listener);
  }

  offSessionState(listener: (event: SessionStateEvent) => void): this {
    return this.off('session-state', listener);
  }
}
