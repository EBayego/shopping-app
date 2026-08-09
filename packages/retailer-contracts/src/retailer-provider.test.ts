import { describe, expect, it } from "vitest";

import type { ProviderHealth } from "@shopping-app/domain";

import {
  supportsCatalog,
  type CatalogRetailerProvider,
  type RetailerProvider,
} from "./retailer-provider.js";

function baseProvider(): RetailerProvider {
  return {
    resolveMarket: () => Promise.reject(new Error("not used")),
    searchProducts: () => Promise.resolve({ products: [], offers: [] }),
    getProduct: () => Promise.reject(new Error("not used")),
    refreshPrices: () => Promise.resolve([]),
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
