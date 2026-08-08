import type { Retailer } from "./retailer.js";

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
