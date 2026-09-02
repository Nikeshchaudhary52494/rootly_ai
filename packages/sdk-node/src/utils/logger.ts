export class Logger {
  constructor(private readonly enabled: boolean) {}

  log(message: string): void {
    if (this.enabled) console.log(`[rootly.ai] ${message}`);
  }

  warn(message: string): void {
    if (this.enabled) console.warn(`[rootly.ai] ${message}`);
  }
}
