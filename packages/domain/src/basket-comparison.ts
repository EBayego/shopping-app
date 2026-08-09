import type { ProductMatchConfidence, ProductUnit } from "./models.js";
import type { Retailer } from "./retailer.js";

export type OfferFreshness = "FRESH" | "STALE" | "VERY_STALE";
export type BasketLineStatus =
  "MATCHED" | "NO_CONFIDENT_MATCH" | "UNAVAILABLE" | "INCOMPATIBLE_UNITS";

export interface BasketIntent {
  id: string;
  name: string;
  canonicalProductId?: string;
  requestedQuantity?: number;
  requestedUnit?: ProductUnit;
  packageCount?: number;
  packageSize?: number;
  packageUnit?: ProductUnit;
  totalAmount?: number;
}

export interface BasketOfferCandidate {
  intentId: string;
  retailer: Retailer;
  productId: string;
  productName: string;
  matchConfidence: ProductMatchConfidence;
  matchAccepted: boolean;
  packageCount?: number;
  packageSize?: number;
  packageUnit?: ProductUnit;
  totalAmount?: number;
  variableWeight: boolean;
  normalPrice: number;
  promoPrice?: number;
  requiresMembership: boolean;
  available: boolean;
  freshness: OfferFreshness;
  pricePerUnit?: number;
  referenceUnit?: ProductUnit;
  promotionText?: string;
}

export interface BasketUnavailableItem {
  intentId: string;
  name: string;
  reason: Exclude<BasketLineStatus, "MATCHED">;
}

export interface BasketComparisonLine {
  intentId: string;
  requestedName: string;
  status: BasketLineStatus;
  productId?: string;
  productName?: string;
  commercialUnits?: number;
  suppliedAmount?: number;
  suppliedUnit?: ProductUnit;
  normalPrice?: number;
  promoPrice?: number;
  effectiveUnitPrice?: number;
  estimatedLineTotal?: number;
  normalizedPrice?: number;
  normalizedUnit?: "kg" | "l" | "unit";
  freshness?: OfferFreshness;
  requiresMembership?: boolean;
  membershipPriceNotApplied?: boolean;
  promotionText?: string;
  approximate: boolean;
}

export interface BasketComparison {
  retailer: Retailer;
  estimatedTotal: number;
  estimatedTotalIsApproximate: boolean;
  matchedItems: number;
  totalItems: number;
  coveragePercentage: number;
  unavailableItems: readonly BasketUnavailableItem[];
  staleItems: number;
  promoItems: number;
  lines: readonly BasketComparisonLine[];
}

export interface BasketComparisonOptions {
  memberships?: readonly Retailer[];
}

interface Amount {
  amount: number;
  unit: ProductUnit;
}

interface EvaluatedCandidate {
  candidate: BasketOfferCandidate;
  line: BasketComparisonLine;
}

export function compareBaskets(
  intents: readonly BasketIntent[],
  candidates: readonly BasketOfferCandidate[],
  retailers: readonly Retailer[],
  options: BasketComparisonOptions = {},
): BasketComparison[] {
  const memberships = new Set(options.memberships ?? []);
  const uniqueRetailers = [...new Set(retailers)];
  const comparisons = uniqueRetailers.map((retailer) => {
    const retailerCandidates = candidates.filter(
      (candidate) => candidate.retailer === retailer,
    );
    const lines = intents.map((intent) =>
      buildLine(
        intent,
        retailerCandidates.filter(
          (candidate) => candidate.intentId === intent.id,
        ),
        memberships.has(retailer),
      ),
    );
    const matchedLines = lines.filter((line) => line.status === "MATCHED");
    const unavailableItems = lines.flatMap((line): BasketUnavailableItem[] =>
      line.status === "MATCHED"
        ? []
        : [
            {
              intentId: line.intentId,
              name: line.requestedName,
              reason: line.status,
            },
          ],
    );
    const estimatedTotal = roundMoney(
      matchedLines.reduce(
        (sum, line) => sum + (line.estimatedLineTotal ?? 0),
        0,
      ),
    );
    return {
      retailer,
      estimatedTotal,
      estimatedTotalIsApproximate: matchedLines.some(
        (line) => line.approximate,
      ),
      matchedItems: matchedLines.length,
      totalItems: intents.length,
      coveragePercentage:
        intents.length === 0
          ? 100
          : Math.round((matchedLines.length / intents.length) * 100),
      unavailableItems,
      staleItems: matchedLines.filter(
        (line) => line.freshness !== undefined && line.freshness !== "FRESH",
      ).length,
      promoItems: matchedLines.filter((line) => line.promoPrice !== undefined)
        .length,
      lines,
    } satisfies BasketComparison;
  });
  return comparisons.sort(compareBasketRanking);
}

/** Coverage dominates ranking; freshness is compared before price. */
export function compareBasketRanking(
  left: BasketComparison,
  right: BasketComparison,
): number {
  if (left.coveragePercentage !== right.coveragePercentage) {
    return right.coveragePercentage - left.coveragePercentage;
  }
  const leftVeryStale = countVeryStale(left);
  const rightVeryStale = countVeryStale(right);
  if (leftVeryStale !== rightVeryStale) return leftVeryStale - rightVeryStale;
  if (left.staleItems !== right.staleItems) {
    return left.staleItems - right.staleItems;
  }
  if (left.estimatedTotal !== right.estimatedTotal) {
    return left.estimatedTotal - right.estimatedTotal;
  }
  return left.retailer.localeCompare(right.retailer);
}

function buildLine(
  intent: BasketIntent,
  candidates: readonly BasketOfferCandidate[],
  hasMembership: boolean,
): BasketComparisonLine {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.matchAccepted && candidate.matchConfidence !== "LOW",
  );
  if (eligible.length === 0) return unmatchedLine(intent, "NO_CONFIDENT_MATCH");

  const available = eligible.filter((candidate) => candidate.available);
  if (available.length === 0) return unmatchedLine(intent, "UNAVAILABLE");

  const evaluated = available.flatMap((candidate) => {
    const line = evaluateCandidate(intent, candidate, hasMembership);
    return line === undefined ? [] : [{ candidate, line }];
  });
  if (evaluated.length === 0) {
    return unmatchedLine(intent, "INCOMPATIBLE_UNITS");
  }
  evaluated.sort(compareCandidates);
  return evaluated[0]?.line ?? unmatchedLine(intent, "INCOMPATIBLE_UNITS");
}

function evaluateCandidate(
  intent: BasketIntent,
  candidate: BasketOfferCandidate,
  hasMembership: boolean,
): BasketComparisonLine | undefined {
  const demand = requestedAmount(intent);
  const supply = packageAmount(candidate);
  if (!compatible(demand.unit, supply.unit)) return undefined;

  const demandBase = toBase(demand);
  const supplyBase = toBase(supply);
  const commercialUnits = Math.max(
    1,
    Math.ceil(demandBase.amount / supplyBase.amount),
  );
  const membershipPriceNotApplied =
    candidate.promoPrice !== undefined &&
    candidate.requiresMembership &&
    !hasMembership;
  const effectiveUnitPrice =
    candidate.promoPrice !== undefined && !membershipPriceNotApplied
      ? candidate.promoPrice
      : candidate.normalPrice;
  const catchweightUnitPrice = normalizedPrice(candidate, effectiveUnitPrice);
  const estimatedLineTotal = candidate.variableWeight
    ? catchweightUnitPrice === undefined
      ? effectiveUnitPrice * commercialUnits
      : catchweightUnitPrice.price *
        normalizeAmount(
          supplyBase.amount * commercialUnits,
          catchweightUnitPrice.unit,
        )
    : effectiveUnitPrice * commercialUnits;
  const normalized = normalizedPrice(candidate, effectiveUnitPrice);
  return {
    intentId: intent.id,
    requestedName: intent.name,
    status: "MATCHED",
    productId: candidate.productId,
    productName: candidate.productName,
    commercialUnits,
    suppliedAmount: roundQuantity(supply.amount * commercialUnits),
    suppliedUnit: supply.unit,
    normalPrice: candidate.normalPrice,
    ...(candidate.promoPrice === undefined
      ? {}
      : { promoPrice: candidate.promoPrice }),
    effectiveUnitPrice,
    estimatedLineTotal: roundMoney(estimatedLineTotal),
    ...(normalized === undefined
      ? {}
      : { normalizedPrice: normalized.price, normalizedUnit: normalized.unit }),
    freshness: candidate.freshness,
    requiresMembership: candidate.requiresMembership,
    membershipPriceNotApplied,
    ...(candidate.promotionText === undefined
      ? {}
      : { promotionText: candidate.promotionText }),
    approximate: candidate.variableWeight,
  };
}

function requestedAmount(intent: BasketIntent): Amount {
  if (intent.totalAmount !== undefined && intent.packageUnit !== undefined) {
    return { amount: intent.totalAmount, unit: intent.packageUnit };
  }
  if (
    intent.packageCount !== undefined &&
    intent.packageSize !== undefined &&
    intent.packageUnit !== undefined
  ) {
    return {
      amount: intent.packageCount * intent.packageSize,
      unit: intent.packageUnit,
    };
  }
  return {
    amount: intent.requestedQuantity ?? 1,
    unit: intent.requestedUnit ?? "unit",
  };
}

function packageAmount(candidate: BasketOfferCandidate): Amount {
  if (
    candidate.totalAmount !== undefined &&
    candidate.packageUnit !== undefined
  ) {
    return { amount: candidate.totalAmount, unit: candidate.packageUnit };
  }
  if (
    candidate.packageSize !== undefined &&
    candidate.packageUnit !== undefined
  ) {
    return {
      amount: candidate.packageSize * (candidate.packageCount ?? 1),
      unit: candidate.packageUnit,
    };
  }
  if (candidate.packageCount !== undefined) {
    return { amount: candidate.packageCount, unit: "unit" };
  }
  return { amount: 1, unit: "unit" };
}

function normalizedPrice(
  candidate: BasketOfferCandidate,
  effectiveUnitPrice: number,
): { price: number; unit: "kg" | "l" | "unit" } | undefined {
  if (
    candidate.pricePerUnit !== undefined &&
    candidate.referenceUnit !== undefined
  ) {
    const unit = displayUnit(candidate.referenceUnit);
    const factor =
      candidate.referenceUnit === "g" || candidate.referenceUnit === "ml"
        ? 1000
        : 1;
    return { price: roundMoney(candidate.pricePerUnit * factor), unit };
  }
  const supply = toBase(packageAmount(candidate));
  const unit = displayUnit(supply.unit);
  return {
    price: roundMoney(
      effectiveUnitPrice / normalizeAmount(supply.amount, unit),
    ),
    unit,
  };
}

function compareCandidates(
  left: EvaluatedCandidate,
  right: EvaluatedCandidate,
): number {
  const price =
    (left.line.estimatedLineTotal ?? Number.POSITIVE_INFINITY) -
    (right.line.estimatedLineTotal ?? Number.POSITIVE_INFINITY);
  if (price !== 0) return price;
  const freshness =
    freshnessRank(left.candidate.freshness) -
    freshnessRank(right.candidate.freshness);
  if (freshness !== 0) return freshness;
  return (
    confidenceRank(right.candidate.matchConfidence) -
    confidenceRank(left.candidate.matchConfidence)
  );
}

function unmatchedLine(
  intent: BasketIntent,
  status: Exclude<BasketLineStatus, "MATCHED">,
): BasketComparisonLine {
  return {
    intentId: intent.id,
    requestedName: intent.name,
    status,
    approximate: false,
  };
}

function compatible(left: ProductUnit, right: ProductUnit): boolean {
  return unitFamily(left) === unitFamily(right);
}

function unitFamily(unit: ProductUnit): "mass" | "volume" | "unit" {
  if (unit === "g" || unit === "kg") return "mass";
  if (unit === "ml" || unit === "l") return "volume";
  return "unit";
}

function toBase(value: Amount): Amount {
  if (value.unit === "kg") return { amount: value.amount * 1000, unit: "g" };
  if (value.unit === "l") return { amount: value.amount * 1000, unit: "ml" };
  return value;
}

function displayUnit(unit: ProductUnit): "kg" | "l" | "unit" {
  if (unit === "g" || unit === "kg") return "kg";
  if (unit === "ml" || unit === "l") return "l";
  return "unit";
}

function normalizeAmount(
  amountInBaseUnit: number,
  unit: "kg" | "l" | "unit",
): number {
  return unit === "unit" ? amountInBaseUnit : amountInBaseUnit / 1000;
}

function countVeryStale(comparison: BasketComparison): number {
  return comparison.lines.filter((line) => line.freshness === "VERY_STALE")
    .length;
}

function freshnessRank(value: OfferFreshness): number {
  return value === "FRESH" ? 0 : value === "STALE" ? 1 : 2;
}

function confidenceRank(value: ProductMatchConfidence): number {
  return value === "HIGH" ? 2 : value === "MEDIUM" ? 1 : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
