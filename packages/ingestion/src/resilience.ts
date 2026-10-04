import {
  ProviderAccessBlockedError,
  ProviderUnavailableError,
  RateLimitedError,
} from "@shopping-app/retailer-contracts";

import type {
  CircuitBreakerOptions,
  IngestionOptions,
  RetryOptions,
  StructuredLogger,
} from "./types.js";

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 10_000,
  jitterRatio: 0.2,
};
const DEFAULT_BREAKER: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetAfterMs: 30_000,
};

export class CircuitOpenError extends Error {
  constructor(readonly provider: string) {
    super(`Circuit breaker is open for provider ${provider}`);
    this.name = "CircuitOpenError";
  }
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

interface CircuitState {
  failures: number;
  openedAt?: number;
}

export class ProviderExecutor {
  private readonly semaphore: Semaphore;
  private readonly circuit: CircuitState = { failures: 0 };

  constructor(
    private readonly provider: string,
    concurrency: number,
    private readonly retry: RetryOptions,
    private readonly breaker: CircuitBreakerOptions,
    private readonly logger: StructuredLogger,
    private readonly now: () => Date,
    private readonly sleep: (milliseconds: number) => Promise<void>,
    private readonly random: () => number,
  ) {
    this.semaphore = new Semaphore(concurrency);
  }

  run<T>(operation: string, action: () => Promise<T>): Promise<T> {
    return this.semaphore.run(() => this.runWithRetry(operation, action));
  }

  private async runWithRetry<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    this.assertCircuitClosed();
    let attempt = 0;
    while (attempt < this.retry.maxAttempts) {
      attempt += 1;
      try {
        const result = await action();
        this.circuit.failures = 0;
        delete this.circuit.openedAt;
        return result;
      } catch (error) {
        if (error instanceof ProviderAccessBlockedError) {
          this.recordFailure();
          throw error;
        }
        if (!isTransientProviderError(error)) throw error;
        // Retries belong to one operation. A recovered attempt must not open
        // the circuit and prevent unrelated products from being refreshed.
        if (attempt >= this.retry.maxAttempts) {
          this.recordFailure();
          throw error;
        }
        const delayMs = retryDelay(error, attempt, this.retry, this.random);
        this.logger.warn("provider.retry", {
          provider: this.provider,
          operation,
          attempt,
          delayMs,
          error: safeError(error),
        });
        await this.sleep(delayMs);
        this.assertCircuitClosed();
      }
    }
    throw new Error("Retry loop exhausted unexpectedly");
  }

  private assertCircuitClosed(): void {
    if (this.circuit.openedAt === undefined) return;
    const elapsed = this.now().getTime() - this.circuit.openedAt;
    if (elapsed >= this.breaker.resetAfterMs) {
      delete this.circuit.openedAt;
      this.circuit.failures = 0;
      return;
    }
    throw new CircuitOpenError(this.provider);
  }

  private recordFailure(): void {
    this.circuit.failures += 1;
    if (this.circuit.failures >= this.breaker.failureThreshold) {
      this.circuit.openedAt = this.now().getTime();
    }
  }
}

export function createProviderExecutor(
  provider: string,
  options: IngestionOptions,
  logger: StructuredLogger,
  now: () => Date,
): ProviderExecutor {
  const concurrency = options.providerConcurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("providerConcurrency must be a positive integer");
  }
  return new ProviderExecutor(
    provider,
    concurrency,
    { ...DEFAULT_RETRY, ...options.retry },
    { ...DEFAULT_BREAKER, ...options.circuitBreaker },
    logger,
    now,
    options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds))),
    options.random ?? Math.random,
  );
}

export function isTransientProviderError(error: unknown): boolean {
  return (
    error instanceof RateLimitedError ||
    (error instanceof ProviderUnavailableError &&
      !(error instanceof ProviderAccessBlockedError))
  );
}

function retryDelay(
  error: unknown,
  attempt: number,
  options: RetryOptions,
  random: () => number,
): number {
  if (error instanceof RateLimitedError && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, options.maxDelayMs);
  }
  const exponential = Math.min(
    options.maxDelayMs,
    options.initialDelayMs * 2 ** (attempt - 1),
  );
  const jitter = exponential * options.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

export function safeError(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  // Inspect only typed transport fields. Cause messages, URLs, response
  // bodies and session/header values can contain credentials.
  while (pending.length > 0 && seen.size < 8) {
    const cause = pending.shift();
    if (typeof cause !== "object" || cause === null || seen.has(cause))
      continue;
    seen.add(cause);
    const details = cause as Record<string, unknown>;
    if (
      result.httpStatus === undefined &&
      typeof details.status === "number" &&
      Number.isInteger(details.status) &&
      details.status >= 100 &&
      details.status <= 599
    )
      result.httpStatus = details.status;
    if (
      result.transportKind === undefined &&
      typeof details.kind === "string" &&
      ["aborted", "http", "invalid-response", "network"].includes(details.kind)
    )
      result.transportKind = details.kind;
    if (
      result.networkCode === undefined &&
      typeof details.code === "string" &&
      /^(?:E[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(details.code)
    )
      result.networkCode = details.code;
    pending.push(details.cause);
    if (cause instanceof AggregateError) {
      const errors: readonly unknown[] = cause.errors;
      pending.push(...errors.slice(0, 4));
    }
  }
  return result;
}
