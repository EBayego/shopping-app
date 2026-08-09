import type {
  Market,
  ProductOffer,
  RetailerProduct,
} from "@shopping-app/domain";

import type { AlcampoProductDto, AlcampoQuantityDto } from "./alcampo-dtos.js";
import type { AlcampoSessionContext } from "./alcampo-session-context.js";

export class AlcampoMapper {
  toMarket(context: AlcampoSessionContext): Market {
    return Object.freeze({
      retailer: "ALCAMPO",
      externalId: context.marketExternalId,
      postalCode: context.postalCode,
      name: `Alcampo ${context.postalCode}`,
    });
  }

  toProduct(
    dto: AlcampoProductDto,
    market: Market,
    observedAt: Date,
  ): RetailerProduct {
    const packageQuantity =
      dto.catchweight?.typical ?? this.packageQuantity(dto.packSizeDescription);
    const category = dto.categoryPath[0];
    const subcategory =
      dto.categoryPath.length > 1 ? dto.categoryPath.at(-1) : undefined;
    return {
      retailer: "ALCAMPO",
      externalId: dto.retailerProductId,
      name: dto.name,
      brand: dto.brand,
      ...(packageQuantity === undefined
        ? {}
        : {
            packageSize: packageQuantity.amount,
            packageUnit: packageQuantity.unit,
          }),
      variableWeight: dto.type === "CATCHWEIGHT",
      ...(category === undefined ? {} : { category }),
      ...(subcategory === undefined ? {} : { subcategory }),
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
    this.assertEuro(dto.unitPrice.currency, "unit price");
    return {
      retailerProductId: dto.retailerProductId,
      marketId: market.externalId,
      normalPrice: dto.price.amount,
      pricePerUnit: dto.unitPrice.amount,
      referenceUnit: dto.unitPrice.unit,
      requiresMembership: false,
      available: dto.available,
      observedAt,
    };
  }

  private packageQuantity(description: string): AlcampoQuantityDto | undefined {
    const match = description.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
    if (match?.[1] === undefined || match[2] === undefined) return undefined;
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    return {
      amount,
      unit: match[2].toLowerCase() as AlcampoQuantityDto["unit"],
    };
  }

  private assertEuro(currency: string, field: string): void {
    if (currency !== "EUR") {
      throw new TypeError(
        `Alcampo ${field} currency ${currency} cannot be mapped`,
      );
    }
  }
}
