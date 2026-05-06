import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import type { AutomationTask } from './automation-service';
import type { MdFile } from './mdfile-manager';

export type ChangeEventType =
  | 'mdfile-created'
  | 'mdfile-updated'
  | 'mdfile-moved'
  | 'mdfile-deleted'
  | 'mdfile-restored'
  | 'automation-ran'
  | 'automation-failed';

export interface ChangeEvent {
  id: number;
  event_type: ChangeEventType;
  scope: MdFile['scope'] | null;
  repo_id: number | null;
  session_id: number | null;
  md_file_id: number | null;
  automation_task_id: number | null;
  path: string | null;
  title: string;
  summary: string | null;
  created_at: string;
}

export class ChangeFeedService {
  constructor(private readonly db: Database.Database) {}

  list(limit = 50, repoId?: number, sessionId?: number): ChangeEvent[] {
    if (sessionId !== undefined) {
      return this.db.prepare(
        `SELECT * FROM change_events
         WHERE session_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      ).all(sessionId, limit) as ChangeEvent[];
    }

    if (repoId !== undefined) {
      return this.db.prepare(
        `SELECT * FROM change_events
         WHERE repo_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      ).all(repoId, limit) as ChangeEvent[];
    }

    return this.db.prepare(
      `SELECT * FROM change_events
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    ).all(limit) as ChangeEvent[];
  }

  recordMdCreated(file: MdFile): void {
    this.insert({
      event_type: 'mdfile-created',
      scope: file.scope,
      repo_id: file.repo_id,
      session_id: file.session_id,
      md_file_id: file.id,
      automation_task_id: null,
      path: file.path,
      title: `Created ${basename(file.path)}`,
      summary: `New ${file.scope} markdown file`,
    });
  }

  recordMdUpdated(file: MdFile, summary = 'Markdown content updated'): void {
    this.insert({
      event_type: 'mdfile-updated',
      scope: file.scope,
      repo_id: file.repo_id,
      session_id: file.session_id,
      md_file_id: file.id,
      automation_task_id: null,
      path: file.path,
      title: `Updated ${basename(file.path)}`,
      summary,
    });
  }

  recordMdRestored(file: MdFile): void {
    this.insert({
      event_type: 'mdfile-restored',
      scope: file.scope,
      repo_id: file.repo_id,
      session_id: file.session_id,
      md_file_id: file.id,
      automation_task_id: null,
      path: file.path,
      title: `Restored ${basename(file.path)}`,
      summary: 'Restored previous revision',
    });
  }

  recordMdMoved(before: MdFile, after: MdFile): void {
    const summary = before.scope === after.scope
      ? `Renamed within ${after.scope} scope`
      : `${before.scope} → ${after.scope}`;
    this.insert({
      event_type: 'mdfile-moved',
      scope: after.scope,
      repo_id: after.repo_id,
      session_id: after.session_id,
      md_file_id: after.id,
      automation_task_id: null,
      path: after.path,
      title: `Moved ${basename(after.path)}`,
      summary,
    });
  }

  recordMdDeleted(file: MdFile): void {
    this.insert({
      event_type: 'mdfile-deleted',
      scope: file.scope,
      repo_id: file.repo_id,
      session_id: file.session_id,
      md_file_id: null,
      automation_task_id: null,
      path: file.path,
      title: `Deleted ${basename(file.path)}`,
      summary: `Removed ${file.scope} markdown file`,
    });
  }

  recordAutomationResult(task: AutomationTask, status: 'success' | 'failed', repoId: number | null = null): void {
    this.insert({
      event_type: status === 'failed' ? 'automation-failed' : 'automation-ran',
      scope: null,
      repo_id: repoId,
      session_id: task.session_id,
      md_file_id: null,
      automation_task_id: task.id,
      path: null,
      title: status === 'failed' ? `Automation failed: ${task.name}` : `Automation ran: ${task.name}`,
      summary: status === 'failed'
        ? task.last_error
        : task.last_output_summary ?? `Last run ${task.last_run_at ?? 'completed'}`,
    });
  }

  private insert(event: Omit<ChangeEvent, 'id' | 'created_at'>): void {
    this.db.prepare(
      `INSERT INTO change_events (event_type, scope, repo_id, session_id, md_file_id, automation_task_id, path, title, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.event_type,
      event.scope,
      event.repo_id,
      event.session_id,
      event.md_file_id,
      event.automation_task_id,
      event.path,
      event.title,
      event.summary,
    );
  }
}
