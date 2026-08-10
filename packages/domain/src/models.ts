import type { Retailer } from "./retailer.ts";

export type ProductUnit = "unit" | "g" | "kg" | "ml" | "l";

export type PromotionType =
  "percentage" | "fixed-price" | "multi-buy" | "membership" | "other";

export interface Market {
  retailer: Retailer;
  externalId: string;
  postalCode: string;
  name?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface RetailerProduct {
  retailer: Retailer;
  externalId: string;
  name: string;
  brand?: string;
  gtin?: string;
  ean?: string;
  packageSize?: number;
  packageUnit?: ProductUnit;
  packageCount?: number;
  totalAmount?: number;
  variableWeight: boolean;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
  productUrl?: string;
  marketId: string;
  observedAt: Date;
  rawData?: unknown;
}

export type ProductMatchType = "EXACT_MATCH" | "SUBSTITUTE";
export type ProductMatchConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ProductMatchStatus = "PROPOSED" | "ACCEPTED" | "REJECTED";

export interface CanonicalProduct {
  id: string;
  name: string;
  normalizedName: string;
  baseName: string;
  category?: string;
  normalizedCategory?: string;
  brand?: string;
  normalizedBrand?: string;
  variant?: string;
  gtin?: string;
  packageSize?: number;
  packageUnit?: ProductUnit;
  packageCount?: number;
  totalAmount?: number;
}

export interface ProductMatchReason {
  feature: string;
  matched: boolean;
  weight: number;
  detail: string;
}

export interface ProductMatchCandidate {
  canonicalProductId: string;
  retailerProductId: string;
  matchType: ProductMatchType;
  method: string;
  score: number;
  confidence: ProductMatchConfidence;
  reasons: readonly ProductMatchReason[];
  autoAccept: boolean;
}

export interface RetailerCategory {
  externalId: string;
  name: string;
  parentExternalId?: string;
  level?: number;
  order?: number;
}

export interface ProductOffer {
  retailerProductId: string;
  marketId: string;
  normalPrice: number;
  promoPrice?: number;
  pricePerUnit?: number;
  referenceUnit?: ProductUnit;
  promotionType?: PromotionType;
  promotionText?: string;
  requiresMembership: boolean;
  available: boolean;
  observedAt: Date;
}

export type ProviderHealthStatus = "healthy" | "degraded" | "unavailable";

export interface ProviderHealth {
  retailer: Retailer;
  status: ProviderHealthStatus;
  checkedAt: Date;
  latencyMs?: number;
  message?: string;
}
