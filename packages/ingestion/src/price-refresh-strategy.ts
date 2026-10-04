import type { Market, ProductOffer } from "@shopping-app/domain";
import type { PriceRefreshRetailerProvider } from "@shopping-app/retailer-contracts";

import type { ProviderOperationRunner } from "./types.js";

export class PriceRefreshIngestionStrategy {
  readonly kind = "PRICE_REFRESH" as const;

  constructor(readonly provider: PriceRefreshRetailerProvider) {}

  prepareRefresh(
    productIds: readonly string[],
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<void> {
    void productIds;
    void market;
    void runner;
    return Promise.resolve();
  }

  refreshProduct(
    retailerProductExternalId: string,
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<ProductOffer[]> {
    return runner.run("refresh_price", () =>
      this.provider.refreshPrices([retailerProductExternalId], market),
    );
  }
}
