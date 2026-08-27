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
