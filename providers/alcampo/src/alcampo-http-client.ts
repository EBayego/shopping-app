import { randomUUID } from "node:crypto";

import type { AlcampoAreaDto } from "./alcampo-dtos.js";
import { AlcampoInitialStateParser } from "./alcampo-initial-state-parser.js";
import type { AlcampoSessionContext } from "./alcampo-session-context.js";

const DEFAULT_BASE_URL = "https://www.compraonline.alcampo.es/";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const PROVIDER_USER_AGENT =
  "Mozilla/5.0 (compatible; shopping-app-alcampo-provider/1.0)";
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

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
export interface AlcampoBootstrapResult {
  visitorId: string;
  csrfToken: string;
  assetVersion: string;
}
export interface AlcampoHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetch?: typeof fetch;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  uuid?: () => string;
}

export class AlcampoHttpClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly uuid: () => string;
  private readonly cookies = new Map<string, string>();
  private readonly initialState = new AlcampoInitialStateParser();

  constructor(options: AlcampoHttpClientOptions = {}) {
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 200;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.random = options.random ?? Math.random;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.uuid = options.uuid ?? randomUUID;
  }

  async bootstrap(
    seed?: AlcampoSessionContext,
  ): Promise<AlcampoBootstrapResult> {
    this.seedCookies(seed);
    const response = await this.request(new URL("", this.baseUrl), {
      method: "GET",
      headers: { ...this.headers(seed), accept: "text/html" },
    });
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType === undefined || !contentType.includes("text/html"))
      throw new AlcampoHttpError(
        "invalid-response",
        "Alcampo bootstrap response was not HTML",
        response.status,
      );
    let parsed: ReturnType<AlcampoInitialStateParser["parseSession"]>;
    try {
      parsed = this.initialState.parseSession(await response.text());
    } catch (cause) {
      throw new AlcampoHttpError(
        "invalid-response",
        "Alcampo bootstrap initial state was incompatible",
        response.status,
        undefined,
        { cause },
      );
    }
    return {
      visitorId: seed?.visitorId ?? parsed.visitorId,
      csrfToken: seed?.csrfToken ?? parsed.csrfToken,
      assetVersion: parsed.assetVersion,
    };
  }

  searchAreas(
    postalCode: string,
    bootstrap: AlcampoBootstrapResult,
  ): Promise<unknown> {
    return this.jsonRequest("api/address/v1/addresses/areas", "areas", {
      method: "PUT",
      headers: {
        ...this.dynamicHeaders(bootstrap),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query: postalCode }).toString(),
    });
  }
  getArea(areaId: string, bootstrap: AlcampoBootstrapResult): Promise<unknown> {
    return this.jsonRequest(
      `api/address/v1/addresses/areas/${encodeURIComponent(areaId)}`,
      "area",
      { method: "GET", headers: this.dynamicHeaders(bootstrap) },
    );
  }
  createTemporaryDestination(
    address: AlcampoAreaDto,
    bootstrap: AlcampoBootstrapResult,
  ): Promise<unknown> {
    return this.jsonRequest(
      "api/ecomdeliverydestinations/v2/temporary-delivery-destinations",
      "temporary delivery destination",
      {
        method: "POST",
        headers: {
          ...this.dynamicHeaders(bootstrap),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          visitorId: bootstrap.visitorId,
          latitude: address.latitude,
          longitude: address.longitude,
          postalCode: address.postalCode,
          formattedAddress: address.formattedAddress,
        }),
      },
    );
  }
  getDeliveryAddress(
    deliveryDestinationId: string,
    bootstrap: AlcampoBootstrapResult,
  ): Promise<unknown> {
    return this.jsonRequest(
      `api/ecomdeliverydestinations/v4/delivery-addresses/${encodeURIComponent(deliveryDestinationId)}`,
      "delivery address",
      { method: "GET", headers: this.dynamicHeaders(bootstrap) },
    );
  }
  activateSession(
    deliveryDestinationId: string,
    regionId: string,
    bootstrap: AlcampoBootstrapResult,
  ): Promise<unknown> {
    return this.jsonRequest(
      "api/customersessions/v2/sessions/active",
      "active session",
      {
        method: "PUT",
        headers: {
          ...this.dynamicHeaders(bootstrap),
          "content-type": "application/json",
        },
        body: JSON.stringify({ deliveryDestinationId, regionId }),
      },
    );
  }
  getCategories(context: AlcampoSessionContext): Promise<unknown> {
    return this.jsonRequest(
      "api/webproductpagews/v1/categories?decoration=false&categoryDepth=4",
      "categories",
      { method: "GET", headers: this.headers(context) },
    );
  }
  async getCategoryHtml(
    path: string,
    context: AlcampoSessionContext,
  ): Promise<{ html: string; url: string }> {
    const url = new URL(path, this.baseUrl);
    const response = await this.request(url, {
      method: "GET",
      headers: { ...this.headers(context), accept: "text/html" },
    });
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType === undefined || !contentType.includes("text/html"))
      throw new AlcampoHttpError(
        "invalid-response",
        "Alcampo category response was not HTML",
        response.status,
      );
    return { html: await response.text(), url: url.href };
  }
  getProduct(
    retailerProductId: string,
    context: AlcampoSessionContext,
  ): Promise<unknown> {
    const url = new URL("api/webproductpagews/v5/products/bop", this.baseUrl);
    url.searchParams.set("retailerProductId", retailerProductId);
    return this.jsonRequest(url, "product", {
      method: "GET",
      headers: this.headers(context),
    });
  }
  getProducts(
    productIds: readonly string[],
    context: AlcampoSessionContext,
  ): Promise<unknown> {
    return this.jsonRequest("api/webproductpagews/v6/products", "products", {
      method: "PUT",
      headers: { ...this.headers(context), "content-type": "application/json" },
      body: JSON.stringify(productIds),
    });
  }
  ids(): { clientRouteId: string; pageViewId: string } {
    return { clientRouteId: this.uuid(), pageViewId: this.uuid() };
  }

  private async jsonRequest(
    path: string | URL,
    resource: string,
    init: RequestInit,
  ): Promise<unknown> {
    const response = await this.request(
      typeof path === "string" ? new URL(path, this.baseUrl) : path,
      init,
    );
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
    )
      throw new AlcampoHttpError(
        "invalid-response",
        `Alcampo ${resource} response was not JSON`,
        response.status,
      );
    try {
      return await response.json();
    } catch (cause) {
      throw new AlcampoHttpError(
        "invalid-response",
        `Alcampo ${resource} response contained invalid JSON`,
        response.status,
        undefined,
        { cause },
      );
    }
  }
  private async request(url: URL, init: RequestInit): Promise<Response> {
    let last: AlcampoHttpError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(url, init);
      } catch (error) {
        if (!(error instanceof AlcampoHttpError)) throw error;
        last = error;
        if (attempt === this.maxRetries || !this.transient(error)) throw error;
        await this.sleep(
          error.retryAfterMs ??
            Math.round(
              this.retryBaseDelayMs * 2 ** attempt * (0.5 + this.random()),
            ),
        );
      }
    }
    throw last ?? new AlcampoHttpError("network", "Alcampo request failed");
  }
  private async requestOnce(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      const cookie = this.cookieHeader();
      if (cookie !== undefined && !headers.has("cookie"))
        headers.set("cookie", cookie);
      const response = await this.fetchImplementation(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      this.captureCookies(response.headers);
      if (
        response.headers.get("x-amzn-waf-action")?.toLowerCase() === "challenge"
      )
        throw new AlcampoHttpError(
          "http",
          "Alcampo requires an AWS WAF challenge",
          response.status,
        );
      if (!response.ok)
        throw new AlcampoHttpError(
          "http",
          `Alcampo returned HTTP ${response.status}`,
          response.status,
          this.retryAfter(response.headers.get("retry-after")),
        );
      return response;
    } catch (cause) {
      if (cause instanceof AlcampoHttpError) throw cause;
      if (controller.signal.aborted)
        throw new AlcampoHttpError(
          "aborted",
          "Alcampo request timed out",
          undefined,
          undefined,
          { cause },
        );
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
  private headers(context?: AlcampoSessionContext): Record<string, string> {
    const ids = this.ids();
    return {
      accept: "application/json",
      "user-agent": PROVIDER_USER_AGENT,
      "ecom-request-source": "web",
      "client-route-id": ids.clientRouteId,
      "page-view-id": ids.pageViewId,
      ...(context?.requestHeaders() ?? {}),
    };
  }
  private dynamicHeaders(context: {
    visitorId: string;
    csrfToken?: string;
    assetVersion?: string;
  }): Record<string, string> {
    const ids = this.ids();
    return {
      accept: "application/json; charset=utf-8",
      "accept-language": "es-ES,es;q=0.9",
      "user-agent": PROVIDER_USER_AGENT,
      "visitor-id": context.visitorId,
      visitorid: context.visitorId,
      "ecom-request-source": "web",
      ...(context.assetVersion === undefined
        ? {}
        : { "ecom-request-source-version": context.assetVersion }),
      origin: this.baseUrl.origin,
      referer: this.baseUrl.href,
      "client-route-id": ids.clientRouteId,
      "page-view-id": ids.pageViewId,
      ...(context.csrfToken === undefined
        ? {}
        : { "x-csrf-token": context.csrfToken }),
    };
  }
  private seedCookies(context?: AlcampoSessionContext): void {
    if (context?.globalSid !== undefined)
      this.cookies.set("global_sid", context.globalSid);
    if (context?.awsWafToken !== undefined)
      this.cookies.set("aws-waf-token", context.awsWafToken);
  }
  private captureCookies(headers: Headers): void {
    const values =
      "getSetCookie" in headers && typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie") ?? ""];
    for (const value of values)
      for (const match of value.matchAll(
        /(?:^|,\s*)([A-Za-z0-9_-]+)=([^;,]*)/g,
      ))
        if (match[1] !== undefined && match[2] !== undefined)
          this.cookies.set(match[1], match[2]);
  }
  private cookieHeader(): string | undefined {
    const entries = [...this.cookies].map(([key, value]) => `${key}=${value}`);
    return entries.length === 0 ? undefined : entries.join("; ");
  }
  private transient(error: AlcampoHttpError): boolean {
    return (
      error.kind === "network" ||
      error.kind === "aborted" ||
      (error.status !== undefined && TRANSIENT_STATUSES.has(error.status))
    );
  }
  private retryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }
}
