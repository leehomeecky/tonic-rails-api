/**
 * Minimal circuit breaker: after `threshold` consecutive failures the circuit
 * opens for `openMs`, then allows a trial call (half-open).
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly threshold: number,
    private readonly openMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.threshold) {
      this.openUntil = this.now() + this.openMs;
      this.consecutiveFailures = 0;
    }
  }
}
