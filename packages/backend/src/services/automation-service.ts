import type Database from 'better-sqlite3';
import * as cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { MdFileManager } from './mdfile-manager';
import type { SessionStore } from './session-store';
import type { RepoManager } from './repo-manager';
import type { PipelineRegistry } from '../pipeline/pipeline-registry';
import { getProcess } from './process-manager';
import { mergePendingSessionInput } from './pending-session-input';
import { renderTemplate } from '../utils/template';
import type { ChangeFeedService } from './change-feed-service';

export interface AutomationTask {
  id: number;
  name: string;
  md_file_id: number;
  session_id: number;
  cron: string;
  params: string; // JSON Record<string,string>
  enabled: number; // 0 | 1
  last_run_started_at: string | null;
  last_run_at: string | null;
  last_run_finished_at: string | null;
  last_run_duration_ms: number | null;
  last_run_status: 'running' | 'success' | 'failed' | null;
  last_error: string | null;
  last_output_summary: string | null;
  consecutive_failures: number;
  next_run_at: string | null;
  created_at: string;
}

export interface AutomationTaskRun {
  id: number;
  task_id: number;
  trigger: 'schedule' | 'manual';
  status: 'success' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  output_summary: string | null;
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

function summarizeOutput(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Sent empty automation payload';
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
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
    private readonly changeFeed?: ChangeFeedService,
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

    try {
      this.sessionStore.get(body.session_id);
    } catch {
      throw new Error(`Session ${body.session_id} not found`);
    }

    try {
      this.mdMgr.read(body.md_file_id);
    } catch {
      throw new Error(`Template ${body.md_file_id} not found`);
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
    this.db.prepare('UPDATE automation_tasks SET enabled = 0, next_run_at = NULL WHERE id = ?').run(id);
    return this.getOrThrow(id);
  }

  resume(id: number): AutomationTask {
    const task = this.getOrThrow(id);
    this.db.prepare(
      'UPDATE automation_tasks SET enabled = 1, consecutive_failures = 0, last_error = NULL, next_run_at = ? WHERE id = ?'
    ).run(computeNextRun(task.cron), id);
    const updated = this.getOrThrow(id);
    this.schedule(updated);
    return updated;
  }

  async runNow(id: number): Promise<AutomationTask> {
    return this.fire(id, 'manual', true);
  }

  listRuns(taskId: number, limit = 10): AutomationTaskRun[] {
    this.getOrThrow(taskId);
    return this.db.prepare(
      `SELECT * FROM automation_task_runs
       WHERE task_id = ?
       ORDER BY started_at DESC
       LIMIT ?`
    ).all(taskId, limit) as AutomationTaskRun[];
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

  private async fire(taskId: number, trigger: AutomationTaskRun['trigger'] = 'schedule', ignoreEnabled = false): Promise<AutomationTask> {
    const task = this.db.prepare('SELECT * FROM automation_tasks WHERE id = ?').get(taskId) as AutomationTask | undefined;
    if (!task) throw new Error(`Automation task ${taskId} not found`);
    if (!task.enabled && !ignoreEnabled) return task;

    const startedAt = new Date();
    this.db.prepare(
      `UPDATE automation_tasks
       SET last_run_started_at = ?, last_run_status = 'running', last_error = NULL
       WHERE id = ?`
    ).run(startedAt.toISOString(), taskId);

    let status: AutomationTaskRun['status'] = 'success';
    let errorMessage: string | null = null;
    let outputSummary: string | null = null;
    let resolvedRepoId: number | null = null;

    try {
      // Resolve session and repo fresh via services
      let session;
      try {
        session = this.sessionStore.get(task.session_id);
      } catch {
        throw new Error(`Session ${task.session_id} not found`);
      }

      let repo;
      try {
        repo = this.repoManager.get(session.repo_id);
        resolvedRepoId = repo.id;
      } catch {
        throw new Error(`Repo ${session.repo_id} not found`);
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
        throw new Error(`Session ${task.session_id} has no running process`);
      } else {
        const input = rendered + '\n';
        const transformed = this.pipelineRegistry
          ? await this.pipelineRegistry.run('user-input', input, { sessionId: session.id, repoId: repo.id })
          : input;
        const mergedInput = await mergePendingSessionInput(session.id, transformed);
        proc.pty.write(mergedInput);
        outputSummary = summarizeOutput(mergedInput);
      }
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : 'Unknown automation failure';
      console.error(`[Automation] Task ${taskId} fire error:`, err);
    } finally {
      const finishedAt = new Date();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      const nextFailures = status === 'failed' ? (task.consecutive_failures ?? 0) + 1 : 0;
      const shouldDisable = status === 'failed' && task.enabled === 1 && nextFailures >= 3;
      const nextEnabled = shouldDisable ? 0 : task.enabled;
      const nextRunAt = nextEnabled ? computeNextRun(task.cron) : null;
      const finalErrorMessage = shouldDisable
        ? `${errorMessage ?? 'Task failed repeatedly'} Task disabled after repeated failures.`
        : errorMessage;

      this.db.prepare(
        `INSERT INTO automation_task_runs (task_id, trigger, status, started_at, finished_at, duration_ms, error_message, output_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        taskId,
        trigger,
        status,
        startedAt.toISOString(),
        finishedAt.toISOString(),
        durationMs,
        finalErrorMessage,
        outputSummary,
      );

      this.db.prepare(
        `UPDATE automation_tasks
         SET enabled = ?,
             last_run_at = ?,
             last_run_finished_at = ?,
             last_run_duration_ms = ?,
             last_run_status = ?,
             last_error = ?,
             last_output_summary = ?,
             consecutive_failures = ?,
             next_run_at = ?
         WHERE id = ?`
      ).run(
        nextEnabled,
        finishedAt.toISOString(),
        finishedAt.toISOString(),
        durationMs,
        status,
        finalErrorMessage,
        outputSummary,
        nextFailures,
        nextRunAt,
        taskId,
      );

      if (shouldDisable) {
        this.stop(taskId);
      }
    }

    const updatedTask = this.getOrThrow(taskId);
    this.changeFeed?.recordAutomationResult(updatedTask, status, resolvedRepoId);
    return updatedTask;
  }
}
