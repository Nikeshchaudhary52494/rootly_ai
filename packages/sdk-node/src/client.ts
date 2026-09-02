import type { ErrorEventPayload, RootlyAIConfig } from './types';
import { HttpTransport, type Transport } from './transport/http.transport';
import { Logger } from './utils/logger';

const DEFAULT_SERVER_URL = 'http://localhost:3001';

export class RootlyAIClient {
  readonly logger: Logger;
  private readonly transport: Transport;
  private readonly enabled: boolean;

  constructor(config: RootlyAIConfig) {
    this.logger = new Logger(config.debug ?? false);
    this.enabled = config.enabled ?? true;
    this.transport = new HttpTransport(
      config.serverUrl ?? DEFAULT_SERVER_URL,
      config.apiKey,
      this.logger,
    );
  }

  async send(payload: ErrorEventPayload): Promise<void> {
    if (!this.enabled) return;
    this.logger.log(`Sending event: ${payload.eventId}`);
    await this.transport.send(payload);
  }
}
