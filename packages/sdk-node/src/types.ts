export interface RootlyAIConfig {
  apiKey: string;
  serverUrl?: string;
  serviceName: string;
  environment: string;
  release?: string;
  debug?: boolean;
  enabled?: boolean;
}

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

export interface ErrorEventPayload {
  eventId: string;
  timestamp: string;
  service: {
    name: string;
    environment: string;
    release?: string;
  };
  error: NormalizedError;
}
