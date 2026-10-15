import { describe, expect, it } from "vitest";
import { planAutomaticProductLinks } from "./automatic-product-links.ts";
import type {
  BasketIntent,
  BasketOfferCandidate,
} from "./basket-comparison.ts";

const intent: BasketIntent = {
  id: "milk",
  name: "leche",
  normalizedName: "leche",
  requestedQuantity: 2,
  requestedUnit: "l",
  updatedAt: "2026-10-15T10:00:00Z",
};
function offer(
  id: string,
  price: number,
  extra: Partial<BasketOfferCandidate> = {},
): BasketOfferCandidate {
  return {
    intentId: "milk",
    productId: id,
    productName: "Leche entera",
    retailer: "DIA",
    offerId: id,
    marketId: "market",
    observedAt: "2026-10-15T10:00:00Z",
    classificationAccepted: true,
    classificationConfidence: "HIGH",
    standard: true,
    packageSize: 1,
    packageUnit: "l",
    variableWeight: false,
    normalPrice: price,
    requiresMembership: false,
    available: true,
    freshness: "FRESH",
    ...extra,
  };
}
describe("automatic product links", () => {
  it("uses the accepted concept for generic pasta while preserving specific shape requests", () => {
    const pasta = {
      ...intent,
      name: "pasta",
      normalizedName: "pasta",
      conceptName: "pasta",
      requestedUnit: "kg" as const,
    };
    const macaroni = offer("macaroni", 1, {
      productName: "Macarrones",
      packageUnit: "kg",
    });
    expect(planAutomaticProductLinks([pasta], [macaroni]).choices).toHaveLength(
      1,
    );
    expect(
      planAutomaticProductLinks(
        [{ ...pasta, normalizedName: "espaguetis" }],
        [macaroni],
      ).choices,
    ).toHaveLength(0);
  });
  it("requires an animal type for the broad meat concept", () => {
    const meat = {
      ...intent,
      name: "carne",
      normalizedName: "carne",
      conceptName: "carne",
      requestedUnit: "kg" as const,
    };
    expect(
      planAutomaticProductLinks(
        [meat],
        [
          offer("pork", 1, {
            productName: "Carne de cerdo",
            packageUnit: "kg",
          }),
        ],
      ).choices,
    ).toHaveLength(0);
  });
  it("compares the cost covering the requested amount across stores and pack sizes", () => {
    const plan = planAutomaticProductLinks(
      [intent],
      [
        offer("single", 1),
        offer("pack", 5, { retailer: "MERCADONA", packageCount: 6 }),
        offer("two-litres", 1.8, { retailer: "ALCAMPO", packageSize: 2 }),
      ],
    );
    expect(plan.choices[0]?.productId).toBe("two-litres");
  });
  it("uses cheapest-covering even when the concept prefers the closest amount", () => {
    const plan = planAutomaticProductLinks(
      [{ ...intent, selectionPolicy: "CLOSEST_AMOUNT" }],
      [
        offer("exact", 2, { packageSize: 2 }),
        offer("larger", 1, { packageSize: 3 }),
      ],
    );
    expect(plan.choices[0]?.productId).toBe("larger");
  });
  it("does not apply a membership discount without a membership", () => {
    expect(
      planAutomaticProductLinks(
        [intent],
        [
          offer("club", 2, { promoPrice: 0.1, requiresMembership: true }),
          offer("public", 1),
        ],
      ).choices[0]?.productId,
    ).toBe("public");
  });
  it("does not assume a multibuy discount applies to each individual pack", () => {
    expect(
      planAutomaticProductLinks(
        [intent],
        [
          offer("multibuy", 2, { promoPrice: 0.1, promotionType: "multi_buy" }),
          offer("regular", 1),
        ],
      ).choices[0]?.productId,
    ).toBe("regular");
  });
  it.each([
    { available: false },
    { freshness: "VERY_STALE" as const },
    { classificationConfidence: "LOW" as const },
    { classificationAccepted: false },
    { locationApproximate: true },
    { standard: false },
    { productName: "Leche corporal", classificationConfidence: "LOW" as const },
  ])("leaves unreliable candidates unresolved: %j", (extra) => {
    const plan = planAutomaticProductLinks(
      [intent],
      [offer("bad", 0.01, extra)],
    );
    expect(plan.choices).toEqual([]);
    expect(plan.unresolvedIds).toEqual(["milk"]);
  });
  it("preserves manual choices", () => {
    expect(
      planAutomaticProductLinks(
        [{ ...intent, linkSource: "manual" }],
        [offer("cheap", 0.01)],
      ),
    ).toEqual({ choices: [], unresolvedIds: [], preservedManual: 1 });
  });
  it("does not replace chicken with another meat in a broad concept", () => {
    expect(
      planAutomaticProductLinks(
        [
          {
            ...intent,
            name: "pollo",
            normalizedName: "pollo",
            requestedUnit: "kg",
          },
        ],
        [
          offer("pork", 1, {
            productName: "Carne de cerdo",
            packageUnit: "kg",
          }),
        ],
      ).choices,
    ).toEqual([]);
  });
  it("requires a reference amount for generic volume products", () => {
    const generic = { ...intent, requestedUnit: "unit" as const };
    expect(
      planAutomaticProductLinks([generic], [offer("milk", 1)]).unresolvedIds,
    ).toEqual(["milk"]);
    expect(
      planAutomaticProductLinks(
        [{ ...generic, defaultAmount: 1, defaultUnit: "l" }],
        [offer("milk", 1)],
      ).choices,
    ).toHaveLength(1);
  });
  it("respects explicit variants and brands", () => {
    expect(
      planAutomaticProductLinks(
        [{ ...intent, brandPreference: "Pascual", variant: "semidesnatada" }],
        [
          offer("wrong", 0.5, { brand: "DIA" }),
          offer("right", 1.5, {
            brand: "Pascual",
            productName: "Leche semidesnatada Pascual",
          }),
        ],
      ).choices[0]?.productId,
    ).toBe("right");
  });
  it("accepts simple plural forms without substring matches", () => {
    const potatoes = {
      ...intent,
      name: "patata",
      normalizedName: "patata",
      requestedUnit: "kg" as const,
    };
    expect(
      planAutomaticProductLinks(
        [potatoes],
        [offer("potatoes", 1, { productName: "Patatas", packageUnit: "kg" })],
      ).choices,
    ).toHaveLength(1);
    expect(
      planAutomaticProductLinks(
        [intent],
        [offer("lettuce", 1, { productName: "Lechuga" })],
      ).choices,
    ).toHaveLength(0);
  });
  it("carries the exact offer market and observation into the guarded write", () => {
    expect(
      planAutomaticProductLinks(
        [intent],
        [offer("milk", 1, { marketId: "local-market" })],
      ).choices[0],
    ).toEqual({
      intentId: "milk",
      updatedAt: intent.updatedAt,
      productId: "milk",
      marketId: "local-market",
      observedAt: "2026-10-15T10:00:00Z",
    });
  });
});
