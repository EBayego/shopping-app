import type {
  Market,
  ProductOffer,
  RetailerProduct,
} from "@shopping-app/domain";
import { MarketResolutionError } from "@shopping-app/retailer-contracts";

import type { EroskiProductDto } from "./eroski-dtos.js";

export class EroskiMapper {
  toProduct(
    dto: EroskiProductDto,
    market: Market,
    observedAt: Date,
  ): RetailerProduct {
    this.assertMarket(dto, market);
    return {
      retailer: "EROSKI",
      externalId: dto.externalId,
      name: dto.name,
      ...(dto.brand === undefined ? {} : { brand: dto.brand }),
      ...(dto.weight === undefined
        ? {}
        : { packageSize: dto.weight.amount, packageUnit: dto.weight.unit }),
      ...(dto.packageCount === undefined
        ? {}
        : { packageCount: dto.packageCount }),
      ...(dto.totalAmount === undefined
        ? {}
        : { totalAmount: dto.totalAmount }),
      variableWeight: dto.variableWeight,
      ...(dto.category === undefined ? {} : { category: dto.category }),
      ...(dto.subcategory === undefined
        ? {}
        : { subcategory: dto.subcategory }),
      ...(dto.image === undefined ? {} : { imageUrl: dto.image }),
      productUrl: dto.productUrl,
      marketId: market.externalId,
      observedAt,
    };
  }

  toOffer(
    dto: EroskiProductDto,
    market: Market,
    observedAt: Date,
  ): ProductOffer {
    this.assertMarket(dto, market);
    return {
      retailerProductId: dto.externalId,
      marketId: market.externalId,
      normalPrice: dto.normalPrice,
      ...(dto.promoPrice === undefined ? {} : { promoPrice: dto.promoPrice }),
      ...(dto.unitPrice === undefined
        ? {}
        : {
            pricePerUnit: dto.unitPrice.amount,
            referenceUnit: dto.unitPrice.unit,
          }),
      ...(dto.promotionType === undefined
        ? {}
        : { promotionType: dto.promotionType }),
      ...(dto.promotionText === undefined
        ? {}
        : { promotionText: dto.promotionText }),
      requiresMembership: dto.requiresMembership,
      available: dto.availability,
      observedAt,
    };
  }

  private assertMarket(dto: EroskiProductDto, market: Market): void {
    const metadataShopRef = market.metadata?.shopRef;
    const matches =
      market.retailer === "EROSKI" &&
      (market.externalId === dto.shopRef ||
        market.externalId === `shop-ref:${dto.shopRef}` ||
        metadataShopRef === dto.shopRef);
    if (!matches) {
      throw new MarketResolutionError("EROSKI", market.postalCode, {
        message: `Eroski page shopRef ${dto.shopRef} does not match the supplied market`,
      });
    }
  }
}
