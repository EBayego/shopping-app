import type {
  Market,
  ProductOffer,
  ProviderHealth,
  Retailer,
  RetailerProduct,
} from "@shopping-app/domain";
import {
  MarketResolutionError,
  ProductNotFoundError,
  type RetailerProvider,
  type RetailerSearchResult,
} from "@shopping-app/retailer-contracts";

const PRODUCT_FIXTURES = [
  {
    externalId: "261354",
    name: "Leche entera mock",
    brand: "Marca mock",
    packageSize: 1,
    packageUnit: "l" as const,
    normalPrice: 1.19,
    promoPrice: 0.99,
  },
  {
    externalId: "100001",
    name: "Arroz redondo mock",
    brand: "Marca mock",
    packageSize: 1,
    packageUnit: "kg" as const,
    normalPrice: 1.55,
  },
] as const;

export class MockRetailerProvider implements RetailerProvider {
  constructor(readonly retailer: Retailer) {}

  resolveMarket(postalCode: string): Promise<Market> {
    if (postalCode.trim() === "") {
      return Promise.reject(
        new MarketResolutionError(this.retailer, postalCode),
      );
    }

    return Promise.resolve({
      retailer: this.retailer,
      externalId: `mock-${this.retailer.toLowerCase()}-${postalCode}`,
      postalCode,
      name: `${this.retailer} mock market`,
      metadata: { mock: true },
    });
  }

  searchProducts(query: string, market: Market): Promise<RetailerSearchResult> {
    return Promise.resolve().then(() => {
      this.assertMarket(market);
      const normalizedQuery = query.trim().toLocaleLowerCase("es-ES");

      const fixtures = PRODUCT_FIXTURES.filter((fixture) =>
        fixture.name.toLocaleLowerCase("es-ES").includes(normalizedQuery),
      );
      return {
        products: fixtures.map((fixture) => this.toProduct(fixture, market)),
        offers: fixtures.map((fixture) => this.toOffer(fixture, market)),
      };
    });
  }

  getProduct(externalId: string, market: Market): Promise<RetailerProduct> {
    return Promise.resolve().then(() => {
      this.assertMarket(market);
      const fixture = PRODUCT_FIXTURES.find(
        (candidate) => candidate.externalId === externalId,
      );
      if (fixture === undefined) {
        throw new ProductNotFoundError(this.retailer, externalId);
      }
      return this.toProduct(fixture, market);
    });
  }

  refreshPrices(productIds: string[], market: Market): Promise<ProductOffer[]> {
    return Promise.resolve().then(() => {
      this.assertMarket(market);

      return productIds.map((productId) => {
        const fixture = PRODUCT_FIXTURES.find(
          (candidate) => candidate.externalId === productId,
        );
        if (fixture === undefined) {
          throw new ProductNotFoundError(this.retailer, productId);
        }

        return this.toOffer(fixture, market);
      });
    });
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      retailer: this.retailer,
      status: "healthy",
      checkedAt: new Date(),
      latencyMs: 0,
      message: "Mock provider available",
    });
  }

  private assertMarket(market: Market): void {
    if (market.retailer !== this.retailer) {
      throw new MarketResolutionError(this.retailer, market.postalCode, {
        message: `Market belongs to ${market.retailer}, not ${this.retailer}`,
      });
    }
  }

  private toProduct(
    fixture: (typeof PRODUCT_FIXTURES)[number],
    market: Market,
  ): RetailerProduct {
    return {
      retailer: this.retailer,
      externalId: fixture.externalId,
      name: fixture.name,
      brand: fixture.brand,
      packageSize: fixture.packageSize,
      packageUnit: fixture.packageUnit,
      packageCount: 1,
      totalAmount: fixture.packageSize,
      variableWeight: false,
      marketId: market.externalId,
      observedAt: new Date(),
      rawData: { mock: true },
    };
  }

  private toOffer(
    fixture: (typeof PRODUCT_FIXTURES)[number],
    market: Market,
  ): ProductOffer {
    return {
      retailerProductId: fixture.externalId,
      marketId: market.externalId,
      normalPrice: fixture.normalPrice,
      ...(fixture.externalId === "261354"
        ? {
            promoPrice: fixture.promoPrice,
            promotionType: "fixed-price" as const,
            promotionText: "Promoción mock",
          }
        : {}),
      pricePerUnit: fixture.normalPrice / fixture.packageSize,
      referenceUnit: fixture.packageUnit,
      requiresMembership: false,
      available: true,
      observedAt: new Date(),
    };
  }
}

export function createMockProvider(retailer: Retailer): RetailerProvider {
  return new MockRetailerProvider(retailer);
}
