import type {
  ApiKeyCreated,
  ApiKeyMetadata,
  Environment,
  EnvironmentType,
  ErrorEventDetail,
  ErrorEventSummary,
  Paginated,
  Project,
} from '@incident-ai/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listProjects: () => request<Project[]>('/projects'),
  getProject: (projectId: string) => request<Project>(`/projects/${projectId}`),
  createProject: (data: { name: string; slug: string; description?: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  listEnvironments: (projectId: string) =>
    request<Environment[]>(`/projects/${projectId}/environments`),
  getEnvironment: (projectId: string, environmentId: string) =>
    request<Environment>(`/projects/${projectId}/environments/${environmentId}`),
  createEnvironment: (
    projectId: string,
    data: { name: string; slug: string; type: EnvironmentType },
  ) =>
    request<Environment>(`/projects/${projectId}/environments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listApiKeys: (projectId: string, environmentId: string) =>
    request<ApiKeyMetadata[]>(
      `/projects/${projectId}/environments/${environmentId}/api-keys`,
    ),
  createApiKey: (projectId: string, environmentId: string, name: string) =>
    request<ApiKeyCreated>(
      `/projects/${projectId}/environments/${environmentId}/api-keys`,
      { method: 'POST', body: JSON.stringify({ name }) },
    ),
  revokeApiKey: (apiKeyId: string) =>
    request<ApiKeyMetadata>(`/api-keys/${apiKeyId}/revoke`, { method: 'POST' }),

  listEvents: (
    projectId: string,
    params: { environmentId?: string; limit?: number; offset?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.environmentId) query.set('environmentId', params.environmentId);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return request<Paginated<ErrorEventSummary>>(
      `/projects/${projectId}/events${qs ? `?${qs}` : ''}`,
    );
  },
  getEvent: (eventId: string) => request<ErrorEventDetail>(`/events/${eventId}`),
};
