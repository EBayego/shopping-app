import { load } from "cheerio";

import type {
  EroskiCategoryDto,
  EroskiProductDto,
  EroskiUnitPriceDto,
  EroskiWeightDto,
} from "./eroski-dtos.js";

type JsonRecord = Record<string, unknown>;

export class EroskiCatalogStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EroskiCatalogStructureError";
  }
}

export class EroskiCatalogParser {
  parseCategories(html: string, pageUrl: string): EroskiCategoryDto[] {
    const $ = load(html);
    const categories = new Map<string, EroskiCategoryDto>();
    $(".nav-level-1 > li.nav-item:not(.featured-items)").each(
      (_rootIndex, rootElement) => {
        const root = $(rootElement);
        const rootName = this.text(root.children("a").first());
        if (rootName === undefined) return;
        root
          .find(".nav-level-2 > li:not(.nav-item-seeall) > a")
          .each((_index, element) => {
            const link = $(element);
            const href = link.attr("href");
            const name = this.text(link);
            if (href === undefined || name === undefined) return;
            const parsed = this.categoryPath(href, pageUrl);
            if (parsed === undefined) return;
            if (!categories.has(parsed.externalId))
              categories.set(parsed.externalId, {
                externalId: parsed.externalId,
                name,
                path: parsed.path,
                rootName,
                parentName: name,
                order: categories.size,
              });
          });
      },
    );
    if (categories.size === 0)
      throw new EroskiCatalogStructureError(
        "Eroski navigation did not contain grocery leaf categories",
      );
    return [...categories.values()];
  }

  parseProducts(
    html: string,
    pageUrl: string,
    shopRef: string,
    category?: Pick<EroskiCategoryDto, "rootName" | "parentName">,
  ): EroskiProductDto[] {
    const $ = load(html);
    const products = new Map<string, EroskiProductDto>();
    $("#productListZone .product-item.big-item, .product-item.big-item").each(
      (_index, element) => {
        const card = $(element);
        const link = card.find("a.product-title-link").first();
        const href = link.attr("href");
        const metrics = this.metrics(link.attr("data-metrics"));
        if (href === undefined || metrics === undefined) return;
        const externalId = this.string(metrics.item_id);
        const name = this.text(link) ?? this.string(metrics.item_name);
        const currentPrice =
          this.decimal(this.text(card.find(".price-offer-now").first())) ??
          this.decimal(this.text(card.find(".offer-now").first())) ??
          this.number(metrics.price);
        const metricsPrice = this.number(metrics.price);
        if (
          externalId === undefined ||
          name === undefined ||
          currentPrice === undefined ||
          metricsPrice === undefined ||
          Math.abs(currentPrice - metricsPrice) > 0.01
        )
          throw new EroskiCatalogStructureError(
            "Eroski product card has an incompatible identity or price",
          );
        const normalPrice =
          this.decimal(this.text(card.find(".offer-before").first())) ??
          currentPrice;
        const hasPromoPrice = normalPrice > currentPrice;
        const promotionText = this.text(card.find(".product-offer").first());
        const unitPrice = this.unitPrice(
          this.text(card.find(".quantity-text").first()),
        );
        const packaging = this.packaging(name);
        const productUrl = new URL(href, pageUrl).href;
        const imageSource = card.find("img.product-img").first().attr("src");
        const brand = this.string(metrics.item_brand);
        const unavailable = /agotado|sin stock|no disponible/i.test(
          card.text(),
        );
        const dto: EroskiProductDto = {
          externalId,
          name,
          ...(brand === undefined ? {} : { brand }),
          normalPrice,
          ...(hasPromoPrice ? { promoPrice: currentPrice } : {}),
          ...(unitPrice === undefined ? {} : { unitPrice }),
          ...packaging,
          shopRef,
          ...(imageSource === undefined
            ? {}
            : { image: new URL(imageSource, pageUrl).href }),
          availability: !unavailable,
          variableWeight: this.variableWeight(name),
          productUrl,
          ...(category?.rootName === undefined
            ? {}
            : { category: category.rootName }),
          ...(category?.parentName === undefined
            ? {}
            : { subcategory: category.parentName }),
          ...this.promotion(promotionText, hasPromoPrice),
          requiresMembership: /club|socio/i.test(promotionText ?? ""),
        };
        products.set(externalId, dto);
      },
    );
    return [...products.values()];
  }

  private metrics(value: string | undefined): JsonRecord | undefined {
    if (value === undefined) return undefined;
    try {
      const payload: unknown = JSON.parse(value);
      if (!this.record(payload)) return undefined;
      const ecommerce = payload.ecommerce;
      if (!this.record(ecommerce) || !Array.isArray(ecommerce.items))
        return undefined;
      const item: unknown = ecommerce.items[0];
      return this.record(item) ? item : undefined;
    } catch {
      return undefined;
    }
  }

  private categoryPath(
    value: string,
    pageUrl: string,
  ): { externalId: string; path: string } | undefined {
    let url: URL;
    try {
      url = new URL(value, pageUrl);
    } catch {
      return undefined;
    }
    if (url.origin !== new URL(pageUrl).origin) return undefined;
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments[0] !== "es" ||
      segments[1] !== "supermercado" ||
      segments.length !== 4
    )
      return undefined;
    const match = segments.at(-1)?.match(/^(\d+)-/);
    return match?.[1] === undefined
      ? undefined
      : { externalId: match[1], path: url.pathname };
  }

  private packaging(name: string): {
    weight?: EroskiWeightDto;
    packageCount?: number;
    totalAmount?: number;
  } {
    const multi = name.match(
      /\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i,
    );
    if (
      multi?.[1] !== undefined &&
      multi[2] !== undefined &&
      multi[3] !== undefined
    ) {
      const count = Number(multi[1]);
      const amount = Number(multi[2].replace(",", "."));
      const unit = this.unit(multi[3]);
      if (
        Number.isInteger(count) &&
        count > 0 &&
        amount > 0 &&
        unit !== undefined &&
        unit !== "unit"
      )
        return {
          weight: { amount, unit },
          packageCount: count,
          totalAmount: count * amount,
        };
    }
    const match = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
    if (match?.[1] === undefined || match[2] === undefined) return {};
    const amount = Number(match[1].replace(",", "."));
    const unit = this.unit(match[2]);
    return amount > 0 && unit !== undefined && unit !== "unit"
      ? { weight: { amount, unit } }
      : {};
  }

  private unitPrice(value: string | undefined): EroskiUnitPriceDto | undefined {
    if (value === undefined) return undefined;
    const match = value.match(
      /\b(?:1\s+)?(kilo|kg|litro|l|unidad|ud\.?)\s+a\s+(\d+(?:[.,]\d+)?)\s*€/i,
    );
    if (match?.[1] === undefined || match[2] === undefined) return undefined;
    const amount = Number(match[2].replace(",", "."));
    const unit = this.unit(match[1]);
    return Number.isFinite(amount) && amount >= 0 && unit !== undefined
      ? { amount, unit }
      : undefined;
  }

  private promotion(
    text: string | undefined,
    hasPromoPrice: boolean,
  ): Pick<EroskiProductDto, "promotionType" | "promotionText"> {
    if (text === undefined) return {};
    const promotionType = /club|socio/i.test(text)
      ? ("membership" as const)
      : /unidad|\b\d+\s*[x×]\s*\d+/i.test(text)
        ? ("multi-buy" as const)
        : hasPromoPrice && /%/.test(text)
          ? ("percentage" as const)
          : ("other" as const);
    return { promotionType, promotionText: text };
  }

  private variableWeight(name: string): boolean {
    return /\bal peso\b|\baprox\.?\b|compra mínima/i.test(name);
  }

  private unit(value: string): EroskiUnitPriceDto["unit"] | undefined {
    const normalized = value.toLocaleLowerCase("es-ES");
    if (/^(?:kg|kilo)$/.test(normalized)) return "kg";
    if (normalized === "g") return "g";
    if (normalized === "ml") return "ml";
    if (/^(?:l|litro)$/.test(normalized)) return "l";
    if (/^(?:unidad|ud\.?)$/.test(normalized)) return "unit";
    return undefined;
  }

  private decimal(value: string | undefined): number | undefined {
    const match = value?.match(/\d+(?:[.,]\d+)?/);
    return match == null ? undefined : this.number(match[0].replace(",", "."));
  }

  private text(element: { text(): string }): string | undefined {
    const value = element.text().replace(/\s+/g, " ").trim();
    return value === "" ? undefined : value;
  }

  private string(value: unknown): string | undefined {
    if (typeof value !== "string" && typeof value !== "number")
      return undefined;
    const normalized = String(value).trim();
    return normalized === "" ? undefined : normalized;
  }

  private number(value: unknown): number | undefined {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
