import { load, type CheerioAPI } from "cheerio";

import type {
  EroskiProductDto,
  EroskiUnitPriceDto,
  EroskiWeightDto,
} from "./eroski-dtos.js";

type JsonRecord = Record<string, unknown>;

export class EroskiHtmlStructureError extends Error {
  constructor(readonly missingFields: readonly string[]) {
    super(
      `Eroski product HTML is missing required fields: ${missingFields.join(", ")}`,
    );
    this.name = "EroskiHtmlStructureError";
  }
}

export class EroskiHtmlParser {
  parse(html: string, pageUrl: string): EroskiProductDto {
    const $ = load(html);
    const structuredProduct = this.structuredProduct($);
    const externalId =
      this.attribute($, "[data-product-id]", "data-product-id") ??
      this.attribute($, "[data-product-code]", "data-product-code") ??
      this.attribute($, '[itemprop="sku"]', "content") ??
      this.stringValue(structuredProduct?.sku) ??
      this.externalIdFromUrl(pageUrl);
    const name =
      this.text($, 'main h1, .product-detail h1, h1[itemprop="name"]') ??
      this.attribute($, '[itemprop="name"]', "content") ??
      this.stringValue(structuredProduct?.name) ??
      this.attribute($, 'meta[property="og:title"]', "content");
    const offers = this.firstRecord(structuredProduct?.offers);
    const price =
      this.decimal(this.attribute($, "[data-price]", "data-price")) ??
      this.decimal(this.attribute($, '[itemprop="price"]', "content")) ??
      this.decimal(offers?.price) ??
      this.decimal(
        this.text(
          $,
          '.price-now, .product-price, .price__current, [itemprop="price"]',
        ),
      );
    const shopRef = this.shopRef($, pageUrl);
    const availability = this.availability($, offers);
    const requiredFields: ReadonlyArray<readonly [string, unknown]> = [
      ["externalId", externalId],
      ["name", name],
      ["price", price],
      ["shopRef", shopRef],
      ["availability", availability],
    ];
    const missingFields = requiredFields.flatMap(([field, value]) =>
      value === undefined ? [field] : [],
    );
    if (missingFields.length > 0) {
      throw new EroskiHtmlStructureError(missingFields);
    }

    const brand =
      this.attribute($, "[data-brand]", "data-brand") ??
      this.attribute($, '[itemprop="brand"]', "content") ??
      this.text($, '[itemprop="brand"]') ??
      this.structuredBrand(structuredProduct?.brand);
    const format =
      this.attribute($, "[data-format]", "data-format") ??
      this.attribute($, 'meta[name="product:format"]', "content") ??
      this.text($, '.product-format, .format, [itemprop="size"]');
    const weightSource =
      this.attribute($, "[data-weight]", "data-weight") ??
      this.text($, ".product-weight, .weight") ??
      format ??
      name;
    const imageValue =
      this.attribute($, '[itemprop="image"]', "content") ??
      this.attribute($, '[itemprop="image"]', "src") ??
      this.attribute($, 'meta[property="og:image"]', "content") ??
      this.structuredImage(structuredProduct?.image);
    const variableWeightValue = this.attribute(
      $,
      "[data-variable-weight]",
      "data-variable-weight",
    );
    const markerText = this.text(
      $,
      ".variable-weight, .weight-product, [data-variable-weight]",
    );

    return {
      externalId: externalId as string,
      name: name as string,
      ...(brand === undefined ? {} : { brand }),
      price: price as number,
      ...this.unitPrice($),
      ...(format === undefined ? {} : { format }),
      ...this.weight(weightSource),
      shopRef: shopRef as string,
      ...(imageValue === undefined
        ? {}
        : { image: new URL(imageValue, pageUrl).href }),
      availability: availability as boolean,
      variableWeight:
        this.booleanValue(variableWeightValue) ??
        /(?:producto\s+)?al\s+peso|\baprox\.?\b/i.test(
          `${markerText ?? ""} ${format ?? ""} ${name as string}`,
        ),
      productUrl: pageUrl,
    };
  }

  private structuredProduct($: CheerioAPI): JsonRecord | undefined {
    let product: JsonRecord | undefined;
    $('script[type="application/ld+json"]').each((_index, element) => {
      if (product !== undefined) return;
      const source = $(element).text().trim();
      if (source === "") return;
      try {
        const payload: unknown = JSON.parse(source);
        product = this.jsonRecords(payload).find((candidate) =>
          this.hasJsonType(candidate, "Product"),
        );
      } catch {
        // Other JSON-LD blocks may be malformed without invalidating the DOM.
      }
    });
    return product;
  }

  private jsonRecords(value: unknown): JsonRecord[] {
    if (Array.isArray(value))
      return value.flatMap((item) => this.jsonRecords(item));
    if (!this.isRecord(value)) return [];
    const graph = value["@graph"];
    return [value, ...(graph === undefined ? [] : this.jsonRecords(graph))];
  }

  private hasJsonType(value: JsonRecord, expected: string): boolean {
    const type = value["@type"];
    return (
      type === expected || (Array.isArray(type) && type.includes(expected))
    );
  }

  private shopRef($: CheerioAPI, pageUrl: string): string | undefined {
    const values = new Set<string>();
    const add = (value: string | undefined): void => {
      const normalized = value?.trim();
      if (normalized !== undefined && normalized !== "") values.add(normalized);
    };
    $("[data-shop-ref]").each((_index, element) =>
      add($(element).attr("data-shop-ref")),
    );
    $("[data-shopref]").each((_index, element) =>
      add($(element).attr("data-shopref")),
    );
    $('input[name="shopRef"], input[name="shopref"]').each((_index, element) =>
      add($(element).attr("value")),
    );
    $('meta[name="shopRef"], meta[name="shopref"]').each((_index, element) =>
      add($(element).attr("content")),
    );
    $(
      '[href*="shopRef="], [href*="shopref="], [action*="shopRef="], [action*="shopref="]',
    ).each((_index, element) => {
      const target = $(element).attr("href") ?? $(element).attr("action");
      if (target === undefined) return;
      try {
        const url = new URL(target, pageUrl);
        for (const [key, value] of url.searchParams) {
          if (key.toLowerCase() === "shopref") add(value);
        }
      } catch {
        // A malformed unrelated link is not part of the product contract.
      }
    });
    return values.size === 1 ? values.values().next().value : undefined;
  }

  private availability(
    $: CheerioAPI,
    offers: JsonRecord | undefined,
  ): boolean | undefined {
    const raw =
      this.attribute($, "[data-availability]", "data-availability") ??
      this.attribute($, '[itemprop="availability"]', "content") ??
      this.attribute($, '[itemprop="availability"]', "href") ??
      this.stringValue(offers?.availability);
    if (raw !== undefined) {
      const normalized = raw.toLowerCase();
      if (normalized.includes("outofstock") || normalized.includes("agotado"))
        return false;
      if (
        normalized.includes("instock") ||
        normalized.includes("disponible") ||
        normalized === "true"
      )
        return true;
      if (normalized === "false") return false;
    }
    let addButton: ReturnType<CheerioAPI> | undefined;
    $("button").each((_index, element) => {
      if (/^\s*a(?:ñ|n)adir\s*$/i.test($(element).text())) {
        addButton = $(element);
        return false;
      }
      return undefined;
    });
    return addButton === undefined
      ? undefined
      : addButton.attr("disabled") === undefined;
  }

  private unitPrice($: CheerioAPI): { unitPrice?: EroskiUnitPriceDto } {
    const selector =
      "[data-unit-price], .unit-price, .price-unit, .price__unit";
    const raw =
      this.attribute($, "[data-unit-price]", "data-unit-price") ??
      this.text($, selector);
    const amounts = this.decimals(raw);
    const amount = amounts.at(-1);
    const unitRaw = this.attribute($, "[data-unit-price]", "data-unit") ?? raw;
    const unit = this.unit(unitRaw);
    return amount === undefined || unit === undefined
      ? {}
      : { unitPrice: { amount, unit } };
  }

  private weight(value: string | undefined): { weight?: EroskiWeightDto } {
    if (value === undefined) return {};
    const match = value.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
    if (match?.[1] === undefined || match[2] === undefined) return {};
    const amount = this.decimal(match[1]);
    const unit = this.unit(match[2]);
    return amount === undefined || unit === undefined || unit === "unit"
      ? {}
      : { weight: { amount, unit } };
  }

  private unit(
    value: string | undefined,
  ): EroskiUnitPriceDto["unit"] | undefined {
    const normalized = value?.toLocaleLowerCase("es-ES");
    if (normalized === undefined) return undefined;
    if (/\b(?:kg|kilo|kilogramo)s?\b/.test(normalized)) return "kg";
    if (/\b(?:g|gramo)s?\b/.test(normalized)) return "g";
    if (/\b(?:ml|mililitro)s?\b/.test(normalized)) return "ml";
    if (/\b(?:l|litro)s?\b/.test(normalized)) return "l";
    if (/\b(?:ud\.?|unidad)(?:es)?\b/.test(normalized)) return "unit";
    return undefined;
  }

  private decimal(value: unknown): number | undefined {
    return this.decimals(value)[0];
  }

  private decimals(value: unknown): number[] {
    const text = this.stringValue(value);
    if (text === undefined) return [];
    return Array.from(text.matchAll(/\d+(?:[.,]\d+)?/g)).flatMap(([match]) => {
      const parsed = Number(match.replace(",", "."));
      return Number.isFinite(parsed) && parsed >= 0 ? [parsed] : [];
    });
  }

  private externalIdFromUrl(value: string): string | undefined {
    try {
      const segments = new URL(value).pathname.split("/").filter(Boolean);
      const detailIndex = segments.findIndex(
        (segment) => segment === "productdetail",
      );
      const candidate = segments[detailIndex + 1]?.split("-")[0]?.trim();
      return candidate === undefined || candidate === ""
        ? undefined
        : candidate;
    } catch {
      return undefined;
    }
  }

  private structuredBrand(value: unknown): string | undefined {
    if (this.isRecord(value)) return this.stringValue(value.name);
    return this.stringValue(value);
  }

  private structuredImage(value: unknown): string | undefined {
    if (Array.isArray(value)) return this.stringValue(value[0]);
    if (this.isRecord(value)) return this.stringValue(value.url);
    return this.stringValue(value);
  }

  private firstRecord(value: unknown): JsonRecord | undefined {
    const candidate: unknown = Array.isArray(value)
      ? (value as unknown[])[0]
      : value;
    return this.isRecord(candidate) ? candidate : undefined;
  }

  private attribute(
    $: CheerioAPI,
    selector: string,
    attribute: string,
  ): string | undefined {
    const value = $(selector).first().attr(attribute)?.trim();
    return value === "" ? undefined : value;
  }

  private text($: CheerioAPI, selector: string): string | undefined {
    const value = $(selector).first().text().replace(/\s+/g, " ").trim();
    return value === "" ? undefined : value;
  }

  private booleanValue(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    if (["true", "1", "yes", "si", "sí"].includes(value.toLowerCase()))
      return true;
    if (["false", "0", "no"].includes(value.toLowerCase())) return false;
    return undefined;
  }

  private stringValue(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized === "" ? undefined : normalized;
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
