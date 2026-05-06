import type Database from 'better-sqlite3';
import { normalizeTerminalText } from '../utils/terminal-text';

export type SessionBranchMode = 'new' | 'existing' | 'root';

export interface Session {
  id: number;
  repo_id: number;
  agent_type: string;
  credential_id: number | null;
  name: string;
  status: 'running' | 'stopped';
  state: 'working' | 'idle' | 'stopped';
  branch_mode: SessionBranchMode | null;
  initial_branch_name: string | null;
  worktree_path: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionWithGitStatus extends Session {
  current_branch: string | null;
  head_ref: string | null;
  is_detached: boolean;
}

export interface SessionLogChunk {
  id: number;
  output: Buffer;
}

export class SessionStore {
  constructor(private db: Database.Database) {}

  listAll(includeArchived = true): Session[] {
    return this.db
      .prepare(includeArchived
        ? 'SELECT * FROM sessions ORDER BY created_at DESC'
        : 'SELECT * FROM sessions WHERE archived_at IS NULL ORDER BY created_at DESC')
      .all() as Session[];
  }

  list(repoId: number, includeArchived = true): Session[] {
    return this.db
      .prepare(includeArchived
        ? 'SELECT * FROM sessions WHERE repo_id = ? ORDER BY (archived_at IS NOT NULL), sort_order ASC, created_at DESC'
        : 'SELECT * FROM sessions WHERE repo_id = ? AND archived_at IS NULL ORDER BY sort_order ASC, created_at DESC')
      .all(repoId) as Session[];
  }

  get(id: number): Session {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
    if (!row) throw new Error(`Session ${id} not found`);
    return row;
  }

  create(input: {
    repoId: number;
    agentType: string;
    name: string;
    credentialId?: number;
    branchMode?: SessionBranchMode | null;
    initialBranchName?: string | null;
    worktreePath?: string | null;
  }): Session {
    // Place new sessions at the top (sort_order = 0, shift others down)
    this.db
      .prepare('UPDATE sessions SET sort_order = sort_order + 1 WHERE repo_id = ?')
      .run(input.repoId);
    const result = this.db
      .prepare(
        'INSERT INTO sessions (repo_id, agent_type, name, credential_id, branch_mode, initial_branch_name, worktree_path, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
      )
      .run(
        input.repoId,
        input.agentType,
        input.name,
        input.credentialId ?? null,
        input.branchMode ?? null,
        input.initialBranchName ?? null,
        input.worktreePath ?? null,
      );
    return this.get(result.lastInsertRowid as number);
  }

  reorder(repoId: number, orderedIds: number[]): void {
    const update = this.db.prepare(
      "UPDATE sessions SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND repo_id = ?"
    );
    const tx = this.db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        update.run(i, orderedIds[i], repoId);
      }
    });
    tx();
  }

  update(id: number, changes: { name?: string }): Session {
    const current = this.get(id);
    const nextName = changes.name?.trim() ?? current.name;
    if (!nextName) throw new Error('Session name is required');

    this.db
      .prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nextName, id);

    return this.get(id);
  }

  archive(id: number): Session {
    this.db
      .prepare("UPDATE sessions SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(id);
    return this.get(id);
  }

  unarchive(id: number): Session {
    this.db
      .prepare("UPDATE sessions SET archived_at = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(id);
    return this.get(id);
  }

  setStatus(id: number, status: 'running' | 'stopped'): void {
    this.db
      .prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, id);
  }

  setState(id: number, state: 'working' | 'idle' | 'stopped'): void {
    this.db
      .prepare("UPDATE sessions SET state = ?, updated_at = datetime('now') WHERE id = ?")
      .run(state, id);
  }

  stopRunningSessions(): void {
    this.db
      .prepare("UPDATE sessions SET status = 'stopped', state = 'stopped', updated_at = datetime('now') WHERE status = 'running'")
      .run();
  }

  updateGitMetadata(
    id: number,
    changes: {
      branchMode?: SessionBranchMode | null;
      initialBranchName?: string | null;
      worktreePath?: string | null;
    },
  ): Session {
    const current = this.get(id);
    this.db
      .prepare(
        "UPDATE sessions SET branch_mode = ?, initial_branch_name = ?, worktree_path = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(
        changes.branchMode !== undefined ? changes.branchMode : current.branch_mode,
        changes.initialBranchName !== undefined ? changes.initialBranchName : current.initial_branch_name,
        changes.worktreePath !== undefined ? changes.worktreePath : current.worktree_path,
        id,
      );

    return this.get(id);
  }

  appendLog(sessionId: number, output: Buffer): number {
    const result = this.db
      .prepare('INSERT INTO session_logs (session_id, output) VALUES (?, ?)')
      .run(sessionId, output);
    const logId = result.lastInsertRowid as number;
    // Strip terminal control sequences, then index human-readable text in FTS5.
    const text = normalizeTerminalText(output.toString('utf8'))
      .replace(/[^\S\r\n]+/g, ' ')
      .trim();
    if (text) {
      this.db
        .prepare('INSERT INTO session_logs_fts (text, log_id, session_id) VALUES (?, ?, ?)')
        .run(text, logId, sessionId);
    }
    return logId;
  }

  clearLogs(sessionId: number): void {
    this.db.prepare('DELETE FROM session_logs WHERE session_id = ?').run(sessionId);
    this.db.prepare("DELETE FROM session_logs_fts WHERE session_id = ?").run(sessionId);
  }

  /** Returns last `limit` log chunks in chronological order for scrollback replay. */
  getLogs(sessionId: number, limit = 500): Buffer[] {
    return this.getLogsThrough(sessionId, this.getLastLogId(sessionId), limit).map((r) => r.output);
  }

  getLastLogId(sessionId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(id), 0) AS id FROM session_logs WHERE session_id = ?')
      .get(sessionId) as { id: number };
    return row.id;
  }

  getLogsThrough(sessionId: number, throughId: number, limit = 500): SessionLogChunk[] {
    if (throughId <= 0) return [];
    const rows = this.db
      .prepare(
        'SELECT id, output FROM (SELECT id, output FROM session_logs WHERE session_id = ? AND id <= ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC'
      )
      .all(sessionId, throughId, limit) as SessionLogChunk[];
    return rows;
  }

  /** Full-text search across logs for a session. Returns matching snippets. */
  searchLogs(sessionId: number, query: string, limit = 50): { snippet: string; log_id: number }[] {
    if (!query.trim()) return [];
    const rows = this.db
      .prepare(
        `SELECT snippet(session_logs_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet, log_id
         FROM session_logs_fts
         WHERE session_id = ? AND session_logs_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(sessionId, query.trim(), limit) as { snippet: string; log_id: number }[];
    return rows;
  }

  delete(id: number): void {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`Session ${id} not found`);
  }
}
