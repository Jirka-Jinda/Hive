export interface AuthSettings {
  enabled: boolean;
  /** Base64-encoded 4-digit PIN */
  pin: string;
}

export interface AppSettings {
  reposDir: string;
  centralMdDir: string;
  auth: AuthSettings;
}

export type PipelinePhase = 'session-start' | 'user-input' | 'agent-output';

export interface PipelineNodeDto {
  id: string;
  name: string;
  description: string;
  phases: PipelinePhase[];
  enabled: boolean;
}

export interface UsageTotals {
  context_tokens: number;
  input_tokens: number;
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
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

// Shared types mirroring backend DB models
export interface Repo {
  id: number;
  name: string;
  path: string;
  source: 'local' | 'git';
  git_url: string | null;
  created_at: string;
  session_count?: number;
  is_git_repo: boolean;
}

export type SessionBranchMode = 'new' | 'existing' | 'root';

export interface Session {
  id: number;
  repo_id: number;
  agent_type: string;
  credential_id: number | null;
  name: string;
  status: 'running' | 'stopped';
  state: 'working' | 'idle' | 'stopped';
  branch_mode?: SessionBranchMode | null;
  initial_branch_name?: string | null;
  worktree_path?: string | null;
  current_branch?: string | null;
  head_ref?: string | null;
  is_detached?: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GitBranchOption {
  name: string;
  in_use: boolean;
  worktree_path: string | null;
  is_main_worktree: boolean;
  session_id: number | null;
  session_name: string | null;
  disabled_reason: string | null;
  is_remote: boolean;
}

export interface GitStatus {
  branch: string | null;
  head_ref: string | null;
  is_detached: boolean;
  worktree_path: string;
  repo_path: string;
}

export interface GitHistoryEntry {
  hash: string;
  short_hash: string;
  subject: string;
  author_name: string;
  authored_at: string;
  refs: string[];
}

export type GitChangeStatus = 'M' | 'A' | 'D' | 'R' | '?';

export interface GitChangedFile {
  path: string;
  status: GitChangeStatus;
}

export interface GitFileDiff {
  path: string;
  status: GitChangeStatus;
  original: string;
  modified: string;
}

export interface Credential {
  id: number;
  name: string;
  agent_type: string;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  credentialFields: { key: string; label: string; secret: boolean }[];
}

export interface MdFile {
  id: number;
  scope: 'central' | 'repo';
  repo_id: number | null;
  path: string;
  type: 'skill' | 'tool' | 'instruction' | 'prompt' | 'other';
  created_at: string;
  updated_at: string;
}

export interface SessionAgentFile {
  agentRelativePath: string;
  repoRelativePath: string;
}

export interface MdFileUpdateBody {
  content?: string;
  scope?: MdFile['scope'];
  repoPath?: string;
  filename?: string;
  type?: MdFile['type'];
}

export interface ParamDef {
  name: string;
  type: 'text' | 'repo' | 'session';
  default?: string;
  description?: string;
}

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

// Helper
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Unexpected response type "${contentType}" for ${path}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  repos: {
    list: () => request<Repo[]>('/repos'),
    discover: () => request<{ name: string; path: string }[]>('/repos/discovered'),
    create: (body: { path?: string; gitUrl?: string; name?: string }) =>
      request<Repo>('/repos', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name: string }) =>
      request<Repo>(`/repos/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: number, deleteFromDisk = false) =>
      request<{ ok: boolean }>(`/repos/${id}?deleteFromDisk=${deleteFromDisk}`, { method: 'DELETE' }),

    sessions: {
      list: (repoId: number) => request<Session[]>(`/repos/${repoId}/sessions`),
      create: (repoId: number, body: { name: string; agentType: string; credentialId?: number; branchMode?: SessionBranchMode; branchName?: string }) =>
        request<Session>(`/repos/${repoId}/sessions`, { method: 'POST', body: JSON.stringify(body) }),
      update: (repoId: number, sid: number, body: { name: string }) =>
        request<Session>(`/repos/${repoId}/sessions/${sid}`, { method: 'PUT', body: JSON.stringify(body) }),
      delete: (repoId: number, sid: number) =>
        request<{ ok: boolean }>(`/repos/${repoId}/sessions/${sid}`, { method: 'DELETE' }),
      restart: (repoId: number, sid: number) =>
        request<Session>(`/repos/${repoId}/sessions/${sid}/restart`, { method: 'POST' }),
      reorder: (repoId: number, orderedIds: number[]) =>
        request<{ ok: boolean }>(`/repos/${repoId}/sessions/reorder`, { method: 'PUT', body: JSON.stringify({ orderedIds }) }),

      agentFiles: {
        list: (repoId: number, sid: number) =>
          request<SessionAgentFile[]>(`/repos/${repoId}/sessions/${sid}/agent-files`),
        promote: (repoId: number, sid: number, agentRelativePath: string) =>
          request<MdFile>(`/repos/${repoId}/sessions/${sid}/agent-files/promote`, {
            method: 'POST',
            body: JSON.stringify({ agentRelativePath }),
          }),
      },

      mdRefs: {
        get: (repoId: number, sid: number) =>
          request<MdFile[]>(`/repos/${repoId}/sessions/${sid}/md-refs`),
        set: (repoId: number, sid: number, mdFileIds: number[]) =>
          request<{ ok: boolean }>(`/repos/${repoId}/sessions/${sid}/md-refs`, {
            method: 'PUT',
            body: JSON.stringify({ mdFileIds }),
          }),
      },
      inject: (repoId: number, sid: number, text: string) =>
        request<{ ok: boolean }>(`/repos/${repoId}/sessions/${sid}/inject`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        }),
      logs: {
        search: (repoId: number, sid: number, q: string) => {
          const params = new URLSearchParams({ q });
          return request<{ snippet: string; log_id: number }[]>(`/repos/${repoId}/sessions/${sid}/logs/search?${params.toString()}`);
        },
      },
    },

    mdRefs: {
      get: (repoId: number) =>
        request<MdFile[]>(`/repos/${repoId}/md-refs`),
      set: (repoId: number, mdFileIds: number[]) =>
        request<{ ok: boolean }>(`/repos/${repoId}/md-refs`, {
          method: 'PUT',
          body: JSON.stringify({ mdFileIds }),
        }),
    },

    git: {
      branches: {
        list: (repoId: number, query?: string) => {
          const params = new URLSearchParams();
          if (query?.trim()) params.set('q', query.trim());
          const qs = params.toString();
          return request<GitBranchOption[]>(`/repos/${repoId}/git/branches${qs ? `?${qs}` : ''}`);
        },
        fetchRemotes: (repoId: number) =>
          request<{ ok: boolean }>(`/repos/${repoId}/git/fetch-remotes`, { method: 'POST' }),
      },
      status: (repoId: number, sessionId?: number) => {
        const params = new URLSearchParams();
        if (sessionId !== undefined) params.set('sessionId', String(sessionId));
        const qs = params.toString();
        return request<GitStatus | null>(`/repos/${repoId}/git/status${qs ? `?${qs}` : ''}`);
      },
      history: (repoId: number, options?: { sessionId?: number; limit?: number }) => {
        const params = new URLSearchParams();
        if (options?.sessionId !== undefined) params.set('sessionId', String(options.sessionId));
        if (options?.limit !== undefined) params.set('limit', String(options.limit));
        const qs = params.toString();
        return request<GitHistoryEntry[]>(`/repos/${repoId}/git/history${qs ? `?${qs}` : ''}`);
      },
      commit: (repoId: number, body: { message: string; sessionId?: number }) =>
        request<{ commit: string }>(`/repos/${repoId}/git/commit`, { method: 'POST', body: JSON.stringify(body) }),
      push: (repoId: number, body: { sessionId?: number; remote?: string; branch?: string }) =>
        request<{ ok: boolean }>(`/repos/${repoId}/git/push`, { method: 'POST', body: JSON.stringify(body) }),
      fetchPull: (repoId: number, body: { sessionId?: number; remote?: string; branch?: string }) =>
        request<{ ok: boolean }>(`/repos/${repoId}/git/fetch-pull`, { method: 'POST', body: JSON.stringify(body) }),
      changedFiles: (repoId: number, sessionId?: number) => {
        const params = new URLSearchParams();
        if (sessionId !== undefined) params.set('sessionId', String(sessionId));
        const qs = params.toString();
        return request<GitChangedFile[]>(`/repos/${repoId}/git/changed-files${qs ? `?${qs}` : ''}`);
      },
      diff: (repoId: number, path: string, sessionId?: number) => {
        const params = new URLSearchParams({ path });
        if (sessionId !== undefined) params.set('sessionId', String(sessionId));
        return request<GitFileDiff>(`/repos/${repoId}/git/diff?${params.toString()}`);
      },
    },
  },

  credentials: {
    list: () => request<Credential[]>('/credentials'),
    create: (body: { name: string; agentType: string; data: { envVars: Record<string, string> } }) =>
      request<Credential>('/credentials', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name: string; agentType: string; data: { envVars: Record<string, string> } }) =>
      request<Credential>(`/credentials/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/credentials/${id}`, { method: 'DELETE' }),
  },

  agents: {
    list: () => request<Agent[]>('/agents'),
  },

  mdfiles: {
    list: (scope?: string, repoId?: number) => {
      const params = new URLSearchParams();
      if (scope) params.set('scope', scope);
      if (repoId !== undefined) params.set('repoId', String(repoId));
      const qs = params.toString();
      return request<MdFile[]>(`/mdfiles${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => request<MdFile & { content: string }>(`/mdfiles/${id}`),
    create: (body: {
      scope: 'central' | 'repo';
      repoPath?: string;
      filename: string;
      content: string;
      type?: MdFile['type'];
    }) => request<MdFile>('/mdfiles', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: MdFileUpdateBody) =>
      request<MdFile>(`/mdfiles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/mdfiles/${id}`, { method: 'DELETE' }),
    params: (id: number) =>
      request<{ name: string; description: string; params: ParamDef[] }>(`/mdfiles/${id}/params`),
    render: (id: number, params: Record<string, string>) =>
      request<{ rendered: string }>(`/mdfiles/${id}/render`, {
        method: 'POST',
        body: JSON.stringify({ params }),
      }),
  },

  settings: {
    get: () => request<AppSettings>('/settings'),
    update: (body: Partial<AppSettings>) =>
      request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  },

  pipeline: {
    list: () => request<PipelineNodeDto[]>('/pipeline'),
    setEnabled: (id: string, enabled: boolean) =>
      request<PipelineNodeDto[]>(`/pipeline/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  },

  tools: {
    status: () => request<{ tools: { id: string; name: string; command: string; installed: boolean }[]; anyMissing: boolean }>('/tools'),
    /** Returns an EventSource-compatible URL for streaming install output */
    installUrl: () => '/api/tools/install',
  },

  automation: {
    list: () => request<AutomationTask[]>('/automation'),
    create: (body: { name: string; md_file_id: number; session_id: number; cron: string; params?: Record<string, string> }) =>
      request<AutomationTask>('/automation', { method: 'POST', body: JSON.stringify(body) }),
    pause: (id: number) => request<AutomationTask>(`/automation/${id}/pause`, { method: 'PUT' }),
    resume: (id: number) => request<AutomationTask>(`/automation/${id}/resume`, { method: 'PUT' }),
    delete: (id: number) => request<{ ok: boolean }>(`/automation/${id}`, { method: 'DELETE' }),
  },

  usage: {
    summary: (repoId?: number) => {
      const params = new URLSearchParams();
      if (repoId !== undefined) params.set('repoId', String(repoId));
      const qs = params.toString();
      return request<UsageSummary>(`/usage${qs ? `?${qs}` : ''}`);
    },
  },

  logs: {
    errors: () => request<AppErrorLog[]>('/logs/errors'),
    actions: () => request<UserActionLog[]>('/logs/actions'),
  },
};
