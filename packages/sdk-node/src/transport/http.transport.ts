import type { ErrorEventPayload } from '../types';
import type { Logger } from '../utils/logger';

const SEND_TIMEOUT_MS = 5000;

/** Kept narrow on purpose so a future batching/retry transport can implement the same interface. */
export interface Transport {
  send(payload: ErrorEventPayload): Promise<boolean>;
}

export class HttpTransport implements Transport {
  constructor(
    private readonly serverUrl: string,
    private readonly apiKey: string,
    private readonly logger: Logger,
  ) {}

  async send(payload: ErrorEventPayload): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.serverUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn('Failed to send event');
        return false;
      }

      this.logger.log('Event sent successfully');
      return true;
    } catch {
      this.logger.warn('Failed to send event');
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
