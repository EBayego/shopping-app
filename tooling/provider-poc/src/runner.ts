import type {
  Market,
  ProductOffer,
  RetailerCategory,
  RetailerProduct,
} from "@shopping-app/domain";
import {
  ProviderCapabilityUnavailableError,
  supportsCatalog,
  supportsPriceRefresh,
  supportsSearch,
  type RetailerProvider,
} from "@shopping-app/retailer-contracts";
import { DiaProvider } from "@shopping-app/provider-dia";
import { MercadonaProvider } from "@shopping-app/provider-mercadona";

import type { ProviderPocArguments } from "./arguments.js";
import { createMockProvider } from "./mock-provider.js";

function createProvider(
  provider: ProviderPocArguments["provider"],
): RetailerProvider {
  if (provider === "DIA") return new DiaProvider();
  if (provider === "MERCADONA") return new MercadonaProvider();
  return createMockProvider(provider);
}

export type ProviderPocResult =
  | {
      mode: "search";
      market: Market;
      products: RetailerProduct[];
      offers: ProductOffer[];
    }
  | {
      mode: "product";
      market: Market;
      product: RetailerProduct;
      offers: ProductOffer[];
    }
  | {
      mode: "categories";
      market: Market;
      categories: RetailerCategory[];
    }
  | {
      mode: "category";
      market: Market;
      products: RetailerProduct[];
      offers: ProductOffer[];
    };

export async function runProviderPoc(
  options: ProviderPocArguments,
  provider: RetailerProvider = createProvider(options.provider),
): Promise<ProviderPocResult> {
  const market = await provider.resolveMarket(options.postalCode);

  if (options.categories === true || options.category !== undefined) {
    if (!supportsCatalog(provider)) {
      throw new ProviderCapabilityUnavailableError(
        options.provider,
        options.categories === true ? "getCategories" : "getProductsByCategory",
      );
    }
    if (options.categories === true) {
      const categories = await provider.getCategories(market);
      return { mode: "categories", market, categories };
    }
    const { products, offers } = await provider.getProductsByCategory(
      options.category,
      market,
    );
    return { mode: "category", market, products, offers };
  }

  if (options.query !== undefined) {
    if (!supportsSearch(provider)) {
      throw new ProviderCapabilityUnavailableError(
        options.provider,
        "searchProducts",
      );
    }
    const { products, offers } = await provider.searchProducts(
      options.query,
      market,
    );
    return { mode: "search", market, products, offers };
  }

  const product = await provider.getProduct(options.product, market);
  if (!supportsPriceRefresh(provider)) {
    throw new ProviderCapabilityUnavailableError(
      options.provider,
      "refreshPrices",
    );
  }
  const offers = await provider.refreshPrices([options.product], market);
  return { mode: "product", market, product, offers };
}
