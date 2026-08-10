import { describe, expect, it } from "vitest";

import type {
  BasketIntent,
  BasketOfferCandidate,
} from "./basket-comparison.ts";
import { compareBaskets } from "./basket-comparison.ts";

const freshOffer = (
  intentId: string,
  overrides: Partial<BasketOfferCandidate> = {},
): BasketOfferCandidate => ({
  intentId,
  retailer: "DIA",
  productId: `${intentId}-dia`,
  productName: `Producto ${intentId}`,
  matchConfidence: "HIGH",
  matchAccepted: true,
  packageSize: 1,
  packageUnit: "unit",
  variableWeight: false,
  normalPrice: 2,
  requiresMembership: false,
  available: true,
  freshness: "FRESH",
  ...overrides,
});

const intent = (
  id: string,
  overrides: Partial<BasketIntent> = {},
): BasketIntent => ({
  id,
  name: `Pedido ${id}`,
  requestedQuantity: 1,
  requestedUnit: "unit",
  ...overrides,
});

describe("compareBaskets", () => {
  it("calcula una cesta con cobertura completa", () => {
    const result = compareBaskets(
      [intent("leche"), intent("pan")],
      [freshOffer("leche"), freshOffer("pan", { normalPrice: 1.5 })],
      ["DIA"],
    )[0];
    expect(result).toMatchObject({
      estimatedTotal: 3.5,
      matchedItems: 2,
      totalItems: 2,
      coveragePercentage: 100,
      unavailableItems: [],
    });
  });

  it("ordena 10/10 por delante de 8/10 aunque su total sea mayor", () => {
    const intents = Array.from({ length: 10 }, (_, index) =>
      intent(String(index)),
    );
    const offers = intents.flatMap((item, index) => [
      freshOffer(item.id, { retailer: "DIA", normalPrice: 1.802 }),
      ...(index < 8
        ? [freshOffer(item.id, { retailer: "MERCADONA", normalPrice: 1.776 })]
        : []),
    ]);
    const result = compareBaskets(intents, offers, ["MERCADONA", "DIA"]);
    expect(result.map((basket) => basket.retailer)).toEqual([
      "DIA",
      "MERCADONA",
    ]);
    expect(result[1]).toMatchObject({
      matchedItems: 8,
      totalItems: 10,
      coveragePercentage: 80,
    });
  });

  it("no suma unavailable como cero y lo declara como falta", () => {
    const result = compareBaskets(
      [intent("pan")],
      [freshOffer("pan", { available: false })],
      ["DIA"],
    )[0];
    expect(result).toMatchObject({
      estimatedTotal: 0,
      matchedItems: 0,
      coveragePercentage: 0,
    });
    expect(result?.unavailableItems[0]?.reason).toBe("UNAVAILABLE");
  });

  it("cuenta STALE y penaliza VERY_STALE antes del precio", () => {
    const result = compareBaskets(
      [intent("pan")],
      [
        freshOffer("pan", {
          retailer: "DIA",
          freshness: "VERY_STALE",
          normalPrice: 1,
        }),
        freshOffer("pan", {
          retailer: "MERCADONA",
          freshness: "STALE",
          normalPrice: 2,
        }),
      ],
      ["DIA", "MERCADONA"],
    );
    expect(result[0]?.retailer).toBe("MERCADONA");
    expect(result[0]?.staleItems).toBe(1);
  });

  it("aplica promociones generales", () => {
    const result = compareBaskets(
      [intent("cafe", { requestedQuantity: 2 })],
      [freshOffer("cafe", { normalPrice: 3, promoPrice: 2.5 })],
      ["DIA"],
    )[0];
    expect(result).toMatchObject({ estimatedTotal: 5, promoItems: 1 });
    expect(result?.lines[0]).toMatchObject({
      effectiveUnitPrice: 2.5,
      membershipPriceNotApplied: false,
    });
  });

  it("no aplica promociones de membresía por defecto, pero permite declararla", () => {
    const offer = freshOffer("cafe", {
      normalPrice: 3,
      promoPrice: 2,
      requiresMembership: true,
    });
    expect(
      compareBaskets([intent("cafe")], [offer], ["DIA"])[0]?.lines[0],
    ).toMatchObject({
      estimatedLineTotal: 3,
      membershipPriceNotApplied: true,
    });
    expect(
      compareBaskets([intent("cafe")], [offer], ["DIA"], {
        memberships: ["DIA"],
      })[0]?.estimatedTotal,
    ).toBe(2);
  });

  it("estima peso variable con el peso esperado y marca aproximación", () => {
    const result = compareBaskets(
      [intent("pollo", { requestedQuantity: 1, requestedUnit: "kg" })],
      [
        freshOffer("pollo", {
          packageSize: 750,
          packageUnit: "g",
          variableWeight: true,
          normalPrice: 4.5,
          pricePerUnit: 6,
          referenceUnit: "kg",
        }),
      ],
      ["DIA"],
    )[0];
    expect(result?.lines[0]).toMatchObject({
      commercialUnits: 2,
      suppliedAmount: 1500,
      approximate: true,
      estimatedLineTotal: 9,
      normalizedPrice: 6,
      normalizedUnit: "kg",
    });
    expect(result?.estimatedTotalIsApproximate).toBe(true);
  });

  it("respeta packs y totalAmount", () => {
    const result = compareBaskets(
      [intent("yogur", { requestedQuantity: 10 })],
      [
        freshOffer("yogur", {
          packageSize: 1,
          packageUnit: "unit",
          packageCount: 6,
          normalPrice: 2,
        }),
      ],
      ["DIA"],
    )[0];
    expect(result?.lines[0]).toMatchObject({
      commercialUnits: 2,
      suppliedAmount: 12,
      estimatedLineTotal: 4,
    });
  });

  it("redondea envases comerciales hacia arriba para 2 L en botellas de 1,5 L", () => {
    const result = compareBaskets(
      [intent("agua", { requestedQuantity: 2, requestedUnit: "l" })],
      [
        freshOffer("agua", {
          packageSize: 1.5,
          packageUnit: "l",
          normalPrice: 1,
        }),
      ],
      ["DIA"],
    )[0];
    expect(result?.lines[0]).toMatchObject({
      commercialUnits: 2,
      suppliedAmount: 3,
      suppliedUnit: "l",
    });
  });

  it("genera una comparación vacía para un retailer sin matches", () => {
    const result = compareBaskets([intent("pan")], [], ["EROSKI"])[0];
    expect(result).toMatchObject({
      retailer: "EROSKI",
      matchedItems: 0,
      estimatedTotal: 0,
      coveragePercentage: 0,
    });
    expect(result?.unavailableItems[0]?.reason).toBe("NO_CONFIDENT_MATCH");
  });

  it("rechaza unidades incompatibles y matches LOW o no revisados", () => {
    const offers = [
      freshOffer("leche", { packageSize: 1, packageUnit: "kg" }),
      freshOffer("pan", { matchConfidence: "LOW" }),
      freshOffer("huevos", { matchAccepted: false }),
    ];
    const result = compareBaskets(
      [
        intent("leche", { requestedQuantity: 1, requestedUnit: "l" }),
        intent("pan"),
        intent("huevos"),
      ],
      offers,
      ["DIA"],
    )[0];
    expect(result?.lines.map((line) => line.status)).toEqual([
      "INCOMPATIBLE_UNITS",
      "NO_CONFIDENT_MATCH",
      "NO_CONFIDENT_MATCH",
    ]);
  });
});
