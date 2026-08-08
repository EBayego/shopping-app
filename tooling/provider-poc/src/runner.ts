import type {
  Market,
  ProductOffer,
  RetailerProduct,
} from "@shopping-app/domain";
import type { RetailerProvider } from "@shopping-app/retailer-contracts";

import type { ProviderPocArguments } from "./arguments.js";
import { createMockProvider } from "./mock-provider.js";

export type ProviderPocResult =
  | {
      mode: "search";
      market: Market;
      products: RetailerProduct[];
    }
  | {
      mode: "product";
      market: Market;
      product: RetailerProduct;
      offers: ProductOffer[];
    };

export async function runProviderPoc(
  options: ProviderPocArguments,
  provider: RetailerProvider = createMockProvider(options.provider),
): Promise<ProviderPocResult> {
  const market = await provider.resolveMarket(options.postalCode);

  if (options.query !== undefined) {
    const products = await provider.searchProducts(options.query, market);
    return { mode: "search", market, products };
  }

  const product = await provider.getProduct(options.product, market);
  const offers = await provider.refreshPrices([options.product], market);
  return { mode: "product", market, product, offers };
}
