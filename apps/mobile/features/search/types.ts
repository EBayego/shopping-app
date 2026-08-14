export type OfferFreshness = "FRESH" | "STALE" | "VERY_STALE";
export interface ProductSearchConcept {
  id: string;
  name: string;
  normalizedName: string;
  category: string | null;
  defaultAmount: number | null;
  defaultUnit: string | null;
  selectionPolicy: "CHEAPEST_COVERING" | "CLOSEST_AMOUNT";
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
  classificationConfidence: "HIGH" | "MEDIUM" | null;
  standard: boolean;
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
  concept: ProductSearchConcept | null;
  retailerProducts: readonly ProductSearchRetailerProduct[];
  offers: readonly ProductSearchOffer[];
}
