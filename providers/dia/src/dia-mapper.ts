import type {
  Market,
  ProductOffer,
  ProductUnit,
  RetailerProduct,
} from "@shopping-app/domain";

import type { DiaProductAnalyticsDto, DiaSearchItemDto } from "./dia-dtos.js";
import type { DiaSessionContext } from "./dia-session-context.js";

interface PackageDetails {
  packageSize?: number;
  packageUnit?: "g" | "kg" | "ml" | "l";
  packageCount?: number;
  totalAmount?: number;
}

type DiaPackageUnit = NonNullable<PackageDetails["packageUnit"]>;
const DIA_BASE_URL = "https://www.dia.es";

export class DiaMapper {
  toMarket(context: DiaSessionContext): Market {
    return Object.freeze({
      retailer: "DIA",
      externalId: `postal-code:${context.postalCode}`,
      postalCode: context.postalCode,
      name: `DIA ${context.postalCode}`,
    });
  }

  toProduct(
    dto: DiaProductAnalyticsDto,
    market: Market,
    observedAt: Date,
  ): RetailerProduct {
    const packageDetails = this.parsePackageDetails(dto.name);
    return {
      retailer: "DIA",
      externalId: dto.externalId,
      name: dto.name,
      ...packageDetails,
      variableWeight: /\baprox\.?\b/i.test(dto.name),
      marketId: market.externalId,
      observedAt,
    };
  }

  toOffer(
    dto: DiaProductAnalyticsDto,
    market: Market,
    observedAt: Date,
  ): ProductOffer {
    return {
      retailerProductId: dto.externalId,
      marketId: market.externalId,
      normalPrice: dto.price,
      requiresMembership: false,
      available: dto.stockAvailability,
      observedAt,
    };
  }

  searchItemToProduct(
    dto: DiaSearchItemDto,
    market: Market,
    observedAt: Date,
  ): RetailerProduct {
    return {
      retailer: "DIA",
      externalId: dto.skuId,
      name: dto.displayName,
      ...(dto.brand === undefined ? {} : { brand: dto.brand }),
      ...this.parsePackageDetails(dto.displayName),
      variableWeight: /\baprox\.?\b/i.test(dto.displayName),
      ...(dto.category === undefined ? {} : { category: dto.category }),
      ...(dto.subcategory === undefined
        ? {}
        : { subcategory: dto.subcategory }),
      ...(dto.image === undefined
        ? {}
        : { imageUrl: this.toAbsoluteDiaUrl(dto.image) }),
      ...(dto.url === undefined
        ? {}
        : { productUrl: this.toAbsoluteDiaUrl(dto.url) }),
      marketId: market.externalId,
      observedAt,
    };
  }

  searchItemToOffer(
    dto: DiaSearchItemDto,
    market: Market,
    observedAt: Date,
  ): ProductOffer | undefined {
    if (dto.prices === undefined || dto.unitsInStock === undefined) {
      return undefined;
    }

    const hasReducedPrice =
      (dto.prices.isPromoPrice === true || dto.prices.isClubPrice === true) &&
      dto.prices.strikethroughPrice !== undefined &&
      dto.prices.strikethroughPrice > dto.prices.price;
    const referenceUnit = this.toProductUnit(dto.prices.measureUnit);
    return {
      retailerProductId: dto.skuId,
      marketId: market.externalId,
      normalPrice: hasReducedPrice
        ? (dto.prices.strikethroughPrice ?? dto.prices.price)
        : dto.prices.price,
      ...(hasReducedPrice ? { promoPrice: dto.prices.price } : {}),
      ...(dto.prices.pricePerUnit === undefined
        ? {}
        : { pricePerUnit: dto.prices.pricePerUnit }),
      ...(referenceUnit === undefined ? {} : { referenceUnit }),
      ...(hasReducedPrice ? { promotionType: "fixed-price" as const } : {}),
      requiresMembership: dto.prices.isClubPrice === true,
      available: dto.unitsInStock > 0,
      observedAt,
    };
  }

  private parsePackageDetails(name: string): PackageDetails {
    const packMatch = name.match(
      /\b(?:pack\s+)?(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i,
    );
    if (
      packMatch !== null &&
      packMatch[1] !== undefined &&
      packMatch[2] !== undefined &&
      packMatch[3] !== undefined
    ) {
      const packageCount = Number(packMatch[1]);
      const packageSize = Number(packMatch[2].replace(",", "."));
      if (
        Number.isInteger(packageCount) &&
        packageCount > 0 &&
        Number.isFinite(packageSize) &&
        packageSize > 0
      ) {
        return {
          packageSize,
          packageUnit: packMatch[3].toLowerCase() as DiaPackageUnit,
          packageCount,
          totalAmount: packageCount * packageSize,
        };
      }
    }

    const match = name.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      return {};
    }
    const packageSize = Number(match[1].replace(",", "."));
    if (!Number.isFinite(packageSize) || packageSize <= 0) {
      return {};
    }
    return {
      packageSize,
      packageUnit: match[2].toLowerCase() as DiaPackageUnit,
    };
  }

  private toProductUnit(
    measureUnit: string | undefined,
  ): ProductUnit | undefined {
    switch (measureUnit?.trim().toLocaleUpperCase("es-ES")) {
      case "UNIDAD":
        return "unit";
      case "GRAMO":
      case "GRAMOS":
        return "g";
      case "KILO":
      case "KILOGRAMO":
        return "kg";
      case "MILILITRO":
        return "ml";
      case "LITRO":
        return "l";
      default:
        return undefined;
    }
  }

  private toAbsoluteDiaUrl(value: string): string {
    return new URL(value, DIA_BASE_URL).href;
  }
}
