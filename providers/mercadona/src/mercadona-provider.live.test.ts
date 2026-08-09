import { describe, expect, it } from "vitest";

import { MercadonaProvider } from "./mercadona-provider.js";

describe.skipIf(process.env.RUN_LIVE_PROVIDER_TESTS !== "true")(
  "MercadonaProvider live",
  () => {
    it("resuelve 50009 y obtiene catálogo y producto", async () => {
      const provider = new MercadonaProvider({ timeoutMs: 15_000 });
      const market = await provider.resolveMarket("50009");
      const categories = await provider.getCategories(market);
      const category = await provider.getProductsByCategory("72", market);
      const product = await provider.getProduct("10382", market);
      const refreshStartedAt = new Date();
      const [offer] = await provider.refreshPrices(["10382"], market);

      expect(market).toEqual({
        retailer: "MERCADONA",
        externalId: "warehouse:4491",
        postalCode: "50009",
        name: "Mercadona 50009",
        metadata: { warehouse: "4491" },
      });
      expect(categories.length).toBeGreaterThan(0);
      expect(category.products.length).toBeGreaterThan(0);
      expect(
        category.products.every(
          (candidate) => candidate.marketId === market.externalId,
        ),
      ).toBe(true);
      expect(
        category.offers.every(
          (candidate) => candidate.marketId === market.externalId,
        ),
      ).toBe(true);
      expect(category.offers).toHaveLength(category.products.length);
      expect(product).toMatchObject({
        retailer: "MERCADONA",
        externalId: "10382",
        marketId: "warehouse:4491",
      });
      expect(offer).toMatchObject({
        retailerProductId: "10382",
        marketId: "warehouse:4491",
      });
      expect(offer?.normalPrice).toBeGreaterThan(0);
      expect(offer?.observedAt.getTime()).toBeGreaterThanOrEqual(
        refreshStartedAt.getTime(),
      );
      expect(market.externalId).toBe("warehouse:4491");
    }, 60_000);
  },
);
