import type { MercadonaMarketContext } from "./mercadona-market-context.js";
import {
  parseMercadonaMarketBody,
  type MercadonaMarketDto,
} from "./mercadona-dtos.js";

const DEFAULT_BASE_URL = "https://tienda.mercadona.es/api/";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type MercadonaHttpErrorKind =
  "aborted" | "http" | "invalid-response" | "network";

export class MercadonaHttpError extends Error {
  constructor(
    readonly kind: MercadonaHttpErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MercadonaHttpError";
  }
}

export interface MercadonaHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetch?: typeof fetch;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class MercadonaHttpClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: MercadonaHttpClientOptions = {}) {
    const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
    this.baseUrl = baseUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 200;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.random = options.random ?? Math.random;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async changePostalCode(postalCode: string): Promise<MercadonaMarketDto> {
    const response = await this.request(
      new URL("postal-codes/actions/change-pc/", this.baseUrl),
      {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ new_postal_code: postalCode }),
      },
    );
    const payload = await this.readJson(response, "market");
    const body = parseMercadonaMarketBody(payload);
    const warehouse = this.nonEmptyHeader(response.headers, "x-customer-wh");
    const resolvedPostalCode = this.nonEmptyHeader(
      response.headers,
      "x-customer-pc",
    );
    if (
      body === undefined ||
      warehouse === undefined ||
      resolvedPostalCode === undefined
    ) {
      throw new MercadonaHttpError(
        "invalid-response",
        "Mercadona market response is incompatible",
        response.status,
      );
    }
    return { ...body, warehouse, postalCode: resolvedPostalCode };
  }

  getCategories(context: MercadonaMarketContext): Promise<unknown> {
    return this.getJson("categories/", "categories", context);
  }

  getCategory(
    categoryId: string,
    context: MercadonaMarketContext,
  ): Promise<unknown> {
    return this.getJson(
      `categories/${encodeURIComponent(categoryId)}/`,
      "category",
      context,
    );
  }

  getProduct(
    productId: string,
    context: MercadonaMarketContext,
  ): Promise<unknown> {
    return this.getJson(
      `products/${encodeURIComponent(productId)}/`,
      "product",
      context,
    );
  }

  private async getJson(
    path: string,
    resource: string,
    context: MercadonaMarketContext,
  ): Promise<unknown> {
    const response = await this.request(new URL(path, this.baseUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-customer-pc": context.postalCode,
        "x-customer-wh": context.warehouse,
      },
    });
    return this.readJson(response, resource);
  }

  private async readJson(
    response: Response,
    resource: string,
  ): Promise<unknown> {
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (
      response.status === 204 ||
      contentType === undefined ||
      !contentType.includes("application/json")
    ) {
      throw new MercadonaHttpError(
        "invalid-response",
        `Mercadona ${resource} response was not JSON`,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new MercadonaHttpError(
        "invalid-response",
        `Mercadona ${resource} response contained invalid JSON`,
        response.status,
        undefined,
        { cause },
      );
    }
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let lastError: MercadonaHttpError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(url, init);
      } catch (error) {
        if (!(error instanceof MercadonaHttpError)) throw error;
        lastError = error;
        if (attempt === this.maxRetries || !this.isTransient(error))
          throw error;
        await this.sleep(this.retryDelay(error, attempt));
      }
    }
    throw (
      lastError ?? new MercadonaHttpError("network", "Mercadona request failed")
    );
  }

  private async requestOnce(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new MercadonaHttpError(
          "http",
          `Mercadona returned HTTP ${response.status}`,
          response.status,
          this.parseRetryAfter(response.headers.get("retry-after")),
        );
      }
      return response;
    } catch (cause) {
      if (cause instanceof MercadonaHttpError) throw cause;
      if (controller.signal.aborted) {
        throw new MercadonaHttpError(
          "aborted",
          "Mercadona request timed out",
          undefined,
          undefined,
          { cause },
        );
      }
      throw new MercadonaHttpError(
        "network",
        "Mercadona request failed",
        undefined,
        undefined,
        { cause },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private isTransient(error: MercadonaHttpError): boolean {
    return (
      error.kind === "network" ||
      error.kind === "aborted" ||
      (error.status !== undefined && TRANSIENT_STATUSES.has(error.status))
    );
  }

  private retryDelay(error: MercadonaHttpError, attempt: number): number {
    if (error.retryAfterMs !== undefined) return error.retryAfterMs;
    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    return Math.round(exponential * (0.5 + this.random()));
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  private nonEmptyHeader(headers: Headers, name: string): string | undefined {
    const value = headers.get(name)?.trim();
    return value === undefined || value === "" ? undefined : value;
  }
}
