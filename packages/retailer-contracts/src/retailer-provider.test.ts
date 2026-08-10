import { describe, expect, it } from "vitest";

import type { ProviderHealth } from "@shopping-app/domain";

import {
  supportsCatalog,
  supportsPriceRefresh,
  supportsSearch,
  type CatalogRetailerProvider,
  type RetailerProvider,
  type PriceRefreshRetailerProvider,
  type SearchRetailerProvider,
} from "./retailer-provider.js";

function baseProvider(): RetailerProvider {
  return {
    resolveMarket: () => Promise.reject(new Error("not used")),
    getProduct: () => Promise.reject(new Error("not used")),
    healthCheck: () =>
      Promise.resolve({
        retailer: "MERCADONA",
        status: "healthy",
        checkedAt: new Date(),
      } satisfies ProviderHealth),
  };
}

describe("supportsCatalog", () => {
  it("detecta la capability sin depender de una clase o retailer", async () => {
    const provider: CatalogRetailerProvider = {
      ...baseProvider(),
      getCategories: () =>
        Promise.resolve([{ externalId: "72", name: "Leche", level: 0 }]),
      getProductsByCategory: () =>
        Promise.resolve({ products: [], offers: [] }),
    };

    expect(supportsCatalog(provider)).toBe(true);
    if (supportsCatalog(provider)) {
      await expect(
        provider.getCategories({
          retailer: "MERCADONA",
          externalId: "warehouse:4491",
          postalCode: "50009",
        }),
      ).resolves.toHaveLength(1);
    }
    expect(supportsCatalog(baseProvider())).toBe(false);
  });
});

describe("supportsSearch", () => {
  it("narrows only providers that actually expose searchProducts", () => {
    const provider: SearchRetailerProvider = {
      ...baseProvider(),
      searchProducts: () => Promise.resolve({ products: [], offers: [] }),
    };
    expect(supportsSearch(provider)).toBe(true);
    expect(supportsSearch(baseProvider())).toBe(false);
  });
});

describe("supportsPriceRefresh", () => {
  it("detects the explicit capability without exceptions", () => {
    const provider: PriceRefreshRetailerProvider = {
      ...baseProvider(),
      refreshPrices: () => Promise.resolve([]),
    };
    expect(supportsPriceRefresh(provider)).toBe(true);
    expect(supportsPriceRefresh(baseProvider())).toBe(false);
  });
});
