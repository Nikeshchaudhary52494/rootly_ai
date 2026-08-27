export class Logger {
  constructor(private readonly enabled: boolean) {}

  log(message: string): void {
    if (this.enabled) console.log(`[Incident AI] ${message}`);
  }

  warn(message: string): void {
    if (this.enabled) console.warn(`[Incident AI] ${message}`);
  }
}
