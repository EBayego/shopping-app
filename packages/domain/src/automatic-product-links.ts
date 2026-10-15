import {
  compareBaskets,
  type BasketIntent,
  type BasketOfferCandidate,
} from "./basket-comparison.ts";

export interface AutomaticProductLinkChoice {
  intentId: string;
  updatedAt: string;
  productId: string;
  marketId: string;
  observedAt: string;
}
export interface AutomaticProductLinkPlan {
  choices: AutomaticProductLinkChoice[];
  unresolvedIds: string[];
  preservedManual: number;
}

/** Same quantity and membership arithmetic as basket comparison, with a distinct
 * cheapest-covering policy. Broad/ambiguous concepts never override the user's words. */
export function planAutomaticProductLinks(
  intents: readonly BasketIntent[],
  candidates: readonly BasketOfferCandidate[],
): AutomaticProductLinkPlan {
  const plan: AutomaticProductLinkPlan = {
    choices: [],
    unresolvedIds: [],
    preservedManual: 0,
  };
  const candidatesByIntent = new Map<string, BasketOfferCandidate[]>();
  for (const candidate of candidates) {
    const group = candidatesByIntent.get(candidate.intentId);
    if (group) group.push(candidate);
    else candidatesByIntent.set(candidate.intentId, [candidate]);
  }
  for (const intent of intents) {
    if (intent.linkSource === "manual") {
      plan.preservedManual++;
      continue;
    }
    const eligible = (candidatesByIntent.get(intent.id) ?? []).filter(
      (candidate) =>
        candidate.intentId === intent.id &&
        candidate.classificationAccepted &&
        candidate.classificationConfidence === "HIGH" &&
        candidate.freshness !== "VERY_STALE" &&
        !candidate.locationApproximate &&
        candidate.available &&
        candidate.offerId &&
        candidate.marketId &&
        candidate.observedAt &&
        (intent.variant !== undefined ||
          intent.brandPreference !== undefined ||
          candidate.standard) &&
        coversWords(
          intent.normalizedName ?? intent.name,
          candidate.productName,
          intent.conceptName,
        ),
    );
    // A generic mass/volume product needs a reference amount before comparing packs.
    const comparable = eligible
      .filter((candidate) => {
        if (intent.requestedUnit && intent.requestedUnit !== "unit")
          return true;
        if (intent.packageUnit && (intent.totalAmount || intent.packageSize))
          return true;
        if (intent.defaultAmount && intent.defaultUnit) return true;
        return (
          candidate.packageUnit === undefined ||
          candidate.packageUnit === "unit"
        );
      })
      .map((candidate) => {
        if (
          !candidate.promotionType ||
          ["fixed_price", "percentage"].includes(candidate.promotionType)
        )
          return candidate;
        // Conditional multibuy/coupon rules are not modeled by the catalog contract.
        const regularPrice = { ...candidate };
        delete regularPrice.promoPrice;
        delete regularPrice.pricePerUnit;
        return regularPrice;
      });
    const retailers = [
      ...new Set(comparable.map((candidate) => candidate.retailer)),
    ];
    const lines = compareBaskets(
      [{ ...intent, selectionPolicy: "CHEAPEST_COVERING" }],
      comparable,
      retailers,
    )
      .flatMap((basket) => basket.lines)
      .filter((line) => line.status === "MATCHED")
      .sort(
        (a, b) =>
          (a.estimatedLineTotal ?? Infinity) -
            (b.estimatedLineTotal ?? Infinity) ||
          (a.offerId ?? "").localeCompare(b.offerId ?? ""),
      );
    const best = lines[0];
    const candidate = comparable.find((item) => item.offerId === best?.offerId);
    if (
      !best ||
      !candidate?.marketId ||
      !candidate.observedAt ||
      !intent.updatedAt
    ) {
      plan.unresolvedIds.push(intent.id);
      continue;
    }
    plan.choices.push({
      intentId: intent.id,
      updatedAt: intent.updatedAt,
      productId: candidate.productId,
      marketId: candidate.marketId,
      observedAt: candidate.observedAt,
    });
  }
  return plan;
}

function coversWords(
  request: string,
  product: string,
  conceptName?: string,
): boolean {
  const words = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (word) =>
          word.length > 1 &&
          ![
            "de",
            "del",
            "la",
            "el",
            "los",
            "las",
            "para",
            "un",
            "una",
          ].includes(word),
      )
      .map((word) => (word.endsWith("s") ? word.slice(0, -1) : word))
      .map((word) => (word === "banana" ? "platano" : word));
  const requested = words(request);
  const supplied = new Set(words(product));
  if (
    conceptName === "carne" &&
    !requested.some((word) =>
      ["pollo", "pavo", "cerdo", "ternera", "vacuno"].includes(word),
    )
  )
    return false;
  // Accepted classifications identify generic pasta sold as "macarrones".
  // Specific user wording still has to occur in the candidate product name.
  if (
    conceptName &&
    conceptName !== "carne" &&
    requested.join(" ") === words(conceptName).join(" ")
  )
    return true;
  return requested.length > 0 && requested.every((word) => supplied.has(word));
}
