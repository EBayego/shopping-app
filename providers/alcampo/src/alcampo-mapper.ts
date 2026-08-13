import type {
  Market,
  ProductOffer,
  ProductUnit,
  PromotionType,
  RetailerProduct,
} from "@shopping-app/domain";

import type { AlcampoProductDto, AlcampoQuantityDto } from "./alcampo-dtos.js";
import type { AlcampoSessionContext } from "./alcampo-session-context.js";

export class AlcampoMapper {
  toMarket(context: AlcampoSessionContext): Market {
    return Object.freeze({
      retailer: "ALCAMPO",
      externalId: context.regionId,
      postalCode: context.postalCode,
      name: `Alcampo ${context.postalCode}`,
      metadata: Object.freeze({ regionId: context.regionId }),
    });
  }

  toProduct(
    dto: AlcampoProductDto,
    market: Market,
    observedAt: Date,
  ): RetailerProduct {
    const pack =
      dto.catchweight === undefined
        ? this.packageDetails(dto.packSizeDescription)
        : {
            packageSize: dto.catchweight.typical.amount,
            packageUnit: dto.catchweight.typical.unit,
          };
    const category = dto.categoryPath[0];
    const subcategory =
      dto.categoryPath.length > 1 ? dto.categoryPath.at(-1) : undefined;
    const imageUrl = dto.images[0]?.url;
    return {
      retailer: "ALCAMPO",
      externalId: dto.retailerProductId,
      name: dto.name,
      ...(dto.brand === undefined ? {} : { brand: dto.brand }),
      ...pack,
      variableWeight: dto.type === "CATCHWEIGHT",
      ...(category === undefined ? {} : { category }),
      ...(subcategory === undefined ? {} : { subcategory }),
      ...(imageUrl === undefined ? {} : { imageUrl }),
      ...(dto.productUrl === undefined ? {} : { productUrl: dto.productUrl }),
      marketId: market.externalId,
      observedAt,
      rawData: dto,
    };
  }

  toOffer(
    dto: AlcampoProductDto,
    market: Market,
    observedAt: Date,
  ): ProductOffer {
    this.assertEuro(dto.price.currency, "price");
    if (dto.unitPrice !== undefined)
      this.assertEuro(dto.unitPrice.currency, "unit price");
    const promotion = dto.promotions[0];
    if (promotion?.price !== undefined)
      this.assertEuro(promotion.price.currency, "promotion price");
    const promotionText = promotion?.description;
    const promotionType = this.promotionType(
      promotion?.type,
      promotion?.description,
    );
    return {
      retailerProductId: dto.retailerProductId,
      marketId: market.externalId,
      normalPrice: dto.price.amount,
      ...(promotion?.price === undefined
        ? {}
        : { promoPrice: promotion.price.amount }),
      ...(dto.unitPrice === undefined
        ? {}
        : {
            pricePerUnit: dto.unitPrice.amount,
            referenceUnit: dto.unitPrice.unit,
          }),
      ...(promotionType === undefined ? {} : { promotionType }),
      ...(promotionText === undefined ? {} : { promotionText }),
      requiresMembership:
        promotion?.requiresMembership ?? promotionType === "membership",
      available: dto.available,
      observedAt,
    };
  }

  private packageDetails(description: string | undefined): {
    packageSize?: number;
    packageUnit?: ProductUnit;
    packageCount?: number;
    totalAmount?: number;
  } {
    if (description === undefined) return {};
    const multi = description.match(
      /(\d+)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i,
    );
    if (
      multi?.[1] !== undefined &&
      multi[2] !== undefined &&
      multi[3] !== undefined
    ) {
      const count = Number(multi[1]);
      const size = Number(multi[2].replace(",", "."));
      if (
        Number.isInteger(count) &&
        count > 0 &&
        Number.isFinite(size) &&
        size > 0
      )
        return {
          packageSize: size,
          packageUnit: multi[3].toLowerCase() as ProductUnit,
          packageCount: count,
          totalAmount: count * size,
        };
    }
    const single = this.packageQuantity(description);
    return single === undefined
      ? {}
      : {
          packageSize: single.amount,
          packageUnit: single.unit,
          totalAmount: single.amount,
        };
  }
  private packageQuantity(description: string): AlcampoQuantityDto | undefined {
    const match = description.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
    if (match?.[1] === undefined || match[2] === undefined) return undefined;
    const amount = Number(match[1].replace(",", "."));
    return !Number.isFinite(amount) || amount <= 0
      ? undefined
      : { amount, unit: match[2].toLowerCase() as AlcampoQuantityDto["unit"] };
  }
  private promotionType(
    type: string | undefined,
    description: string | undefined,
  ): PromotionType | undefined {
    if (type === undefined && description === undefined) return undefined;
    const normalized = `${type ?? ""} ${description ?? ""}`.toLowerCase();
    if (
      normalized.includes("member") ||
      normalized.includes("club") ||
      normalized.includes("fidelity") ||
      normalized.includes("loyalty")
    )
      return "membership";
    if (
      normalized.includes("multi") ||
      normalized.includes("bundle") ||
      normalized.includes("2x") ||
      normalized.includes("3x") ||
      /[23](?:ª|a)?\s+unidad/.test(normalized)
    )
      return "multi-buy";
    if (normalized.includes("percent") || normalized.includes("%"))
      return "percentage";
    if (normalized.includes("fixed") || normalized.includes("price"))
      return "fixed-price";
    return "other";
  }
  private assertEuro(currency: string, field: string): void {
    if (currency !== "EUR")
      throw new TypeError(
        `Alcampo ${field} currency ${currency} cannot be mapped`,
      );
  }
}
