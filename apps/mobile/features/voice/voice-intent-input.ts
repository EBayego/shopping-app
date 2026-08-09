import type {
  ShoppingIntentDraft,
  ShoppingIntentUnit,
} from "@shopping-app/voice-parser";

import type { AddShoppingIntentInput } from "../groups/types";
import { normalizeShoppingItemInput } from "../groups/validation";

export function voiceDraftToIntentInput(
  draft: ShoppingIntentDraft,
): AddShoppingIntentInput {
  if (!draft.product) throw new TypeError("Falta el nombre del producto.");
  const normalized = normalizeShoppingItemInput(draft.product);
  const requested = normalizeAmount(
    draft.requestedQuantity,
    draft.requestedUnit,
  );
  const packaging = normalizeAmount(draft.packageSize, draft.packageUnit);
  const totalUnit = draft.packageUnit ?? draft.requestedUnit;
  const total = normalizeAmount(draft.totalAmount, totalUnit);
  return {
    rawText: draft.rawText,
    normalizedName: normalized.normalizedName,
    ...(requested.amount === undefined
      ? {}
      : { requestedQuantity: requested.amount }),
    ...(requested.unit === undefined ? {} : { requestedUnit: requested.unit }),
    ...(draft.packageCount === undefined
      ? {}
      : { packageCount: draft.packageCount }),
    ...(packaging.amount === undefined
      ? {}
      : { packageSize: packaging.amount }),
    ...(packaging.unit === undefined ? {} : { packageUnit: packaging.unit }),
    ...(total.amount === undefined ? {} : { totalAmount: total.amount }),
    ...(draft.brandPreference === undefined
      ? {}
      : { brandPreference: draft.brandPreference }),
    ...(draft.variant === undefined ? {} : { variant: draft.variant }),
  };
}

function normalizeAmount(
  amount: number | undefined,
  unit: ShoppingIntentUnit | undefined,
): { amount?: number; unit?: "unit" | "g" | "kg" | "ml" | "l" } {
  if (amount === undefined) return {};
  if (unit === undefined) return { amount };
  if (unit === "cl") return { amount: amount * 10, unit: "ml" };
  if (unit === "bottle" || unit === "can" || unit === "pack") {
    return { amount, unit: "unit" };
  }
  return { amount, unit };
}
