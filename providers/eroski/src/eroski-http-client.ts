const DEFAULT_BASE_URL = "https://supermercado.eroski.es/";
const DEFAULT_TIMEOUT_MS = 8_000;

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

export interface EroskiProductPage {
  html: string;
  url: string;
}

export interface EroskiHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
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

  async getProductPage(productUrl: string): Promise<EroskiProductPage> {
    const url = this.productUrl(productUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(url, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "es-ES,es;q=0.9",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new EroskiHttpError(
          "http",
          `Eroski returned HTTP ${response.status}`,
          response.status,
          this.retryAfter(response.headers.get("retry-after")),
        );
      }
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (contentType === undefined || !contentType.includes("text/html")) {
        throw new EroskiHttpError(
          "invalid-response",
          "Eroski product response was not HTML",
          response.status,
        );
      }
      const html = await response.text();
      if (html.trim() === "") {
        throw new EroskiHttpError(
          "invalid-response",
          "Eroski product response contained empty HTML",
          response.status,
        );
      }
      return { html, url: response.url === "" ? url.href : response.url };
    } catch (cause) {
      if (cause instanceof EroskiHttpError) throw cause;
      if (controller.signal.aborted) {
        throw new EroskiHttpError(
          "aborted",
          "Eroski request timed out",
          undefined,
          undefined,
          { cause },
        );
      }
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

  private productUrl(value: string): URL {
    const url = new URL(value, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new RangeError("Eroski product URL must use the configured origin");
    }
    if (!url.pathname.includes("/productdetail/")) {
      throw new RangeError("Eroski product URL is not a product detail page");
    }
    return url;
  }

  private retryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }
}
