import type { Market } from "@shopping-app/domain";
import type {
  CatalogRetailerProvider,
  RetailerObservationSet,
  SearchRetailerProvider,
} from "@shopping-app/retailer-contracts";

import type {
  CatalogIngestionRequest,
  IncrementalIngestionCollectionResult,
  IngestionCollectionResult,
  IngestionObservationConsumer,
  IngestionStrategy,
  ProviderOperationRunner,
  SearchIngestionRequest,
} from "./types.js";
import { safeError } from "./resilience.js";

const CATALOG_CATEGORY_CONCURRENCY = 2;

export class SearchIngestionStrategy implements IngestionStrategy<SearchIngestionRequest> {
  readonly kind = "SEARCH_INGESTION" as const;

  constructor(readonly provider: SearchRetailerProvider) {}

  async collect(
    request: SearchIngestionRequest,
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<IngestionCollectionResult> {
    const observations = await runner.run("search_products", () =>
      this.provider.searchProducts(request.query, market),
    );
    return {
      ...observations,
      status: "succeeded",
      attemptedOperations: 1,
      failures: [],
    };
  }

  metadata(request: SearchIngestionRequest): Readonly<Record<string, unknown>> {
    return { query: request.query, postalCode: request.postalCode };
  }
}

export class CatalogIngestionStrategy implements IngestionStrategy<CatalogIngestionRequest> {
  readonly kind = "CATALOG_SYNC" as const;

  constructor(readonly provider: CatalogRetailerProvider) {}

  async collect(
    request: CatalogIngestionRequest,
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<IngestionCollectionResult> {
    const products = new Map<
      string,
      RetailerObservationSet["products"][number]
    >();
    const offers = new Map<string, RetailerObservationSet["offers"][number]>();
    const collection = await this.collectIncrementally(
      request,
      market,
      runner,
      (observations) => {
        for (const product of observations.products)
          products.set(product.externalId, product);
        for (const offer of observations.offers) {
          offers.set(
            `${offer.retailerProductId}\u0000${offer.marketId}`,
            offer,
          );
        }
        return Promise.resolve();
      },
    );
    return {
      products: [...products.values()],
      offers: [...offers.values()],
      ...collection,
    };
  }

  async collectIncrementally(
    request: CatalogIngestionRequest,
    market: Market,
    runner: ProviderOperationRunner,
    consume: IngestionObservationConsumer,
  ): Promise<IncrementalIngestionCollectionResult> {
    const categoryIds = uniqueCategoryIds(
      request.categoryIds === undefined
        ? leafCategories(
            await runner.run("get_categories", () =>
              this.provider.getCategories(market),
            ),
          ).map((category) => category.externalId)
        : request.categoryIds,
    );
    const failures: Array<
      IncrementalIngestionCollectionResult["failures"][number] | undefined
    > = Array.from({ length: categoryIds.length }, () => undefined);
    let nextCategory = 0;
    let succeeded = 0;
    let firstFailure: unknown;
    let consumerFailure: unknown;
    let stopped = false;
    const workers = Array.from(
      {
        length: Math.min(CATALOG_CATEGORY_CONCURRENCY, categoryIds.length),
      },
      async () => {
        while (!stopped && nextCategory < categoryIds.length) {
          const index = nextCategory;
          nextCategory += 1;
          const categoryId = categoryIds[index] as string;
          let observations: RetailerObservationSet;
          try {
            observations = await runner.run("get_products_by_category", () =>
              this.provider.getProductsByCategory(categoryId, market),
            );
          } catch (error) {
            firstFailure ??= error;
            failures[index] = {
              subject: categoryId,
              error: safeError(error),
            };
            continue;
          }
          if (stopped) return;
          try {
            await consume(observations);
            succeeded += 1;
          } catch (error) {
            consumerFailure = error;
            stopped = true;
          }
        }
      },
    );
    await Promise.all(workers);
    if (stopped) throw consumerFailure;
    const reportedFailures = failures.flatMap((failure) =>
      failure === undefined ? [] : [failure],
    );
    if (reportedFailures.length > 0 && succeeded === 0) {
      throw new AggregateError(
        firstFailure === undefined ? [] : [firstFailure],
        `All ${reportedFailures.length} catalog categories failed`,
      );
    }
    return {
      status: reportedFailures.length === 0 ? "succeeded" : "partial",
      attemptedOperations: categoryIds.length,
      failures: reportedFailures,
    };
  }

  metadata(
    request: CatalogIngestionRequest,
  ): Readonly<Record<string, unknown>> {
    return {
      postalCode: request.postalCode,
      ...(request.categoryIds === undefined
        ? { scope: "all_categories" }
        : { categoryIds: [...request.categoryIds] }),
    };
  }
}

function leafCategories<
  T extends { externalId: string; parentExternalId?: string },
>(categories: readonly T[]): T[] {
  const parentIds = new Set(
    categories.flatMap((category) =>
      category.parentExternalId === undefined
        ? []
        : [category.parentExternalId],
    ),
  );
  return categories.filter((category) => !parentIds.has(category.externalId));
}

function uniqueCategoryIds(categoryIds: readonly string[]): string[] {
  return [
    ...new Set(
      categoryIds.map((categoryId) => categoryId.trim()).filter(Boolean),
    ),
  ];
}
