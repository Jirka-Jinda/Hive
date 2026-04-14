export interface AuthSettings {
  enabled: boolean;
  /** Base64-encoded 4-digit PIN */
  pin: string;
}

export interface AppSettings {
  reposDir: string;
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

// Shared types mirroring backend DB models
export interface Repo {
  id: number;
  name: string;
  path: string;
  source: 'local' | 'git';
  git_url: string | null;
  created_at: string;
}

export interface Session {
  id: number;
  repo_id: number;
  agent_type: string;
  credential_id: number | null;
  name: string;
  status: 'running' | 'stopped';
  state: 'working' | 'idle' | 'stopped';
  created_at: string;
  updated_at: string;
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
  type: 'skill' | 'tool' | 'instruction' | 'other';
  created_at: string;
  updated_at: string;
}

// Helper
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  repos: {
    list: () => request<Repo[]>('/repos'),
    discover: () => request<{ name: string; path: string }[]>('/repos/discovered'),
    create: (body: { path?: string; gitUrl?: string; name?: string }) =>
      request<Repo>('/repos', { method: 'POST', body: JSON.stringify(body) }),
    delete: (id: number, deleteFromDisk = false) =>
      request<{ ok: boolean }>(`/repos/${id}?deleteFromDisk=${deleteFromDisk}`, { method: 'DELETE' }),

    sessions: {
      list: (repoId: number) => request<Session[]>(`/repos/${repoId}/sessions`),
      create: (repoId: number, body: { name: string; agentType: string; credentialId?: number }) =>
        request<Session>(`/repos/${repoId}/sessions`, { method: 'POST', body: JSON.stringify(body) }),
      delete: (repoId: number, sid: number) =>
        request<{ ok: boolean }>(`/repos/${repoId}/sessions/${sid}`, { method: 'DELETE' }),

      mdRefs: {
        get: (repoId: number, sid: number) =>
          request<MdFile[]>(`/repos/${repoId}/sessions/${sid}/md-refs`),
        set: (repoId: number, sid: number, mdFileIds: number[]) =>
          request<{ ok: boolean }>(`/repos/${repoId}/sessions/${sid}/md-refs`, {
            method: 'PUT',
            body: JSON.stringify({ mdFileIds }),
          }),
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
      type?: string;
    }) => request<MdFile>('/mdfiles', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, content: string) =>
      request<MdFile>(`/mdfiles/${id}`, { method: 'PUT', body: JSON.stringify({ content }) }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/mdfiles/${id}`, { method: 'DELETE' }),
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
};
