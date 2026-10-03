import type { ShoppingIntentDraft, ShoppingIntentUnit } from "./types.ts";

const MEASUREMENTS: Partial<
  Record<ShoppingIntentUnit, readonly [string, number]>
> = {
  g: ["mass", 1],
  kg: ["mass", 1000],
  ml: ["volume", 1],
  cl: ["volume", 10],
  l: ["volume", 1000],
};

export function calculateIntentTotal(
  draft: Pick<
    ShoppingIntentDraft,
    | "packageCount"
    | "packageSize"
    | "packageUnit"
    | "requestedQuantity"
    | "requestedUnit"
  >,
): number | undefined {
  if (draft.packageSize !== undefined) {
    if (draft.packageCount !== undefined)
      return round(draft.packageCount * draft.packageSize);
    const requested =
      draft.requestedUnit === undefined
        ? undefined
        : MEASUREMENTS[draft.requestedUnit];
    const packaging =
      draft.packageUnit === undefined
        ? undefined
        : MEASUREMENTS[draft.packageUnit];
    if (
      requested &&
      packaging &&
      requested[0] === packaging[0] &&
      draft.requestedQuantity !== undefined
    ) {
      return round((draft.requestedQuantity * requested[1]) / packaging[1]);
    }
    return round((draft.requestedQuantity ?? 1) * draft.packageSize);
  }
  return draft.requestedQuantity;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
