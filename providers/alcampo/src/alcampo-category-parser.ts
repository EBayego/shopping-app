import { load } from "cheerio";

import type { AlcampoCategoryListingDto } from "./alcampo-dtos.js";
import {
  AlcampoInitialStateError,
  AlcampoInitialStateParser,
} from "./alcampo-initial-state-parser.js";

export class AlcampoCategoryHtmlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AlcampoCategoryHtmlError";
  }
}

export class AlcampoCategoryParser {
  private readonly initialState = new AlcampoInitialStateParser();

  parse(html: string, pageUrl: string): AlcampoCategoryListingDto {
    const $ = load(html);
    const script = $(
      'script[data-test="product-listing-structured-data"][type="application/ld+json"]',
    ).first();
    if (script.length === 0) {
      throw new AlcampoCategoryHtmlError(
        "Alcampo category HTML is missing product ItemList structured data",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(script.text());
    } catch (cause) {
      throw new AlcampoCategoryHtmlError(
        "Alcampo category ItemList contains invalid JSON",
        { cause },
      );
    }
    if (!this.isRecord(payload) || payload["@type"] !== "ItemList") {
      throw new AlcampoCategoryHtmlError(
        "Alcampo category structured data is not an ItemList",
      );
    }
    if (!Array.isArray(payload.itemListElement)) {
      throw new AlcampoCategoryHtmlError(
        "Alcampo category ItemList has no itemListElement array",
      );
    }
    const ids: string[] = [];
    const productUrls = new Map<string, string>();
    for (const value of payload.itemListElement) {
      const urlValue = this.itemUrl(value);
      if (urlValue === undefined) {
        throw new AlcampoCategoryHtmlError(
          "Alcampo category ItemList contains an item without a product URL",
        );
      }
      let url: URL;
      try {
        url = new URL(urlValue, pageUrl);
      } catch (cause) {
        throw new AlcampoCategoryHtmlError(
          "Alcampo category ItemList contains an invalid product URL",
          { cause },
        );
      }
      const match = url.pathname.match(/\/products\/[^/]+\/(\d+)\/?$/);
      if (match?.[1] === undefined) {
        throw new AlcampoCategoryHtmlError(
          "Alcampo product URL does not end in a numeric retailerProductId",
        );
      }
      if (!productUrls.has(match[1])) ids.push(match[1]);
      productUrls.set(match[1], url.href);
    }
    let internalProductIds: ReadonlyMap<string, string> = new Map();
    try {
      internalProductIds = this.initialState.parseInternalProductIds(html);
    } catch (error) {
      if (!(error instanceof AlcampoInitialStateError)) throw error;
    }
    return { retailerProductIds: ids, productUrls, internalProductIds };
  }

  private itemUrl(value: unknown): string | undefined {
    if (!this.isRecord(value)) return undefined;
    const item = value.item;
    if (typeof item === "string" && item.trim() !== "") return item.trim();
    if (this.isRecord(item)) {
      const url = item.url ?? item["@id"];
      if (typeof url === "string" && url.trim() !== "") return url.trim();
    }
    const url = value.url;
    return typeof url === "string" && url.trim() !== ""
      ? url.trim()
      : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
