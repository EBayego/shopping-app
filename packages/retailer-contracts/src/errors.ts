import type { Retailer } from "@shopping-app/domain";

export interface ProviderErrorOptions {
  message?: string;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly provider: Retailer;

  protected constructor(
    name: string,
    provider: Retailer,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = name;
    this.provider = provider;
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(provider: Retailer, options: ProviderErrorOptions = {}) {
    super(
      "ProviderUnavailableError",
      provider,
      options.message ?? `Provider ${provider} is unavailable`,
      options.cause,
    );
  }
}

export interface RateLimitedErrorOptions extends ProviderErrorOptions {
  retryAfterMs?: number;
}

export class RateLimitedError extends ProviderError {
  readonly retryAfterMs: number | undefined;

  constructor(provider: Retailer, options: RateLimitedErrorOptions = {}) {
    super(
      "RateLimitedError",
      provider,
      options.message ?? `Provider ${provider} rate limit exceeded`,
      options.cause,
    );
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class MarketResolutionError extends ProviderError {
  readonly postalCode: string;

  constructor(
    provider: Retailer,
    postalCode: string,
    options: ProviderErrorOptions = {},
  ) {
    super(
      "MarketResolutionError",
      provider,
      options.message ??
        `Provider ${provider} could not resolve market for postal code ${postalCode}`,
      options.cause,
    );
    this.postalCode = postalCode;
  }
}

export class ProductNotFoundError extends ProviderError {
  readonly externalId: string;

  constructor(
    provider: Retailer,
    externalId: string,
    options: ProviderErrorOptions = {},
  ) {
    super(
      "ProductNotFoundError",
      provider,
      options.message ??
        `Provider ${provider} could not find product ${externalId}`,
      options.cause,
    );
    this.externalId = externalId;
  }
}

export class ProviderContractChangedError extends ProviderError {
  constructor(provider: Retailer, options: ProviderErrorOptions = {}) {
    super(
      "ProviderContractChangedError",
      provider,
      options.message ?? `Provider ${provider} contract has changed`,
      options.cause,
    );
  }
}

export class ProviderCapabilityUnavailableError extends ProviderError {
  readonly capability: string;

  constructor(
    provider: Retailer,
    capability: string,
    options: ProviderErrorOptions = {},
  ) {
    super(
      "ProviderCapabilityUnavailableError",
      provider,
      options.message ??
        `Provider ${provider} does not support capability ${capability}`,
      options.cause,
    );
    this.capability = capability;
  }
}
