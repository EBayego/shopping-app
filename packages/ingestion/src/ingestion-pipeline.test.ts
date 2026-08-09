import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerCategory,
  RetailerProduct,
} from "@shopping-app/domain";
import {
  RateLimitedError,
  type CatalogRetailerProvider,
  type RetailerSearchResult,
  type SearchRetailerProvider,
} from "@shopping-app/retailer-contracts";
import { describe, expect, it, vi } from "vitest";

import { RetailerIngestionPipeline } from "./ingestion-pipeline.js";
import { IngestionPersistenceCore } from "./persistence-core.js";
import {
  CatalogIngestionStrategy,
  SearchIngestionStrategy,
} from "./strategies.js";
import type {
  FinishSyncRunInput,
  IngestionScope,
  IngestionStore,
  StartSyncRunInput,
} from "./types.js";

const observedAt = new Date("2026-08-09T10:00:00.000Z");
const searchMarket: Market = {
  retailer: "DIA",
  externalId: "shop-1",
  postalCode: "50009",
};
const product: RetailerProduct = {
  retailer: "DIA",
  externalId: "milk-1",
  name: "Leche entera",
  variableWeight: false,
  marketId: searchMarket.externalId,
  observedAt,
};
const offer: ProductOffer = {
  retailerProductId: product.externalId,
  marketId: searchMarket.externalId,
  normalPrice: 1.25,
  requiresMembership: false,
  available: true,
  observedAt,
};

class FakeSearchProvider implements SearchRetailerProvider {
  resolveMarket(): Promise<Market> {
    return Promise.resolve(searchMarket);
  }

  searchProducts(): Promise<RetailerSearchResult> {
    return Promise.resolve({
      products: [product, product],
      offers: [offer, offer],
    });
  }

  getProduct(): Promise<RetailerProduct> {
    return Promise.resolve(product);
  }

  refreshPrices(): Promise<ProductOffer[]> {
    return Promise.resolve([offer]);
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      retailer: "DIA",
      status: "healthy",
      checkedAt: observedAt,
    });
  }
}

class FakeCatalogProvider implements CatalogRetailerProvider {
  readonly market: Market = {
    retailer: "MERCADONA",
    externalId: "warehouse-1",
    postalCode: "50009",
  };

  resolveMarket(): Promise<Market> {
    return Promise.resolve(this.market);
  }

  getCategories(): Promise<RetailerCategory[]> {
    return Promise.resolve([{ externalId: "dairy", name: "Lácteos" }]);
  }

  getProductsByCategory(): Promise<RetailerSearchResult> {
    return Promise.resolve({
      products: [
        {
          ...product,
          retailer: "MERCADONA",
          externalId: "catalog-milk-1",
          marketId: this.market.externalId,
        },
      ],
      offers: [
        {
          ...offer,
          retailerProductId: "catalog-milk-1",
          marketId: this.market.externalId,
        },
      ],
    });
  }

  async getProduct(): Promise<RetailerProduct> {
    return (await this.getProductsByCategory()).products[0]!;
  }

  async refreshPrices(): Promise<ProductOffer[]> {
    return (await this.getProductsByCategory()).offers;
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      retailer: "MERCADONA",
      status: "healthy",
      checkedAt: observedAt,
    });
  }
}

class FakeStore implements IngestionStore {
  readonly products = new Map<string, RetailerProduct>();
  readonly offers = new Map<string, ProductOffer>();
  readonly priceHistory: number[] = [];
  readonly finished: FinishSyncRunInput[] = [];
  productBatches = 0;
  offerBatches = 0;

  resolveRetailer(): Promise<string> {
    return Promise.resolve("retailer-id");
  }
  upsertMarket(): Promise<string> {
    return Promise.resolve("market-id");
  }
  startSyncRun(input: StartSyncRunInput): Promise<string> {
    return Promise.resolve(`run-${input.syncType}`);
  }
  upsertProducts(
    _scope: IngestionScope,
    products: readonly RetailerProduct[],
  ): Promise<void> {
    this.productBatches += 1;
    for (const item of products) this.products.set(item.externalId, item);
    return Promise.resolve();
  }
  upsertOffers(
    _scope: IngestionScope,
    offers: readonly ProductOffer[],
  ): Promise<void> {
    this.offerBatches += 1;
    for (const item of offers) {
      const key = `${item.retailerProductId}:${item.marketId}`;
      const previous = this.offers.get(key);
      if (
        previous === undefined ||
        previous.normalPrice !== item.normalPrice ||
        previous.promoPrice !== item.promoPrice ||
        previous.pricePerUnit !== item.pricePerUnit ||
        previous.referenceUnit !== item.referenceUnit
      ) {
        this.priceHistory.push(item.normalPrice);
      }
      this.offers.set(key, item);
    }
    return Promise.resolve();
  }
  finishSyncRun(input: FinishSyncRunInput): Promise<void> {
    this.finished.push(input);
    return Promise.resolve();
  }
  updateProviderHealth(): Promise<void> {
    return Promise.resolve();
  }
}

describe("RetailerIngestionPipeline", () => {
  it("ingests a SEARCH provider idempotently", async () => {
    const store = new FakeStore();
    const pipeline = new RetailerIngestionPipeline(
      new SearchIngestionStrategy(new FakeSearchProvider()),
      store,
      { batchSize: 1 },
    );

    await pipeline.ingest({ postalCode: "50009", query: "leche" });
    await pipeline.ingest({ postalCode: "50009", query: "leche" });

    expect(store.products.size).toBe(1);
    expect(store.offers.size).toBe(1);
    expect(store.priceHistory).toEqual([1.25]);
    expect(store.finished).toHaveLength(2);
  });

  it("ingests a CATALOG provider with no SEARCH through the same persistence core", async () => {
    const store = new FakeStore();
    const persistSpy = vi.spyOn(IngestionPersistenceCore.prototype, "persist");
    const searchPipeline = new RetailerIngestionPipeline(
      new SearchIngestionStrategy(new FakeSearchProvider()),
      store,
    );
    const catalogProvider = new FakeCatalogProvider();
    expect("searchProducts" in catalogProvider).toBe(false);
    const catalogPipeline = new RetailerIngestionPipeline(
      new CatalogIngestionStrategy(catalogProvider),
      store,
    );

    const searchResult = await searchPipeline.ingest({
      postalCode: "50009",
      query: "leche",
    });
    const catalogResult = await catalogPipeline.ingest({ postalCode: "50009" });

    expect(searchResult.productsSeen).toBe(1);
    expect(catalogResult.productsSeen).toBe(1);
    expect(store.products.has("milk-1")).toBe(true);
    expect(store.products.has("catalog-milk-1")).toBe(true);
    expect(persistSpy).toHaveBeenCalledTimes(2);
    persistSpy.mockRestore();
  });

  it("does not persist a dry-run", async () => {
    const store = new FakeStore();
    const result = await new RetailerIngestionPipeline(
      new SearchIngestionStrategy(new FakeSearchProvider()),
      store,
    ).ingest({ postalCode: "50009", query: "leche", dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(store.products.size).toBe(0);
    expect(store.finished).toHaveLength(0);
  });

  it("retries 429 using Retry-After", async () => {
    const provider = new FakeSearchProvider();
    const original = provider.searchProducts.bind(provider);
    const searchMock = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitedError("DIA", { retryAfterMs: 75 }))
      .mockImplementation(original);
    provider.searchProducts = searchMock;
    const sleep = vi.fn(() => Promise.resolve());
    const pipeline = new RetailerIngestionPipeline(
      new SearchIngestionStrategy(provider),
      new FakeStore(),
      {
        sleep,
        retry: { maxAttempts: 2 },
        circuitBreaker: { failureThreshold: 3 },
      },
    );

    await pipeline.ingest({
      postalCode: "50009",
      query: "leche",
      dryRun: true,
    });
    expect(sleep).toHaveBeenCalledWith(75);
    expect(searchMock).toHaveBeenCalledTimes(2);
  });
});
