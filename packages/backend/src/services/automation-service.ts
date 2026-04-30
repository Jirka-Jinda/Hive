import type Database from 'better-sqlite3';
import * as cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { MdFileManager } from './mdfile-manager';
import type { SessionStore } from './session-store';
import type { RepoManager } from './repo-manager';
import type { PipelineRegistry } from '../pipeline/pipeline-registry';
import { getProcess } from './process-manager';
import { renderTemplate } from '../utils/template';

export interface AutomationTask {
  id: number;
  name: string;
  md_file_id: number;
  session_id: number;
  cron: string;
  params: string; // JSON Record<string,string>
  enabled: number; // 0 | 1
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface CreateTaskBody {
  name: string;
  md_file_id: number;
  session_id: number;
  cron: string;
  params?: Record<string, string>;
}

function computeNextRun(cronExpr: string): string | null {
  try {
    return CronExpressionParser.parse(cronExpr).next().toISOString();
  } catch {
    return null;
  }
}

export class AutomationService {
  private db: Database.Database;
  private mdMgr: MdFileManager;
  private sessionStore: SessionStore;
  private repoManager: RepoManager;
  private pipelineRegistry?: PipelineRegistry;
  private handles = new Map<number, cron.ScheduledTask>();

  constructor(
    db: Database.Database,
    mdMgr: MdFileManager,
    sessionStore: SessionStore,
    repoManager: RepoManager,
    pipelineRegistry?: PipelineRegistry,
  ) {
    this.db = db;
    this.mdMgr = mdMgr;
    this.sessionStore = sessionStore;
    this.repoManager = repoManager;
    this.pipelineRegistry = pipelineRegistry;
  }

  list(): AutomationTask[] {
    return this.db.prepare('SELECT * FROM automation_tasks ORDER BY created_at DESC').all() as AutomationTask[];
  }

  create(body: CreateTaskBody): AutomationTask {
    if (!cron.validate(body.cron)) {
      throw new Error(`Invalid cron expression: ${body.cron}`);
    }
    const params = JSON.stringify(body.params ?? {});
    const next = computeNextRun(body.cron);

    const result = this.db.prepare(`
      INSERT INTO automation_tasks (name, md_file_id, session_id, cron, params, enabled, next_run_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(body.name, body.md_file_id, body.session_id, body.cron, params, next);

    const task = this.db.prepare('SELECT * FROM automation_tasks WHERE id = ?')
      .get(result.lastInsertRowid) as AutomationTask;

    this.schedule(task);
    return task;
  }

  pause(id: number): AutomationTask {
    this.stop(id);
    this.db.prepare('UPDATE automation_tasks SET enabled = 0 WHERE id = ?').run(id);
    return this.getOrThrow(id);
  }

  resume(id: number): AutomationTask {
    const task = this.getOrThrow(id);
    this.db.prepare('UPDATE automation_tasks SET enabled = 1, next_run_at = ? WHERE id = ?')
      .run(computeNextRun(task.cron), id);
    const updated = this.getOrThrow(id);
    this.schedule(updated);
    return updated;
  }

  delete(id: number): void {
    this.stop(id);
    const result = this.db.prepare('DELETE FROM automation_tasks WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new Error(`Automation task ${id} not found`);
    }
  }

  startAll(): void {
    const tasks = this.db.prepare('SELECT * FROM automation_tasks WHERE enabled = 1').all() as AutomationTask[];
    for (const task of tasks) {
      this.schedule(task);
    }
    console.log(`[Automation] Loaded ${tasks.length} task(s)`);
  }

  private schedule(task: AutomationTask): void {
    this.stop(task.id);
    if (!cron.validate(task.cron)) return;

    const handle = cron.schedule(task.cron, () => {
      void this.fire(task.id);
    });
    this.handles.set(task.id, handle);
  }

  private stop(id: number): void {
    const handle = this.handles.get(id);
    if (handle) {
      handle.stop();
      this.handles.delete(id);
    }
  }

  private getOrThrow(id: number): AutomationTask {
    const task = this.db.prepare('SELECT * FROM automation_tasks WHERE id = ?').get(id) as AutomationTask | undefined;
    if (!task) throw new Error(`Automation task ${id} not found`);
    return task;
  }

  private async fire(taskId: number): Promise<void> {
    const task = this.db.prepare('SELECT * FROM automation_tasks WHERE id = ?').get(taskId) as AutomationTask | undefined;
    if (!task || !task.enabled) return;

    try {
      // Resolve session and repo fresh via services
      let session;
      try {
        session = this.sessionStore.get(task.session_id);
      } catch {
        console.warn(`[Automation] Task ${taskId}: session ${task.session_id} not found`);
        return;
      }

      let repo;
      try {
        repo = this.repoManager.get(session.repo_id);
      } catch {
        console.warn(`[Automation] Task ${taskId}: repo not found`);
        return;
      }

      const { content } = this.mdMgr.read(task.md_file_id);
      const storedParams = JSON.parse(task.params) as Record<string, string>;

      const rendered = renderTemplate(content, {
        ...storedParams,
        repo: repo.path,
        session: session.name,
      });

      const proc = getProcess(task.session_id);
      if (!proc) {
        console.warn(`[Automation] Task ${taskId}: session ${task.session_id} has no running process`);
      } else {
        const input = rendered + '\n';
        const transformed = this.pipelineRegistry
          ? await this.pipelineRegistry.run('user-input', input, { sessionId: session.id, repoId: repo.id })
          : input;
        proc.pty.write(transformed);
      }
    } catch (err) {
      console.error(`[Automation] Task ${taskId} fire error:`, err);
    } finally {
      // Always update timestamps so the UI can track last/next run
      const next = computeNextRun(task.cron);
      this.db.prepare('UPDATE automation_tasks SET last_run_at = datetime(\'now\'), next_run_at = ? WHERE id = ?')
        .run(next, taskId);
    }
  }
}
