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

export type IncidentStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export interface IncidentRef {
  id: string;
  sequenceNumber: number;
  status: IncidentStatus;
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
  incident: IncidentRef | null;
}

export interface ErrorEventDetail extends ErrorEventSummary {
  apiKeyId: string;
  stackTrace: string | null;
  fingerprint: string;
  metadata: unknown;
  createdAt: string;
}

export interface IncidentSummary {
  id: string;
  sequenceNumber: number;
  title: string;
  errorName: string;
  errorMessage: string;
  status: IncidentStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  environment: { id: string; name: string };
}

export interface IncidentDetail {
  id: string;
  projectId: string;
  environmentId: string;
  sequenceNumber: number;
  fingerprint: string;
  title: string;
  errorName: string;
  errorMessage: string;
  status: IncidentStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  latestEventId: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  environment: { id: string; name: string };
  latestEvent: ErrorEventDetail | null;
  recentEvents: ErrorEventDetail[];
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}
