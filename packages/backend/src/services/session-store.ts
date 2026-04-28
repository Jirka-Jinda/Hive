import type Database from 'better-sqlite3';

export type SessionBranchMode = 'new' | 'existing';

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
  created_at: string;
  updated_at: string;
}

export interface SessionWithGitStatus extends Session {
  current_branch: string | null;
  head_ref: string | null;
  is_detached: boolean;
}

export class SessionStore {
  constructor(private db: Database.Database) {}

  listAll(): Session[] {
    return this.db
      .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
      .all() as Session[];
  }

  list(repoId: number): Session[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE repo_id = ? ORDER BY created_at DESC')
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
    const result = this.db
      .prepare(
        'INSERT INTO sessions (repo_id, agent_type, name, credential_id, branch_mode, initial_branch_name, worktree_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
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

  update(id: number, changes: { name?: string }): Session {
    const current = this.get(id);
    const nextName = changes.name?.trim() ?? current.name;
    if (!nextName) throw new Error('Session name is required');

    this.db
      .prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nextName, id);

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

  appendLog(sessionId: number, output: Buffer): void {
    this.db
      .prepare('INSERT INTO session_logs (session_id, output) VALUES (?, ?)')
      .run(sessionId, output);
  }

  clearLogs(sessionId: number): void {
    this.db.prepare('DELETE FROM session_logs WHERE session_id = ?').run(sessionId);
  }

  /** Returns last `limit` log chunks in chronological order for scrollback replay. */
  getLogs(sessionId: number, limit = 500): Buffer[] {
    const rows = this.db
      .prepare(
        'SELECT output FROM (SELECT output, id FROM session_logs WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC'
      )
      .all(sessionId, limit) as { output: Buffer }[];
    return rows.map((r) => r.output);
  }

  delete(id: number): void {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`Session ${id} not found`);
  }
}
