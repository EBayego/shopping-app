import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerProduct,
} from "@shopping-app/domain";

export interface RetailerProvider {
  resolveMarket(postalCode: string): Promise<Market>;
  searchProducts(query: string, market: Market): Promise<RetailerProduct[]>;
  getProduct(externalId: string, market: Market): Promise<RetailerProduct>;
  refreshPrices(productIds: string[], market: Market): Promise<ProductOffer[]>;
  healthCheck(): Promise<ProviderHealth>;
}
