import type { Market, ProductOffer } from "@shopping-app/domain";
import type {
  CatalogRetailerProvider,
  PriceRefreshRetailerProvider,
} from "@shopping-app/retailer-contracts";

import { PriceRefreshIngestionStrategy } from "./price-refresh-strategy.js";
import { CatalogIngestionStrategy } from "./strategies.js";
import type { ProviderOperationRunner } from "./types.js";

export class CatalogPriceRefreshIngestionStrategy extends PriceRefreshIngestionStrategy {
  private readonly catalog: CatalogIngestionStrategy;
  private readonly offers = new Map<string, ProductOffer>();

  constructor(
    provider: CatalogRetailerProvider & PriceRefreshRetailerProvider,
    private readonly catalogThreshold = 500,
  ) {
    super(provider);
    if (!Number.isInteger(catalogThreshold) || catalogThreshold < 1)
      throw new RangeError("catalogThreshold must be a positive integer");
    this.catalog = new CatalogIngestionStrategy(provider);
  }

  override async prepareRefresh(
    productIds: readonly string[],
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<void> {
    this.offers.clear();
    if (productIds.length < this.catalogThreshold) return;
    const selected = new Set(productIds);
    await this.catalog.collectIncrementally(
      { postalCode: market.postalCode },
      market,
      runner,
      (observations) => {
        for (const offer of observations.offers) {
          if (selected.has(offer.retailerProductId))
            this.offers.set(offer.retailerProductId, offer);
        }
        return Promise.resolve();
      },
    );
  }

  override refreshProduct(
    productId: string,
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<ProductOffer[]> {
    const offer = this.offers.get(productId);
    // A missing listing is not a confirmed deletion. Only the detail endpoint
    // can produce the typed 404 used by the pipeline to retire a product.
    return offer === undefined
      ? super.refreshProduct(productId, market, runner)
      : Promise.resolve([offer]);
  }
}
