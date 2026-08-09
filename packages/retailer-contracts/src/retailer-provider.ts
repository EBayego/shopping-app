import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerCategory,
  RetailerProduct,
} from "@shopping-app/domain";

export interface RetailerSearchResult {
  products: RetailerProduct[];
  offers: ProductOffer[];
}

export interface RetailerProvider {
  resolveMarket(postalCode: string): Promise<Market>;
  searchProducts(query: string, market: Market): Promise<RetailerSearchResult>;
  getProduct(externalId: string, market: Market): Promise<RetailerProduct>;
  refreshPrices(productIds: string[], market: Market): Promise<ProductOffer[]>;
  healthCheck(): Promise<ProviderHealth>;
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
