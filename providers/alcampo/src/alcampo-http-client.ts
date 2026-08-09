import type { AlcampoSessionContext } from "./alcampo-session-context.js";

const DEFAULT_BASE_URL = "https://www.compraonline.alcampo.es/";
const DEFAULT_TIMEOUT_MS = 8_000;

export type AlcampoHttpErrorKind =
  "aborted" | "http" | "invalid-response" | "network";

export class AlcampoHttpError extends Error {
  constructor(
    readonly kind: AlcampoHttpErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AlcampoHttpError";
  }
}

export interface AlcampoHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class AlcampoHttpClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: AlcampoHttpClientOptions = {}) {
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  async getProduct(
    retailerProductId: string,
    context: AlcampoSessionContext,
  ): Promise<unknown> {
    const url = new URL("api/webproductpagews/v5/products/bop", this.baseUrl);
    url.searchParams.set("retailerProductId", retailerProductId);
    const response = await this.request(url, {
      method: "GET",
      headers: context.requestHeaders(),
    });
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (
      contentType === undefined ||
      !contentType.includes("application/json")
    ) {
      throw new AlcampoHttpError(
        "invalid-response",
        "Alcampo product response was not JSON",
        response.status,
      );
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new AlcampoHttpError(
        "invalid-response",
        "Alcampo product response contained invalid JSON",
        response.status,
        undefined,
        { cause },
      );
    }
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AlcampoHttpError(
          "http",
          `Alcampo returned HTTP ${response.status}`,
          response.status,
          this.retryAfter(response.headers.get("retry-after")),
        );
      }
      return response;
    } catch (cause) {
      if (cause instanceof AlcampoHttpError) throw cause;
      if (controller.signal.aborted) {
        throw new AlcampoHttpError(
          "aborted",
          "Alcampo request timed out",
          undefined,
          undefined,
          { cause },
        );
      }
      throw new AlcampoHttpError(
        "network",
        "Alcampo request failed",
        undefined,
        undefined,
        { cause },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private retryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1_000
      : undefined;
  }
}
