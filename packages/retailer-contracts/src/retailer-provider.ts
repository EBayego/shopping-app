import type {
  Market,
  ProductOffer,
  ProviderHealth,
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
