export type ShoppingIntentConfidence = "HIGH" | "MEDIUM" | "LOW";

export type ShoppingIntentUnit =
  "g" | "kg" | "ml" | "cl" | "l" | "unit" | "bottle" | "can" | "pack";

export const PACKAGE_TYPES = [
  "bottle",
  "can",
  "carton",
  "bag",
  "tray",
  "jar",
  "box",
  "pack",
  "tub",
  "tube",
  "jug",
] as const;
export type ShoppingPackageType = (typeof PACKAGE_TYPES)[number];

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
  packageType?: ShoppingPackageType;
  totalAmount?: number;
  confidence: ShoppingIntentConfidence;
  source?: "AI";
  needsReview?: boolean;
  reviewReason?: string;
}
