import {
  CatalogPriceRefreshIngestionStrategy,
  ProviderExecutor,
  silentLogger,
} from "@shopping-app/ingestion";
import { MercadonaProvider } from "@shopping-app/provider-mercadona";
import { describe, expect, it } from "vitest";

describe.skipIf(process.env.RUN_LIVE_PROVIDER_TESTS !== "true")(
  "Mercadona catalog price refresh live",
  () => {
    it("refreshes a large selection from catalog prices instead of individual detail calls", async () => {
      let categoryRequests = 0;
      let detailRequests = 0;
      const countedFetch: typeof fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname.includes("/categories/")) categoryRequests += 1;
        if (url.pathname.includes("/products/")) detailRequests += 1;
        return fetch(input, init);
      };
      const provider = new MercadonaProvider({
        fetch: countedFetch,
        timeoutMs: 15_000,
        maxRetries: 0,
      });
      const market = await provider.resolveMarket("50009");
      const categories = await provider.getCategories(market);
      const parents = new Set(
        categories.flatMap((category) =>
          category.parentExternalId === undefined
            ? []
            : [category.parentExternalId],
        ),
      );
      const leaves = categories.filter(
        (category) => !parents.has(category.externalId),
      );
      const selected = new Set<string>(["33190", "33357"]);
      for (const category of leaves) {
        const observations = await provider.getProductsByCategory(
          category.externalId,
          market,
        );
        for (const product of observations.products)
          selected.add(product.externalId);
        if (selected.size >= 500) break;
      }
      expect(selected.size).toBeGreaterThanOrEqual(500);
      categoryRequests = 0;
      detailRequests = 0;
      const startedAt = new Date();
      const strategy = new CatalogPriceRefreshIngestionStrategy(provider);
      const runner = new ProviderExecutor(
        "MERCADONA",
        2,
        { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
        { failureThreshold: 5, resetAfterMs: 30_000 },
        silentLogger,
        () => new Date(),
        () => Promise.resolve(),
        () => 0.5,
      );
      await strategy.prepareRefresh([...selected], market, runner);
      const offers = (
        await Promise.all(
          [...selected].map((id) =>
            strategy.refreshProduct(id, market, runner),
          ),
        )
      ).flat();
      console.log(
        JSON.stringify({
          event: "mercadona.catalog_refresh_probe",
          selected: selected.size,
          refreshed: offers.length,
          categoryRequests,
          detailRequests,
          durationMs: Date.now() - startedAt.getTime(),
        }),
      );
      expect(new Set(offers.map((offer) => offer.retailerProductId))).toEqual(
        selected,
      );
      expect(categoryRequests).toBeGreaterThan(0);
      expect(categoryRequests).toBeLessThanOrEqual(leaves.length + 1);
      expect(detailRequests).toBeLessThan(selected.size);
      expect(
        offers.every(
          (offer) =>
            offer.marketId === market.externalId &&
            offer.observedAt.getTime() >= startedAt.getTime() &&
            Number.isFinite(offer.normalPrice),
        ),
      ).toBe(true);
    }, 180_000);
  },
);
