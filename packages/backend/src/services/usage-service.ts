import type Database from 'better-sqlite3';

export interface UsageTotals {
  context_tokens: number;
  input_tokens: number;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface UsageSessionContext {
  sessionId: number;
  repoId: number;
  agentType: string;
  credentialId: number | null;
}

export interface SessionUsageRow extends UsageTotals {
  session_id: number;
  repo_id: number;
  repo_name: string;
  session_name: string;
  agent_type: string;
  credential_id: number | null;
  credential_name: string;
  status: 'running' | 'stopped';
  state: 'working' | 'idle' | 'stopped';
  updated_at: string;
}

export interface AgentUsageRow extends UsageTotals {
  agent_type: string;
}

export interface CredentialUsageRow extends UsageTotals {
  credential_key: string;
  credential_id: number | null;
  credential_name: string;
}

export interface UsageSummary {
  repo_id: number | null;
  totals: UsageTotals;
  sessions: SessionUsageRow[];
  by_agent: AgentUsageRow[];
  by_credential: CredentialUsageRow[];
}

export interface UsageDelta {
  contextTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function zeroTotals(): UsageTotals {
  return {
    context_tokens: 0,
    input_tokens: 0,
    prompt_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

function buildCredentialKey(credentialId: number | null): string {
  return credentialId === null ? 'none' : `credential:${credentialId}`;
}

export class UsageService {
  private readonly upsertSession;
  private readonly upsertRollup;
  private readonly getCredentialName;

  constructor(private readonly db: Database.Database) {
    this.upsertSession = this.db.prepare(`
      INSERT INTO session_usage_totals (
        session_id,
        context_tokens,
        input_tokens,
        prompt_tokens,
        output_tokens,
        total_tokens,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        context_tokens = session_usage_totals.context_tokens + excluded.context_tokens,
        input_tokens = session_usage_totals.input_tokens + excluded.input_tokens,
        prompt_tokens = session_usage_totals.prompt_tokens + excluded.prompt_tokens,
        output_tokens = session_usage_totals.output_tokens + excluded.output_tokens,
        total_tokens = session_usage_totals.total_tokens + excluded.total_tokens,
        updated_at = datetime('now')
    `);

    this.upsertRollup = this.db.prepare(`
      INSERT INTO repo_usage_rollups (
        repo_id,
        agent_type,
        credential_key,
        credential_id,
        credential_name,
        context_tokens,
        input_tokens,
        prompt_tokens,
        output_tokens,
        total_tokens,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(repo_id, agent_type, credential_key) DO UPDATE SET
        credential_id = excluded.credential_id,
        credential_name = excluded.credential_name,
        context_tokens = repo_usage_rollups.context_tokens + excluded.context_tokens,
        input_tokens = repo_usage_rollups.input_tokens + excluded.input_tokens,
        prompt_tokens = repo_usage_rollups.prompt_tokens + excluded.prompt_tokens,
        output_tokens = repo_usage_rollups.output_tokens + excluded.output_tokens,
        total_tokens = repo_usage_rollups.total_tokens + excluded.total_tokens,
        updated_at = datetime('now')
    `);

    this.getCredentialName = this.db.prepare('SELECT name FROM credentials WHERE id = ?');
  }

  increment(context: UsageSessionContext, delta: UsageDelta): void {
    const contextTokens = Math.max(0, delta.contextTokens ?? 0);
    const inputTokens = Math.max(0, delta.inputTokens ?? 0);
    const outputTokens = Math.max(0, delta.outputTokens ?? 0);
    const promptTokens = contextTokens + inputTokens;
    const totalTokens = promptTokens + outputTokens;

    if (totalTokens === 0) return;

    const credentialKey = buildCredentialKey(context.credentialId);
    const credentialName = this.resolveCredentialName(context.credentialId);

    this.db.transaction(() => {
      this.upsertSession.run(
        context.sessionId,
        contextTokens,
        inputTokens,
        promptTokens,
        outputTokens,
        totalTokens,
      );
      this.upsertRollup.run(
        context.repoId,
        context.agentType,
        credentialKey,
        context.credentialId,
        credentialName,
        contextTokens,
        inputTokens,
        promptTokens,
        outputTokens,
        totalTokens,
      );
    })();
  }

  getSummary(repoId?: number): UsageSummary {
    return {
      repo_id: repoId ?? null,
      totals: this.getTotals(repoId),
      sessions: this.listSessions(repoId),
      by_agent: this.listByAgent(repoId),
      by_credential: this.listByCredential(repoId),
    };
  }

  private getTotals(repoId?: number): UsageTotals {
    const where = repoId === undefined ? '' : 'WHERE repo_id = ?';
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(context_tokens), 0) AS context_tokens,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM repo_usage_rollups
      ${where}
    `).get(...(repoId === undefined ? [] : [repoId])) as UsageTotals | undefined;

    return row ?? zeroTotals();
  }

  private listSessions(repoId?: number): SessionUsageRow[] {
    const rows = this.db.prepare(`
      SELECT
        sut.session_id,
        s.repo_id,
        r.name AS repo_name,
        s.name AS session_name,
        s.agent_type,
        s.credential_id,
        COALESCE(c.name, 'No credential') AS credential_name,
        s.status,
        s.state,
        sut.context_tokens,
        sut.input_tokens,
        sut.prompt_tokens,
        sut.output_tokens,
        sut.total_tokens,
        sut.updated_at
      FROM session_usage_totals sut
      JOIN sessions s ON s.id = sut.session_id
      JOIN repos r ON r.id = s.repo_id
      LEFT JOIN credentials c ON c.id = s.credential_id
      ${repoId === undefined ? '' : 'WHERE s.repo_id = ?'}
      ORDER BY sut.total_tokens DESC, sut.updated_at DESC
    `).all(...(repoId === undefined ? [] : [repoId])) as SessionUsageRow[];

    return rows;
  }

  private listByAgent(repoId?: number): AgentUsageRow[] {
    const rows = this.db.prepare(`
      SELECT
        agent_type,
        COALESCE(SUM(context_tokens), 0) AS context_tokens,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM repo_usage_rollups
      ${repoId === undefined ? '' : 'WHERE repo_id = ?'}
      GROUP BY agent_type
      ORDER BY total_tokens DESC, agent_type ASC
    `).all(...(repoId === undefined ? [] : [repoId])) as AgentUsageRow[];

    return rows;
  }

  private listByCredential(repoId?: number): CredentialUsageRow[] {
    const rows = this.db.prepare(`
      SELECT
        credential_key,
        MAX(credential_id) AS credential_id,
        MAX(credential_name) AS credential_name,
        COALESCE(SUM(context_tokens), 0) AS context_tokens,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM repo_usage_rollups
      ${repoId === undefined ? '' : 'WHERE repo_id = ?'}
      GROUP BY credential_key
      ORDER BY total_tokens DESC, credential_name ASC
    `).all(...(repoId === undefined ? [] : [repoId])) as CredentialUsageRow[];

    return rows;
  }

  private resolveCredentialName(credentialId: number | null): string {
    if (credentialId === null) return 'No credential';
    const row = this.getCredentialName.get(credentialId) as { name: string } | undefined;
    return row?.name ?? `Credential ${credentialId}`;
  }
}