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

  getProductsByCategory(categoryId: string): Promise<RetailerSearchResult> {
    void categoryId;
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
    return (await this.getProductsByCategory("dairy")).products[0]!;
  }

  async refreshPrices(): Promise<ProductOffer[]> {
    return (await this.getProductsByCategory("dairy")).offers;
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      retailer: "MERCADONA",
      status: "healthy",
      checkedAt: observedAt,
    });
  }
}

class PartialCatalogProvider extends FakeCatalogProvider {
  readonly requestedCategoryIds: string[] = [];

  override getCategories(): Promise<RetailerCategory[]> {
    return Promise.resolve([
      { externalId: "root", name: "Root", level: 0 },
      {
        externalId: "dairy",
        name: "Lácteos",
        parentExternalId: "root",
        level: 1,
      },
      {
        externalId: "broken",
        name: "Rota",
        parentExternalId: "root",
        level: 1,
      },
    ]);
  }

  override getProductsByCategory(
    categoryId: string,
  ): Promise<RetailerSearchResult> {
    this.requestedCategoryIds.push(categoryId);
    return categoryId === "broken"
      ? Promise.reject(new Error("category unavailable"))
      : super.getProductsByCategory(categoryId);
  }
}

class LargeCatalogProvider extends FakeCatalogProvider {
  activeCategories = 0;
  maxActiveCategories = 0;
  requestedCategories = 0;

  constructor(private readonly categoryCount: number) {
    super();
  }

  override getCategories(): Promise<RetailerCategory[]> {
    return Promise.resolve(
      Array.from({ length: this.categoryCount }, (_, index) => ({
        externalId: `category-${index}`,
        name: `Category ${index}`,
      })),
    );
  }

  override async getProductsByCategory(
    categoryId: string,
  ): Promise<RetailerSearchResult> {
    this.requestedCategories += 1;
    this.activeCategories += 1;
    this.maxActiveCategories = Math.max(
      this.maxActiveCategories,
      this.activeCategories,
    );
    try {
      await Promise.resolve();
      const externalId = `product-${categoryId}`;
      return {
        products: [
          {
            ...product,
            retailer: "MERCADONA",
            externalId,
            marketId: this.market.externalId,
          },
        ],
        offers: [
          {
            ...offer,
            retailerProductId: externalId,
            marketId: this.market.externalId,
          },
        ],
      };
    } finally {
      this.activeCategories -= 1;
    }
  }
}

class FakeStore implements IngestionStore {
  readonly products = new Map<string, RetailerProduct>();
  readonly offers = new Map<string, ProductOffer>();
  readonly priceHistory: number[] = [];
  readonly finished: FinishSyncRunInput[] = [];
  productBatches = 0;
  offerBatches = 0;
  largestProductBatch = 0;
  largestOfferBatch = 0;
  readonly catalogMissRuns: string[] = [];
  readonly catalogMissProductIds: string[][] = [];

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
    this.largestProductBatch = Math.max(
      this.largestProductBatch,
      products.length,
    );
    for (const item of products) this.products.set(item.externalId, item);
    return Promise.resolve();
  }
  upsertOffers(
    _scope: IngestionScope,
    offers: readonly ProductOffer[],
  ): Promise<void> {
    this.offerBatches += 1;
    this.largestOfferBatch = Math.max(this.largestOfferBatch, offers.length);
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
  recordCatalogProductMisses(
    _scope: IngestionScope,
    syncRunId: string,
    seenExternalIds: readonly string[],
  ): Promise<void> {
    this.catalogMissRuns.push(syncRunId);
    this.catalogMissProductIds.push([...seenExternalIds]);
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
    const completeSpy = vi.spyOn(
      IngestionPersistenceCore.prototype,
      "complete",
    );
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
    expect(store.catalogMissRuns).toEqual(["run-catalog_sync"]);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(completeSpy).toHaveBeenCalledTimes(2);
    persistSpy.mockRestore();
    completeSpy.mockRestore();
  });

  it("streams a large catalog with bounded category concurrency and persistence batches", async () => {
    const categoryCount = 4_000;
    const store = new FakeStore();
    const provider = new LargeCatalogProvider(categoryCount);

    const result = await new RetailerIngestionPipeline(
      new CatalogIngestionStrategy(provider),
      store,
      { batchSize: 50 },
    ).ingest({ postalCode: "50009" });

    expect(result).toMatchObject({
      status: "succeeded",
      productsSeen: categoryCount,
      offersSeen: categoryCount,
    });
    expect(provider.requestedCategories).toBe(categoryCount);
    expect(provider.maxActiveCategories).toBe(2);
    expect(store.largestProductBatch).toBeLessThanOrEqual(50);
    expect(store.largestOfferBatch).toBeLessThanOrEqual(50);
    expect(store.productBatches).toBe(categoryCount / 50);
    expect(store.offerBatches).toBe(categoryCount / 50);
    expect(store.finished).toHaveLength(1);
    expect(store.catalogMissProductIds[0]).toHaveLength(categoryCount);
  });

  it("does not record catalog misses for a partial category scan", async () => {
    const store = new FakeStore();
    const catalogProvider = new FakeCatalogProvider();
    await new RetailerIngestionPipeline(
      new CatalogIngestionStrategy(catalogProvider),
      store,
    ).ingest({ postalCode: "50009", categoryIds: ["dairy"] });

    expect(store.catalogMissRuns).toEqual([]);
  });

  it("persists successful leaf categories and marks a full scan as partial", async () => {
    const store = new FakeStore();
    const provider = new PartialCatalogProvider();

    const result = await new RetailerIngestionPipeline(
      new CatalogIngestionStrategy(provider),
      store,
      { retry: { maxAttempts: 1 } },
    ).ingest({ postalCode: "50009" });

    expect(result).toMatchObject({
      status: "partial",
      productsSeen: 1,
      offersSeen: 1,
    });
    expect(provider.requestedCategoryIds).toEqual(["dairy", "broken"]);
    expect(store.products.has("catalog-milk-1")).toBe(true);
    expect(store.catalogMissRuns).toEqual([]);
    expect(store.finished.at(-1)).toMatchObject({
      status: "partial",
      productsSeen: 1,
      offersSeen: 1,
      metadata: {
        attemptedOperations: 2,
        failedOperations: 1,
      },
    });
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
