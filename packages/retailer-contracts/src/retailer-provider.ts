import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerCategory,
  RetailerProduct,
} from "@shopping-app/domain";

export interface RetailerObservationSet {
  products: RetailerProduct[];
  offers: ProductOffer[];
}

export type RetailerSearchResult = RetailerObservationSet;

export interface RetailerProvider {
  resolveMarket(postalCode: string): Promise<Market>;
  getProduct(externalId: string, market: Market): Promise<RetailerProduct>;
  healthCheck(): Promise<ProviderHealth>;
}

export interface SearchRetailerProvider extends RetailerProvider {
  searchProducts(query: string, market: Market): Promise<RetailerSearchResult>;
}

export interface PriceRefreshRetailerProvider extends RetailerProvider {
  refreshPrices(productIds: string[], market: Market): Promise<ProductOffer[]>;
}

export interface CatalogRetailerProvider extends RetailerProvider {
  getCategories(market: Market): Promise<RetailerCategory[]>;
  getProductsByCategory(
    categoryId: string,
    market: Market,
  ): Promise<RetailerSearchResult>;
}

export function supportsCatalog(
  provider: RetailerProvider,
): provider is CatalogRetailerProvider {
  const candidate = provider as Partial<CatalogRetailerProvider>;
  return (
    typeof candidate.getCategories === "function" &&
    typeof candidate.getProductsByCategory === "function"
  );
}

export function supportsSearch(
  provider: RetailerProvider,
): provider is SearchRetailerProvider {
  const candidate = provider as Partial<SearchRetailerProvider>;
  return typeof candidate.searchProducts === "function";
}

export function supportsPriceRefresh(
  provider: RetailerProvider,
): provider is PriceRefreshRetailerProvider {
  const candidate = provider as Partial<PriceRefreshRetailerProvider>;
  return typeof candidate.refreshPrices === "function";
}
