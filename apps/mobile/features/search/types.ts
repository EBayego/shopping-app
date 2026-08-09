export type OfferFreshness = "FRESH" | "STALE" | "VERY_STALE";
export type SearchMatchType = "EXACT" | "SUBSTITUTE";

export interface ProductSearchCanonicalProduct {
  id: string;
  name: string;
  normalizedName: string;
  brand: string | null;
  category: string | null;
  variant: string | null;
  gtin: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  packageCount: number | null;
}

export interface ProductSearchRetailerProduct {
  id: string;
  retailerId: string;
  externalId: string;
  name: string;
  brand: string | null;
  gtin: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  packageCount: number | null;
  imageUrl: string | null;
  productUrl: string | null;
  matchType: SearchMatchType | null;
  matchConfidence: "HIGH" | "MEDIUM" | null;
}

export interface ProductSearchOffer {
  retailer: { id: string; code: string; name: string };
  retailerProduct: {
    id: string;
    externalId: string;
    name: string;
    brand: string | null;
    imageUrl: string | null;
    productUrl: string | null;
  };
  price: number;
  normalPrice: number;
  promoPrice: number | null;
  pricePerUnit: number | null;
  referenceUnit: string | null;
  promotion: { type: string | null; text: string | null } | null;
  requiresMembership: boolean;
  availability: boolean;
  observedAt: string;
  freshness: OfferFreshness;
  market: { id: string; externalId: string; name: string | null };
}

export interface ProductSearchResult {
  canonicalProduct: ProductSearchCanonicalProduct | null;
  retailerProducts: readonly ProductSearchRetailerProduct[];
  offers: readonly ProductSearchOffer[];
}
