import type { Market } from "@shopping-app/domain";
import type {
  CatalogRetailerProvider,
  RetailerObservationSet,
  SearchRetailerProvider,
} from "@shopping-app/retailer-contracts";

import type {
  CatalogIngestionRequest,
  IngestionCollectionResult,
  IngestionStrategy,
  ProviderOperationRunner,
  SearchIngestionRequest,
} from "./types.js";
import { safeError } from "./resilience.js";

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
    const categoryIds = uniqueCategoryIds(
      request.categoryIds === undefined
        ? leafCategories(
            await runner.run("get_categories", () =>
              this.provider.getCategories(market),
            ),
          ).map((category) => category.externalId)
        : request.categoryIds,
    );
    const observations = await Promise.allSettled(
      categoryIds.map((categoryId) =>
        runner.run("get_products_by_category", () =>
          this.provider.getProductsByCategory(categoryId, market),
        ),
      ),
    );
    const failures: IngestionCollectionResult["failures"][number][] = [];
    const successes: RetailerObservationSet[] = [];
    const failureReasons: unknown[] = [];
    observations.forEach((result, index) => {
      if (result.status === "fulfilled") {
        successes.push(result.value);
        return;
      }
      failureReasons.push(result.reason);
      failures.push({
        subject: categoryIds[index] as string,
        error: safeError(result.reason),
      });
    });
    if (failures.length > 0 && successes.length === 0) {
      throw new AggregateError(
        failureReasons,
        `All ${failures.length} catalog categories failed`,
      );
    }
    return {
      products: successes.flatMap((result) => result.products),
      offers: successes.flatMap((result) => result.offers),
      status: failures.length === 0 ? "succeeded" : "partial",
      attemptedOperations: categoryIds.length,
      failures,
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
