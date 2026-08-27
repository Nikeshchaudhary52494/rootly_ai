export type EnvironmentType = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  type: EnvironmentType;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyMetadata {
  id: string;
  name: string;
  keyPrefix: string;
  projectId: string;
  environmentId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreated extends ApiKeyMetadata {
  apiKey: string;
  message: string;
}

export interface ErrorEventSummary {
  id: string;
  eventId: string;
  projectId: string;
  environmentId: string;
  serviceName: string;
  environmentName: string;
  release: string | null;
  errorName: string;
  errorMessage: string;
  timestamp: string;
  receivedAt: string;
}

export interface ErrorEventDetail extends ErrorEventSummary {
  apiKeyId: string;
  stackTrace: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}
