import type { Market } from "@shopping-app/domain";
import type {
  CatalogRetailerProvider,
  RetailerObservationSet,
  SearchRetailerProvider,
} from "@shopping-app/retailer-contracts";

import type {
  CatalogIngestionRequest,
  IngestionStrategy,
  ProviderOperationRunner,
  SearchIngestionRequest,
} from "./types.js";

export class SearchIngestionStrategy implements IngestionStrategy<SearchIngestionRequest> {
  readonly kind = "SEARCH_INGESTION" as const;

  constructor(readonly provider: SearchRetailerProvider) {}

  collect(
    request: SearchIngestionRequest,
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<RetailerObservationSet> {
    return runner.run("search_products", () =>
      this.provider.searchProducts(request.query, market),
    );
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
  ): Promise<RetailerObservationSet> {
    const categoryIds =
      request.categoryIds === undefined
        ? (
            await runner.run("get_categories", () =>
              this.provider.getCategories(market),
            )
          ).map((category) => category.externalId)
        : [...request.categoryIds];
    const observations = await Promise.all(
      categoryIds.map((categoryId) =>
        runner.run("get_products_by_category", () =>
          this.provider.getProductsByCategory(categoryId, market),
        ),
      ),
    );
    return {
      products: observations.flatMap((result) => result.products),
      offers: observations.flatMap((result) => result.offers),
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
