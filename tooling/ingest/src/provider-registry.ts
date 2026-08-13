import type { Retailer } from "@shopping-app/domain";
import {
  CatalogIngestionStrategy,
  PriceRefreshIngestionStrategy,
  SearchIngestionStrategy,
  type CatalogIngestionRequest,
  type IngestionStrategy,
  type SearchIngestionRequest,
} from "@shopping-app/ingestion";
import { AlcampoProvider } from "@shopping-app/provider-alcampo";
import { DiaProvider } from "@shopping-app/provider-dia";
import { EroskiProvider } from "@shopping-app/provider-eroski";
import { MercadonaProvider } from "@shopping-app/provider-mercadona";

export type RegisteredIngestionCapability =
  "SEARCH" | "CATALOG" | "PRICE_REFRESH";

interface ProviderRegistration {
  capabilities: readonly RegisteredIngestionCapability[];
  createSearch?: () => IngestionStrategy<SearchIngestionRequest>;
  createCatalog?: () => IngestionStrategy<CatalogIngestionRequest>;
  createPriceRefresh?: () => PriceRefreshIngestionStrategy;
}

export function supportsIngestionCapability(
  retailer: Retailer,
  capability: RegisteredIngestionCapability,
): boolean {
  return getIngestionCapabilities(retailer).includes(capability);
}

const REGISTRY: Partial<Record<Retailer, ProviderRegistration>> = {
  DIA: {
    capabilities: ["SEARCH", "CATALOG", "PRICE_REFRESH"],
    createSearch: () => new SearchIngestionStrategy(new DiaProvider()),
    createCatalog: () => new CatalogIngestionStrategy(new DiaProvider()),
    createPriceRefresh: () =>
      new PriceRefreshIngestionStrategy(new DiaProvider()),
  },
  MERCADONA: {
    capabilities: ["CATALOG", "PRICE_REFRESH"],
    createCatalog: () => new CatalogIngestionStrategy(new MercadonaProvider()),
    createPriceRefresh: () =>
      new PriceRefreshIngestionStrategy(new MercadonaProvider()),
  },
  ALCAMPO: {
    capabilities: ["CATALOG", "PRICE_REFRESH"],
    createCatalog: () => new CatalogIngestionStrategy(new AlcampoProvider()),
    createPriceRefresh: () =>
      new PriceRefreshIngestionStrategy(new AlcampoProvider()),
  },
  EROSKI: {
    capabilities: ["PRICE_REFRESH"],
    createPriceRefresh: () =>
      new PriceRefreshIngestionStrategy(new EroskiProvider()),
  },
};

export function getIngestionCapabilities(
  retailer: Retailer,
): readonly RegisteredIngestionCapability[] {
  return REGISTRY[retailer]?.capabilities ?? [];
}

export function createSearchStrategy(
  retailer: Retailer,
): IngestionStrategy<SearchIngestionRequest> {
  const factory = REGISTRY[retailer]?.createSearch;
  if (factory === undefined) {
    const capabilities = getIngestionCapabilities(retailer);
    throw new Error(
      `${retailer} does not support --query ingestion` +
        (capabilities.length === 0
          ? ""
          : `; registered strategies: ${capabilities.join(", ")}`),
    );
  }
  return factory();
}

export function createCatalogStrategy(
  retailer: Retailer,
): IngestionStrategy<CatalogIngestionRequest> {
  const factory = REGISTRY[retailer]?.createCatalog;
  if (factory === undefined) {
    throw new Error(`${retailer} does not have a registered CATALOG strategy`);
  }
  return factory();
}

export function createPriceRefreshStrategy(
  retailer: Retailer,
): PriceRefreshIngestionStrategy {
  const factory = REGISTRY[retailer]?.createPriceRefresh;
  if (factory === undefined) {
    throw new Error(`${retailer} does not support PRICE_REFRESH`);
  }
  return factory();
}
