import type { ProductUnit } from "@shopping-app/domain";

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
