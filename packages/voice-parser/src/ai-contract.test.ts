import { describe, expect, it } from "vitest";
import {
  MAX_AI_ITEMS,
  parseAiShoppingResponse,
  SHOPPING_EXTRACTION_SCHEMA,
} from "./ai-contract.ts";

export function aiItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rawText: "dos botellas de agua de un litro y medio",
    product: "agua",
    variant: null,
    brandPreference: null,
    requestedQuantity: null,
    requestedUnit: null,
    packageCount: 2,
    packageSize: 1.5,
    packageUnit: "l",
    packageType: "bottle",
    needsReview: false,
    reviewReason: null,
    ...overrides,
  };
}

describe("AI shopping contract", () => {
  it("validates the shared strict schema and derives totals without model confidence", () => {
    const result = parseAiShoppingResponse(
      { items: [aiItem()] },
      "quiero dos botellas de agua de un litro y medio",
    );
    expect(result[0]).toMatchObject({
      product: "agua",
      packageType: "bottle",
      totalAmount: 3,
      source: "AI",
      confidence: "MEDIUM",
      needsReview: false,
    });
    expect(
      SHOPPING_EXTRACTION_SCHEMA.properties.items.items.required,
    ).toContain("packageType");
  });
  it.each([
    { packageCount: -1 },
    { packageCount: 1.2 },
    { packageSize: 0 },
    { packageSize: Infinity },
    { packageUnit: "ounces" },
    { requestedQuantity: 2 },
    { packageType: "invented" },
    { rawText: "un producto no dicho" },
    { surprise: "extra" },
    { needsReview: "yes" },
  ])("rejects malformed or ungrounded fields %j", (overrides) => {
    expect(() =>
      parseAiShoppingResponse(
        { items: [aiItem(overrides)] },
        "dos botellas de agua de un litro y medio",
      ),
    ).toThrow();
  });
  it("rejects omissions and too many products", () => {
    const incomplete = aiItem();
    delete incomplete.packageType;
    expect(() =>
      parseAiShoppingResponse(
        { items: [incomplete] },
        String(incomplete.rawText),
      ),
    ).toThrow();
    expect(() =>
      parseAiShoppingResponse(
        { items: Array.from({ length: MAX_AI_ITEMS + 1 }, () => aiItem()) },
        "",
      ),
    ).toThrow();
  });
  it("preserves unknown brands, variants and flattened inner containers", () => {
    const rawText =
      "dos packs de seis latas sin azúcar de marca Nueva de 33 cl";
    expect(
      parseAiShoppingResponse(
        {
          items: [
            aiItem({
              rawText,
              product: "refresco",
              variant: "sin azúcar",
              brandPreference: "Nueva",
              packageCount: 12,
              packageSize: 33,
              packageUnit: "cl",
              packageType: "can",
            }),
          ],
        },
        rawText,
      )[0],
    ).toMatchObject({
      brandPreference: "Nueva",
      variant: "sin azúcar",
      packageCount: 12,
      totalAmount: 396,
    });
  });
  it("supports corrections and uncertain products without inventing a quantity", () => {
    const transcript =
      "dos litros de leche, no tres, y ese queso que no recuerdo";
    const items = [
      aiItem({
        rawText: "dos litros de leche, no tres",
        product: "leche",
        packageCount: null,
        packageSize: null,
        packageUnit: null,
        packageType: null,
        requestedQuantity: 3,
        requestedUnit: "l",
      }),
      aiItem({
        rawText: "ese queso que no recuerdo",
        product: null,
        packageCount: null,
        packageSize: null,
        packageUnit: null,
        packageType: null,
        needsReview: true,
        reviewReason: "Producto sin identificar",
      }),
    ];
    expect(parseAiShoppingResponse({ items }, transcript)).toMatchObject([
      { requestedQuantity: 3, totalAmount: 3 },
      { needsReview: true, reviewReason: "Producto sin identificar" },
    ]);
  });
  it("keeps requested mass independent from a single package's size", () => {
    const rawText = "dos kilos de arroz en bolsas de 500 gramos";
    expect(
      parseAiShoppingResponse(
        {
          items: [
            aiItem({
              rawText,
              product: "arroz",
              packageCount: null,
              packageSize: 500,
              packageUnit: "g",
              packageType: "bag",
              requestedQuantity: 2,
              requestedUnit: "kg",
            }),
          ],
        },
        rawText,
      )[0]?.totalAmount,
    ).toBe(2000);
  });
  it("allows no products for non-shopping speech", () => {
    expect(parseAiShoppingResponse({ items: [] }, "gracias por todo")).toEqual(
      [],
    );
  });
});
