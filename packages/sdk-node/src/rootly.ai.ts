import { IncidentAIClient } from './client';
import { buildErrorEvent } from './capture/error.capture';
import type { IncidentAIConfig } from './types';

const DEFAULT_SERVER_URL = 'http://localhost:3001';

export class IncidentAI {
  private readonly client: IncidentAIClient;
  private readonly config: Required<Pick<IncidentAIConfig, 'serverUrl' | 'enabled'>> & IncidentAIConfig;
  private initialized = false;

  constructor(config: IncidentAIConfig) {
    if (!config.apiKey) throw new Error('[Incident AI] apiKey is required');
    if (!config.serviceName) throw new Error('[Incident AI] serviceName is required');
    if (!config.environment) throw new Error('[Incident AI] environment is required');

    this.config = {
      serverUrl: DEFAULT_SERVER_URL,
      enabled: true,
      ...config,
    };
    this.client = new IncidentAIClient(this.config);
  }

  /** Wires up automatic process-level capture. Safe to call more than once. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    process.on('uncaughtException', (error) => {
      this.captureException(error);
    });

    process.on('unhandledRejection', (reason) => {
      this.captureException(reason);
    });

    this.client.logger.log('Initialized');
  }

  captureException(error: unknown): void {
    this.client.logger.log('Captured exception');
    const payload = buildErrorEvent(error, this.config);
    // Fire-and-forget: HttpTransport never throws, so this never rejects.
    void this.client.send(payload);
  }

  captureMessage(message: string): void {
    this.client.logger.log('Captured message');
    const payload = buildErrorEvent({ name: 'Message', message }, this.config);
    void this.client.send(payload);
  }
}
