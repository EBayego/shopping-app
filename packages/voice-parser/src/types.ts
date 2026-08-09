export type ShoppingIntentConfidence = "HIGH" | "MEDIUM" | "LOW";

export type ShoppingIntentUnit =
  "g" | "kg" | "ml" | "cl" | "l" | "unit" | "bottle" | "can" | "pack";

export interface ShoppingIntentDraft {
  rawText: string;
  product?: string;
  variant?: string;
  brandPreference?: string;
  requestedQuantity?: number;
  requestedUnit?: ShoppingIntentUnit;
  packageCount?: number;
  packageSize?: number;
  packageUnit?: ShoppingIntentUnit;
  totalAmount?: number;
  confidence: ShoppingIntentConfidence;
}
