import type { Market, ProductOffer } from "@shopping-app/domain";
import type { PriceRefreshRetailerProvider } from "@shopping-app/retailer-contracts";

import type { ProviderOperationRunner } from "./types.js";

export class PriceRefreshIngestionStrategy {
  readonly kind = "PRICE_REFRESH" as const;

  constructor(readonly provider: PriceRefreshRetailerProvider) {}

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
