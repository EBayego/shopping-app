import type {
  Market,
  ProductOffer,
  ProductUnit,
  RetailerCategory,
  RetailerProduct,
} from "@shopping-app/domain";

import type {
  MercadonaCategoryDto,
  MercadonaProductDto,
} from "./mercadona-dtos.js";
import type { MercadonaMarketContext } from "./mercadona-market-context.js";

export class MercadonaMapper {
  toMarket(context: MercadonaMarketContext): Market {
    return Object.freeze({
      retailer: "MERCADONA",
      externalId: `warehouse:${context.warehouse}`,
      postalCode: context.postalCode,
      name: `Mercadona ${context.postalCode}`,
      metadata: Object.freeze({ warehouse: context.warehouse }),
    });
  }

  toCategories(dto: MercadonaCategoryDto): RetailerCategory[] {
    return [
      {
        externalId: dto.id,
        name: dto.name,
        level: 0,
        ...(dto.order === undefined ? {} : { order: dto.order }),
      },
      ...dto.categories.map((category) => ({
        externalId: category.id,
        name: category.name,
        parentExternalId: dto.id,
        level: 1,
        ...(category.order === undefined ? {} : { order: category.order }),
      })),
    ];
  }

  toProduct(
    dto: MercadonaProductDto,
    market: Market,
    observedAt: Date,
    categoryName?: string,
  ): RetailerProduct {
    const packageUnit = this.toProductUnit(dto.priceInstructions.sizeFormat);
    const packageSize = dto.priceInstructions.isPack
      ? dto.priceInstructions.packSize
      : dto.priceInstructions.unitSize;
    const category = categoryName ?? dto.categories[0]?.name;
    return {
      retailer: "MERCADONA",
      externalId: dto.id,
      name: dto.displayName,
      ...(dto.brand === undefined ? {} : { brand: dto.brand }),
      ...(dto.ean === undefined ? {} : { gtin: dto.ean, ean: dto.ean }),
      ...(packageSize === undefined || packageUnit === undefined
        ? {}
        : { packageSize, packageUnit }),
      ...(dto.priceInstructions.totalUnits === undefined
        ? {}
        : { packageCount: dto.priceInstructions.totalUnits }),
      ...(dto.priceInstructions.unitSize === undefined ||
      !dto.priceInstructions.isPack
        ? {}
        : { totalAmount: dto.priceInstructions.unitSize }),
      variableWeight: dto.variableWeight ?? dto.priceInstructions.approxSize,
      ...(category === undefined ? {} : { category }),
      ...(dto.subcategory === undefined
        ? {}
        : { subcategory: dto.subcategory.name }),
      ...(dto.thumbnail === undefined
        ? {}
        : { imageUrl: this.normalizedHttpUrl(dto.thumbnail) }),
      ...(dto.shareUrl === undefined
        ? {}
        : { productUrl: this.normalizedHttpUrl(dto.shareUrl) }),
      marketId: market.externalId,
      observedAt,
    };
  }

  toOffer(
    dto: MercadonaProductDto,
    market: Market,
    observedAt: Date,
  ): ProductOffer {
    const referenceUnit = this.toProductUnit(
      dto.priceInstructions.referenceFormat,
    );
    return {
      retailerProductId: dto.id,
      marketId: market.externalId,
      normalPrice: dto.priceInstructions.unitPrice,
      ...(dto.priceInstructions.referencePrice === undefined
        ? {}
        : { pricePerUnit: dto.priceInstructions.referencePrice }),
      ...(referenceUnit === undefined ? {} : { referenceUnit }),
      requiresMembership: false,
      available: dto.published && dto.unavailableFrom === undefined,
      observedAt,
    };
  }

  private toProductUnit(value: string | undefined): ProductUnit | undefined {
    switch (value?.trim().toLocaleLowerCase("es-ES")) {
      case "ud":
      case "ud.":
      case "unidad":
        return "unit";
      case "g":
        return "g";
      case "kg":
        return "kg";
      case "ml":
        return "ml";
      case "l":
        return "l";
      default:
        return undefined;
    }
  }

  private normalizedHttpUrl(value: string): string {
    const url = new URL(value, "https://tienda.mercadona.es/");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("Mercadona returned a non-HTTP URL");
    }
    return url.href;
  }
}
