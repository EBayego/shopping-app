import type {
  CanonicalProduct,
  ProductMatchCandidate,
  ProductMatchConfidence,
  ProductMatchStatus,
  ProductMatchType,
  ProductUnit,
  RetailerProduct,
} from "@shopping-app/domain";

export type QuantityDimension = "MASS" | "VOLUME" | "COUNT";

export interface NormalizedQuantity {
  amount: number;
  unit: ProductUnit;
  baseAmount: number;
  baseUnit: "g" | "ml" | "unit";
  dimension: QuantityDimension;
}

export interface NormalizedPackaging {
  packageCount?: number;
  packageSize?: NormalizedQuantity;
  totalAmount?: NormalizedQuantity;
  source: "STRUCTURED" | "NAME" | "UNKNOWN";
}

export interface NormalizedProduct {
  originalName: string;
  normalizedName: string;
  baseName: string;
  normalizedBrand?: string;
  variant?: string;
  normalizedCategory?: string;
  gtin?: string;
  packaging: NormalizedPackaging;
}

export interface MatchThresholds {
  high: number;
  medium: number;
  minimumCandidate: number;
  automaticAcceptance: number;
  textSimilarityFloor: number;
  formatRelativeTolerance: number;
}

export interface CanonicalProductInput {
  name: string;
  category?: string;
  brand?: string;
  variant?: string;
  gtin?: string;
  packageSize?: number;
  packageUnit?: ProductUnit;
  packageCount?: number;
  totalAmount?: number;
}

export interface StoredProductMatch {
  id: string;
  canonicalProductId: string;
  retailerProductId: string;
  matchType: ProductMatchType;
  method: string;
  score: number;
  confidence: ProductMatchConfidence;
  reasons: readonly unknown[];
  status: ProductMatchStatus;
  reviewed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MatchDecisionInput {
  canonicalProductId: string;
  retailerProductId: string;
  matchType: ProductMatchType;
  method: string;
  score: number;
  confidence: ProductMatchConfidence;
  reasons: readonly unknown[];
}

export interface ProductMatchingRepository {
  findCanonicalCandidates(
    product: NormalizedProduct,
  ): Promise<readonly CanonicalProduct[]>;
  createCanonicalProduct(
    input: CanonicalProductInput,
  ): Promise<CanonicalProduct>;
  saveProposal(candidate: ProductMatchCandidate): Promise<StoredProductMatch>;
  acceptMatch(matchId: string): Promise<StoredProductMatch>;
  rejectMatch(matchId: string): Promise<StoredProductMatch>;
  changeMatch(input: MatchDecisionInput): Promise<StoredProductMatch>;
  findEquivalentProducts(
    canonicalProductId: string,
  ): Promise<readonly RetailerProduct[]>;
}
