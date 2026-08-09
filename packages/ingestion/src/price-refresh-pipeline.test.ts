import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerProduct,
} from "@shopping-app/domain";
import {
  ProductNotFoundError,
  RateLimitedError,
  type PriceRefreshRetailerProvider,
} from "@shopping-app/retailer-contracts";
import { describe, expect, it, vi } from "vitest";

import { PriceRefreshPipeline } from "./price-refresh-pipeline.js";
import { PriceRefreshIngestionStrategy } from "./price-refresh-strategy.js";
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
  it("persists successes and records partial without marking the provider unavailable", async () => {
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

    expect(result.status).toBe("partial");
    expect(result.failures).toHaveLength(1);
    expect(store.persistedOffers.map((item) => item.retailerProductId)).toEqual(
      ["good"],
    );
    expect(store.finished[0]?.status).toBe("partial");
    expect(store.health[0]?.status).toBe("degraded");
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
