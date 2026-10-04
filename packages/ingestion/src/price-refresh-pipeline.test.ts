import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerProduct,
} from "@shopping-app/domain";
import {
  ProviderAccessBlockedError,
  ProductNotFoundError,
  RateLimitedError,
  type PriceRefreshRetailerProvider,
} from "@shopping-app/retailer-contracts";
import { describe, expect, it, vi } from "vitest";

import { PriceRefreshPipeline } from "./price-refresh-pipeline.js";
import { PriceRefreshIngestionStrategy } from "./price-refresh-strategy.js";
import { CatalogPriceRefreshIngestionStrategy } from "./catalog-price-refresh-strategy.js";
import type {
  FinishSyncRunInput,
  IngestionScope,
  PriceRefreshCandidate,
  PriceRefreshStore,
  StartSyncRunInput,
} from "./types.js";

const now = new Date("2026-08-09T12:00:00Z");
const market: Market = {
  retailer: "DIA",
  externalId: "shop-1",
  postalCode: "50009",
};

function offer(id: string, observedAt = now): ProductOffer {
  return {
    retailerProductId: id,
    marketId: market.externalId,
    normalPrice: 1.25,
    requiresMembership: false,
    available: true,
    observedAt,
  };
}

class FakeRefreshProvider implements PriceRefreshRetailerProvider {
  readonly calls: string[] = [];
  private readonly refresh: (id: string) => Promise<ProductOffer[]>;

  constructor(
    refresh: ((id: string) => Promise<ProductOffer[]>) | undefined = undefined,
    private readonly healthStatus: ProviderHealth["status"] = "healthy",
    private readonly resolvedMarket: Market = market,
  ) {
    this.refresh =
      refresh ??
      ((id) =>
        Promise.resolve([
          { ...offer(id), marketId: this.resolvedMarket.externalId },
        ]));
  }

  resolveMarket(): Promise<Market> {
    return Promise.resolve(this.resolvedMarket);
  }
  getProduct(): Promise<RetailerProduct> {
    return Promise.reject(new Error("not used"));
  }
  refreshPrices(ids: string[]): Promise<ProductOffer[]> {
    const id = ids[0]!;
    this.calls.push(id);
    return this.refresh(id);
  }
  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      retailer: this.resolvedMarket.retailer,
      status: this.healthStatus,
      checkedAt: now,
    });
  }
}

class FakeRefreshStore implements PriceRefreshStore {
  readonly persistedOffers: ProductOffer[] = [];
  readonly finished: FinishSyncRunInput[] = [];
  readonly health: ProviderHealth[] = [];
  starts = 0;

  constructor(readonly candidates: readonly PriceRefreshCandidate[]) {}

  resolveRetailer(): Promise<string> {
    return Promise.resolve("retailer-id");
  }
  findMarketId(): Promise<string | undefined> {
    return Promise.resolve("market-id");
  }
  upsertMarket(): Promise<string> {
    return Promise.resolve("market-id");
  }
  listPriceRefreshCandidates(): Promise<readonly PriceRefreshCandidate[]> {
    return Promise.resolve(this.candidates);
  }
  getOfferFreshnessConfig(): Promise<{
    staleAfterMs: number;
    veryStaleAfterMs: number;
  }> {
    return Promise.resolve({
      staleAfterMs: 6 * 60 * 60 * 1_000,
      veryStaleAfterMs: 24 * 60 * 60 * 1_000,
    });
  }
  startSyncRun(_input: StartSyncRunInput): Promise<string> {
    void _input;
    this.starts += 1;
    return Promise.resolve("refresh-run");
  }
  upsertProducts(): Promise<void> {
    return Promise.reject(new Error("PRICE_REFRESH must not persist products"));
  }
  upsertOffers(
    _scope: IngestionScope,
    offers: readonly ProductOffer[],
  ): Promise<void> {
    this.persistedOffers.push(...offers);
    return Promise.resolve();
  }
  recordCatalogProductMisses(): Promise<void> {
    return Promise.resolve();
  }
  deactivateProducts(
    _scope: IngestionScope,
    externalIds: readonly string[],
  ): Promise<void> {
    this.deactivatedProductIds.push(...externalIds);
    return Promise.resolve();
  }
  readonly deactivatedProductIds: string[] = [];
  finishSyncRun(input: FinishSyncRunInput): Promise<void> {
    this.finished.push(input);
    return Promise.resolve();
  }
  updateProviderHealth(
    _scope: IngestionScope,
    health: ProviderHealth,
  ): Promise<void> {
    this.health.push(health);
    return Promise.resolve();
  }
}

const staleCandidates: PriceRefreshCandidate[] = [
  {
    retailerProductExternalId: "good",
    offerObservedAt: new Date(now.getTime() - 25 * 60 * 60 * 1_000),
    inActiveList: false,
  },
  {
    retailerProductExternalId: "bad",
    offerObservedAt: new Date(now.getTime() - 25 * 60 * 60 * 1_000),
    inActiveList: false,
  },
];

describe("PriceRefreshPipeline", () => {
  it("uses catalog prices for a large selection and confirms missing products by detail", async () => {
    const sourceObservedAt = new Date(now.getTime() - 60_000);
    const provider = Object.assign(
      new FakeRefreshProvider((id) =>
        Promise.reject(new ProductNotFoundError("DIA", id)),
      ),
      {
        getCategories: vi.fn(() =>
          Promise.resolve([{ externalId: "milk", name: "Milk", level: 1 }]),
        ),
        getProductsByCategory: vi.fn(() =>
          Promise.resolve({
            products: [],
            offers: [offer("good", sourceObservedAt), offer("not-selected")],
          }),
        ),
      },
    );
    const store = new FakeRefreshStore(staleCandidates);
    const result = await new PriceRefreshPipeline(
      new CatalogPriceRefreshIngestionStrategy(provider, 2),
      store,
      { now: () => now },
    ).refresh({ postalCode: "50009" });
    expect(result.status).toBe("succeeded");
    expect(provider.calls).toEqual(["bad"]);
    expect(provider.getProductsByCategory).toHaveBeenCalledTimes(1);
    expect(store.persistedOffers).toEqual([offer("good", sourceObservedAt)]);
    expect(store.deactivatedProductIds).toEqual(["bad"]);
    expect(store.finished[0]?.offersSeen).toBe(1);
  });

  it("clears catalog observations before a later small manual refresh", async () => {
    const oldObservedAt = new Date(now.getTime() - 60_000);
    const provider = Object.assign(
      new FakeRefreshProvider((id) =>
        Promise.resolve([{ ...offer(id), normalPrice: 2.49 }]),
      ),
      {
        getCategories: vi.fn(() =>
          Promise.resolve([{ externalId: "milk", name: "Milk", level: 1 }]),
        ),
        getProductsByCategory: vi.fn(() =>
          Promise.resolve({
            products: [],
            offers: [offer("good", oldObservedAt), offer("bad", oldObservedAt)],
          }),
        ),
      },
    );
    const store = new FakeRefreshStore(staleCandidates);
    const pipeline = new PriceRefreshPipeline(
      new CatalogPriceRefreshIngestionStrategy(provider, 2),
      store,
      { now: () => now },
    );
    await pipeline.refresh({ postalCode: "50009" });
    await pipeline.refresh({ postalCode: "50009", productIds: ["good"] });
    expect(provider.getCategories).toHaveBeenCalledTimes(1);
    expect(provider.calls).toEqual(["good"]);
    expect(store.persistedOffers.at(-1)).toEqual({
      ...offer("good"),
      normalPrice: 2.49,
    });
  });

  it("does not fall back to thousands of detail requests when the whole catalog is blocked", async () => {
    const provider = Object.assign(new FakeRefreshProvider(), {
      getCategories: () =>
        Promise.resolve([{ externalId: "milk", name: "Milk", level: 1 }]),
      getProductsByCategory: vi.fn(() =>
        Promise.reject(new ProviderAccessBlockedError("DIA")),
      ),
    });
    const store = new FakeRefreshStore(staleCandidates);
    await expect(
      new PriceRefreshPipeline(
        new CatalogPriceRefreshIngestionStrategy(provider, 2),
        store,
        { now: () => now },
      ).refresh({ postalCode: "50009" }),
    ).rejects.toThrow();
    expect(provider.getProductsByCategory).toHaveBeenCalledTimes(1);
    expect(provider.calls).toEqual([]);
    expect(store.persistedOffers).toEqual([]);
    expect(store.deactivatedProductIds).toEqual([]);
    expect(store.finished[0]?.status).toBe("failed");
  });

  it("marks blocked price access as unavailable without retrying or retiring products", async () => {
    const provider = new FakeRefreshProvider(() =>
      Promise.reject(new ProviderAccessBlockedError("DIA")),
    );
    const store = new FakeRefreshStore([staleCandidates[0]!]);
    const sleep = vi.fn(() => Promise.resolve());
    const result = await new PriceRefreshPipeline(
      new PriceRefreshIngestionStrategy(provider),
      store,
      { now: () => now, sleep },
    ).refresh({ postalCode: "50009" });
    expect(result.status).toBe("failed");
    expect(provider.calls).toEqual(["good"]);
    expect(sleep).not.toHaveBeenCalled();
    expect(store.deactivatedProductIds).toEqual([]);
    expect(store.health[0]?.status).toBe("unavailable");
  });

  it("persists successes and retires confirmed missing products", async () => {
    const provider = new FakeRefreshProvider((id) =>
      id === "bad"
        ? Promise.reject(new ProductNotFoundError("DIA", id))
        : Promise.resolve([offer(id)]),
    );
    const store = new FakeRefreshStore(staleCandidates);
    const result = await new PriceRefreshPipeline(
      new PriceRefreshIngestionStrategy(provider),
      store,
      { now: () => now },
    ).refresh({ postalCode: "50009" });

    expect(result.status).toBe("succeeded");
    expect(result.failures).toHaveLength(0);
    expect(result.retiredProductIds).toEqual(["bad"]);
    expect(store.deactivatedProductIds).toEqual(["bad"]);
    expect(store.persistedOffers.map((item) => item.retailerProductId)).toEqual(
      ["good"],
    );
    expect(store.finished[0]?.status).toBe("succeeded");
  });

  it("reuses 429 Retry-After resilience", async () => {
    let attempts = 0;
    const provider = new FakeRefreshProvider((id) => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new RateLimitedError("DIA", { retryAfterMs: 80 }))
        : Promise.resolve([offer(id)]);
    });
    const sleep = vi.fn(() => Promise.resolve());
    const result = await new PriceRefreshPipeline(
      new PriceRefreshIngestionStrategy(provider),
      new FakeRefreshStore([staleCandidates[0]!]),
      { now: () => now, sleep, retry: { maxAttempts: 2 } },
    ).refresh({ postalCode: "50009" });

    expect(result.status).toBe("succeeded");
    expect(sleep).toHaveBeenCalledWith(80);
    expect(attempts).toBe(2);
  });

  it("does not call the provider or write during dry-run", async () => {
    const provider = new FakeRefreshProvider();
    const store = new FakeRefreshStore(staleCandidates);
    const result = await new PriceRefreshPipeline(
      new PriceRefreshIngestionStrategy(provider),
      store,
      { now: () => now },
    ).refresh({ postalCode: "50009", dryRun: true });

    expect(result.attempted).toBe(2);
    expect(provider.calls).toEqual([]);
    expect(store.starts).toBe(0);
    expect(store.persistedOffers).toEqual([]);
  });

  it("preserves the source observedAt for cached old data", async () => {
    const actuallyObservedAt = new Date("2026-08-08T12:00:00Z");
    const provider = new FakeRefreshProvider((id) =>
      Promise.resolve([offer(id, actuallyObservedAt)]),
    );
    const store = new FakeRefreshStore([staleCandidates[0]!]);
    await new PriceRefreshPipeline(
      new PriceRefreshIngestionStrategy(provider),
      store,
      { now: () => now },
    ).refresh({ postalCode: "50009" });

    expect(store.persistedOffers[0]?.observedAt).toEqual(actuallyObservedAt);
  });

  it("keeps provider runs independent when another provider is degraded", async () => {
    const degradedStore = new FakeRefreshStore([staleCandidates[0]!]);
    const healthyStore = new FakeRefreshStore([staleCandidates[0]!]);
    const degraded = new PriceRefreshPipeline(
      new PriceRefreshIngestionStrategy(
        new FakeRefreshProvider(undefined, "degraded", {
          retailer: "MERCADONA",
          externalId: "warehouse-1",
          postalCode: "50009",
        }),
      ),
      degradedStore,
      { now: () => now },
    );
    const healthy = new PriceRefreshPipeline(
      new PriceRefreshIngestionStrategy(new FakeRefreshProvider()),
      healthyStore,
      { now: () => now },
    );

    const [degradedResult, healthyResult] = await Promise.all([
      degraded.refresh({ postalCode: "50009" }),
      healthy.refresh({ postalCode: "50009" }),
    ]);
    expect(degradedResult.status).toBe("succeeded");
    expect(degradedStore.health[0]?.status).toBe("degraded");
    expect(healthyResult.status).toBe("succeeded");
    expect(healthyStore.persistedOffers).toHaveLength(1);
  });
});
