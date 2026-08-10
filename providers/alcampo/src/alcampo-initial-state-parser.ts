import { load } from "cheerio";

export interface AlcampoInitialSessionState {
  visitorId: string;
  csrfToken: string;
  assetVersion: string;
}

export class AlcampoInitialStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AlcampoInitialStateError";
  }
}

export class AlcampoInitialStateParser {
  parseSession(html: string): AlcampoInitialSessionState {
    const state = this.parse(html);
    const session = this.record(state.session);
    const csrf = this.record(session?.csrf);
    const metadata = this.record(session?.metadata);
    const csrfToken = this.nonEmptyString(csrf?.token);
    const visitorId = this.nonEmptyString(metadata?.visitorId);
    const assetVersion = this.nonEmptyString(metadata?.assetVersion);
    if (
      csrfToken === undefined ||
      visitorId === undefined ||
      assetVersion === undefined
    ) {
      throw new AlcampoInitialStateError(
        "Alcampo initial state is missing session CSRF or visitor metadata",
      );
    }
    return { csrfToken, visitorId, assetVersion };
  }

  parseInternalProductIds(html: string): ReadonlyMap<string, string> {
    const state = this.parse(html);
    const data = this.record(state.data);
    const products = this.record(data?.products);
    const entities = this.record(products?.productEntities);
    if (entities === undefined) return new Map();
    const result = new Map<string, string>();
    for (const [key, value] of Object.entries(entities)) {
      const entity = this.record(value);
      const productId = this.nonEmptyString(entity?.productId) ?? key;
      const retailerProductId = this.nonEmptyString(entity?.retailerProductId);
      if (
        retailerProductId !== undefined &&
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(productId)
      ) {
        result.set(retailerProductId, productId);
      }
    }
    return result;
  }

  private parse(html: string): Record<string, unknown> {
    const $ = load(html);
    const script = $('script[data-test="initial-state-script"]').first();
    if (script.length === 0) {
      throw new AlcampoInitialStateError(
        "Alcampo HTML is missing initial-state-script",
      );
    }
    const source = script.text().trim();
    const prefix = "window.__INITIAL_STATE__=";
    if (!source.startsWith(prefix)) {
      throw new AlcampoInitialStateError(
        "Alcampo initial state has an incompatible assignment",
      );
    }
    try {
      const payload: unknown = JSON.parse(source.slice(prefix.length));
      const parsed = this.record(payload);
      if (parsed === undefined) throw new Error("Initial state is not an object");
      return parsed;
    } catch (cause) {
      throw new AlcampoInitialStateError(
        "Alcampo initial state contains invalid JSON",
        { cause },
      );
    }
  }

  private record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private nonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : undefined;
  }
}
