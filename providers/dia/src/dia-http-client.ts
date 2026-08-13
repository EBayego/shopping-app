import type { DiaMarketResponseDto } from "./dia-dtos.js";
import type { DiaSessionContext } from "./dia-session-context.js";

const DEFAULT_BASE_URL = "https://www.dia.es";
const DEFAULT_TIMEOUT_MS = 8_000;

export type DiaHttpErrorKind =
  "aborted" | "http" | "invalid-response" | "network";

export class DiaHttpError extends Error {
  constructor(
    readonly kind: DiaHttpErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DiaHttpError";
  }
}

export interface DiaHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class DiaHttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: DiaHttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  async saveShippingAddress(
    postalCode: string,
    cartId: string,
    sessionId: string,
  ): Promise<DiaMarketResponseDto> {
    const url = new URL(
      "/api/v1/common-aggregator/save-shipping-address",
      this.baseUrl,
    );
    url.searchParams.set("new_postal_code", postalCode);
    url.searchParams.set("skip_dry_run", "true");

    const response = await this.request(url, {
      method: "PUT",
      headers: this.contextHeaders(cartId, sessionId),
      body: "null",
    });

    if (response.status !== 204) {
      throw new DiaHttpError(
        "invalid-response",
        `DIA market response returned unexpected status ${response.status}`,
        response.status,
      );
    }

    const definitiveSessionId = this.firstHeader(response.headers, [
      "session_id",
      "x-session-id",
    ]);
    const shopId = this.firstHeader(response.headers, ["shop_id", "x-shop-id"]);
    if (definitiveSessionId === undefined) {
      throw new DiaHttpError(
        "invalid-response",
        "DIA market response did not include session_id",
        response.status,
      );
    }

    return {
      sessionId: definitiveSessionId,
      ...(shopId === undefined ? {} : { shopId }),
    };
  }

  async getProductAnalytics(
    externalId: string,
    context: DiaSessionContext,
  ): Promise<unknown> {
    const encodedExternalId = encodeURIComponent(externalId);
    const url = new URL(
      `/api/v1/pdp-insight/initial_analytics/${encodedExternalId}`,
      this.baseUrl,
    );
    const response = await this.request(url, {
      method: "GET",
      headers: this.contextHeaders(context.cartId, context.sessionId, true),
    });

    return this.readJson(response, "product");
  }

  async searchProducts(
    query: string,
    page: number,
    context: DiaSessionContext,
  ): Promise<unknown> {
    const url = new URL("/api/v1/search-back/search/reduced", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("page", String(page));
    const response = await this.request(url, {
      method: "GET",
      headers: this.contextHeaders(context.cartId, context.sessionId, true),
    });
    return this.readJson(response, "search");
  }

  async getMenuData(context: DiaSessionContext): Promise<unknown> {
    const url = new URL("/api/v1/common-aggregator/menu-data", this.baseUrl);
    const response = await this.request(url, {
      method: "GET",
      headers: this.contextHeaders(context.cartId, context.sessionId, true),
    });
    return this.readJson(response, "category menu");
  }

  async getCategoryProducts(
    categoryLink: string,
    page: number,
    context: DiaSessionContext,
  ): Promise<unknown> {
    const pageLink = this.categoryPageLink(categoryLink, page);
    const url = new URL(`/api/v1/plp-back/reduced${pageLink}`, this.baseUrl);
    const response = await this.request(url, {
      method: "GET",
      headers: this.contextHeaders(context.cartId, context.sessionId, true),
    });
    return this.readJson(response, "category products");
  }

  private async readJson(
    response: Response,
    resource: string,
  ): Promise<unknown> {
    if (response.status === 204) {
      throw new DiaHttpError(
        "invalid-response",
        `DIA ${resource} response did not contain JSON`,
        response.status,
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (
      contentType === undefined ||
      !contentType.includes("application/json")
    ) {
      throw new DiaHttpError(
        "invalid-response",
        `DIA ${resource} response was not JSON`,
        response.status,
      );
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new DiaHttpError(
        "invalid-response",
        `DIA ${resource} response contained invalid JSON`,
        response.status,
        undefined,
        { cause },
      );
    }
  }

  private contextHeaders(
    cartId: string,
    sessionId: string,
    includeSessionCookie = false,
  ): Record<string, string> {
    return {
      accept: "application/json",
      "content-type": "application/json",
      cart_id: cartId,
      session_id: sessionId,
      ...(includeSessionCookie ? { cookie: `session_id=${sessionId}` } : {}),
      "x-locale": "es",
      "x-requested-with": "XMLHttpRequest",
    };
  }

  private firstHeader(
    headers: Headers,
    names: readonly string[],
  ): string | undefined {
    for (const name of names) {
      const value = headers.get(name);
      if (value !== null && value.trim() !== "") {
        return value;
      }
    }
    return undefined;
  }

  private categoryPageLink(categoryLink: string, page: number): string {
    if (!Number.isInteger(page) || page < 1)
      throw new RangeError("DIA category page must be a positive integer");
    if (
      !categoryLink.startsWith("/") ||
      categoryLink.startsWith("//") ||
      categoryLink.includes("?") ||
      categoryLink.includes("#") ||
      !/\/c\/L\d+$/.test(categoryLink)
    ) {
      throw new RangeError("DIA category link is invalid");
    }
    return page === 1
      ? categoryLink
      : categoryLink.replace(/\/c\/(L\d+)$/, `/pag-${page}/c/$1`);
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
        throw new DiaHttpError(
          "http",
          `DIA returned HTTP ${response.status}`,
          response.status,
          this.parseRetryAfter(response.headers.get("retry-after")),
        );
      }
      return response;
    } catch (cause) {
      if (cause instanceof DiaHttpError) {
        throw cause;
      }
      if (controller.signal.aborted) {
        throw new DiaHttpError(
          "aborted",
          "DIA request timed out",
          undefined,
          undefined,
          {
            cause,
          },
        );
      }
      throw new DiaHttpError(
        "network",
        "DIA request failed",
        undefined,
        undefined,
        {
          cause,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (value === null) {
      return undefined;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }
}
