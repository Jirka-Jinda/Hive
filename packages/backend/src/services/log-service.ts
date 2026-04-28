import type Database from 'better-sqlite3';

export interface AppErrorLog {
  id: number;
  message: string;
  stack: string | null;
  context: string | null;
  created_at: string;
}

export interface UserActionLog {
  id: number;
  action: string;
  detail: string | null;
  created_at: string;
}

const MAX_ENTRIES = 1000;

export class LogService {
  constructor(private readonly db: Database.Database) {}

  logAppError(message: string, stack?: string, context?: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO app_error_logs (message, stack, context) VALUES (?, ?, ?)')
      .run(message, stack ?? null, context ? JSON.stringify(context) : null);
    this.trim('app_error_logs');
  }

  logUserAction(action: string, detail?: string): void {
    this.db
      .prepare('INSERT INTO user_action_logs (action, detail) VALUES (?, ?)')
      .run(action, detail ?? null);
    this.trim('user_action_logs');
  }

  getAppErrors(limit = MAX_ENTRIES): AppErrorLog[] {
    return this.db
      .prepare('SELECT * FROM app_error_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as AppErrorLog[];
  }

  getUserActions(limit = MAX_ENTRIES): UserActionLog[] {
    return this.db
      .prepare('SELECT * FROM user_action_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as UserActionLog[];
  }

  private trim(table: 'app_error_logs' | 'user_action_logs'): void {
    this.db
      .prepare(
        `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY id DESC LIMIT ?)`,
      )
      .run(MAX_ENTRIES);
  }
}
