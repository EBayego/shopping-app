import { EroskiSessionContext } from "./eroski-session-context.js";

const DEFAULT_BASE_URL = "https://supermercado.eroski.es/";
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Safari/537.36";

export type EroskiHttpErrorKind =
  "aborted" | "http" | "invalid-response" | "network";

export class EroskiHttpError extends Error {
  constructor(
    readonly kind: EroskiHttpErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EroskiHttpError";
  }
}

export interface EroskiHtmlPage {
  html: string;
  url: string;
}

export interface EroskiHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface EroskiTapestryPayload {
  content?: unknown;
}

export class EroskiHttpClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: EroskiHttpClientOptions = {}) {
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  async bootstrap(): Promise<EroskiSessionContext> {
    const page = await this.getHtml(this.baseUrl);
    const cookies = this.cookies(page.headers);
    const shopRef = cookies.get("supermarket.ali.shop")?.trim();
    const shopName = cookies.get("supermarket.ali.shopName")?.trim();
    if (!shopRef || !shopName) {
      throw new EroskiHttpError(
        "invalid-response",
        "Eroski bootstrap did not select a public grocery shop",
        page.status,
      );
    }
    return new EroskiSessionContext({
      shopRef,
      shopName: decodeURIComponent(shopName.replaceAll("+", " ")),
      cookies,
      homeHtml: page.html,
      homeUrl: page.url,
    });
  }

  async getCategoryPage(
    path: string,
    context: EroskiSessionContext,
  ): Promise<EroskiHtmlPage> {
    return this.sessionHtml(this.categoryUrl(path), context);
  }

  async getSearchPage(
    query: string,
    context: EroskiSessionContext,
  ): Promise<EroskiHtmlPage> {
    const url = new URL("/es/search/results/", this.baseUrl);
    url.searchParams.set("q", query);
    return this.sessionHtml(url, context);
  }

  async getProductPage(
    externalId: string,
    context: EroskiSessionContext,
  ): Promise<EroskiHtmlPage> {
    const url = new URL(
      `/es/productdetail/${encodeURIComponent(externalId)}-x/`,
      this.baseUrl,
    );
    return this.sessionHtml(url, context);
  }

  async getCategoryProductsPage(
    path: string,
    pageNumber: number,
    documentUrl: string,
    context: EroskiSessionContext,
  ): Promise<string> {
    const url = new URL("/es/supermarket:loadpage", this.baseUrl);
    url.searchParams.set("t:ac", this.categoryActionContext(path));
    return this.getProductsPage(url, pageNumber, documentUrl, context);
  }

  private async getProductsPage(
    url: URL,
    pageNumber: number,
    documentUrl: string,
    context: EroskiSessionContext,
  ): Promise<string> {
    const response = await this.request(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        cookie: context.cookieHeader(),
        origin: this.baseUrl.origin,
        referer: this.sameOriginUrl(documentUrl).href,
        "x-requested-with": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        "t:zoneid": "productListZone",
        pageNumber: String(pageNumber),
      }).toString(),
    });
    context.captureCookies(this.setCookieValues(response.headers));
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType === undefined || !contentType.includes("application/json"))
      throw new EroskiHttpError(
        "invalid-response",
        "Eroski pagination response was not JSON",
        response.status,
      );
    let payload: EroskiTapestryPayload;
    try {
      payload = (await response.json()) as EroskiTapestryPayload;
    } catch (cause) {
      throw new EroskiHttpError(
        "invalid-response",
        "Eroski pagination response contained invalid JSON",
        response.status,
        undefined,
        { cause },
      );
    }
    if (typeof payload.content !== "string")
      throw new EroskiHttpError(
        "invalid-response",
        "Eroski pagination response did not contain HTML content",
        response.status,
      );
    return payload.content;
  }

  private async sessionHtml(
    url: URL,
    context: EroskiSessionContext,
  ): Promise<EroskiHtmlPage> {
    const page = await this.getHtml(url, context.cookieHeader());
    context.captureCookies(this.setCookieValues(page.headers));
    return { html: page.html, url: page.url };
  }

  private async getHtml(
    url: URL,
    cookie?: string,
  ): Promise<EroskiHtmlPage & { headers: Headers; status: number }> {
    const response = await this.request(url, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml",
        ...(cookie === undefined || cookie === "" ? {} : { cookie }),
      },
    });
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType === undefined || !contentType.includes("text/html"))
      throw new EroskiHttpError(
        "invalid-response",
        "Eroski response was not HTML",
        response.status,
      );
    const html = await response.text();
    if (html.trim() === "")
      throw new EroskiHttpError(
        "invalid-response",
        "Eroski response contained empty HTML",
        response.status,
      );
    return {
      html,
      url: response.url === "" ? url.href : response.url,
      headers: response.headers,
      status: response.status,
    };
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        ...init,
        headers: {
          "accept-language": "es-ES,es;q=0.9",
          "user-agent": USER_AGENT,
          ...init.headers,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new EroskiHttpError(
          "http",
          `Eroski returned HTTP ${response.status}`,
          response.status,
          this.retryAfter(response.headers.get("retry-after")),
        );
      return response;
    } catch (cause) {
      if (cause instanceof EroskiHttpError) throw cause;
      if (controller.signal.aborted)
        throw new EroskiHttpError(
          "aborted",
          "Eroski request timed out",
          undefined,
          undefined,
          { cause },
        );
      throw new EroskiHttpError(
        "network",
        "Eroski request failed",
        undefined,
        undefined,
        { cause },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private categoryUrl(path: string): URL {
    const url = this.sameOriginUrl(path);
    if (!url.pathname.startsWith("/es/supermercado/"))
      throw new RangeError("Eroski category path is invalid");
    return url;
  }

  private categoryActionContext(path: string): string {
    const url = this.categoryUrl(path);
    return url.pathname
      .slice("/es/supermercado/".length)
      .replace(/^\/+|\/+$/g, "");
  }

  private sameOriginUrl(value: string): URL {
    const url = new URL(value, this.baseUrl);
    if (url.origin !== this.baseUrl.origin)
      throw new RangeError("Eroski URL must use the configured origin");
    return url;
  }

  private cookies(headers: Headers): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const value of this.setCookieValues(headers)) {
      for (const match of value.matchAll(
        /(?:^|,\s*)([A-Za-z0-9_.-]+)=([^;,]*)/g,
      )) {
        if (match[1] !== undefined && match[2] !== undefined)
          cookies.set(match[1], match[2]);
      }
    }
    return cookies;
  }

  private setCookieValues(headers: Headers): string[] {
    return "getSetCookie" in headers &&
      typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""];
  }

  private retryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }
}
