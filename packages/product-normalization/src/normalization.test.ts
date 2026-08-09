import type { RetailerProduct } from "@shopping-app/domain";
import { describe, expect, it } from "vitest";

import { normalizeProduct, normalizeText } from "./normalization.js";
import {
  normalizeQuantity,
  parsePackagingFromName,
  quantitiesCompatible,
} from "./units.js";

describe("text normalization", () => {
  it("normalizes accents, casing, punctuation and repeated whitespace", () => {
    expect(normalizeText("  LECHE   Semidesnatada, ¡DÍA!  ")).toBe(
      "leche semidesnatada dia",
    );
  });

  it("keeps the original name while deriving brand, variant and comparable text", () => {
    const product = dia("Leche semidesnatada Dia Láctea pack 6 x 1 L", {
      brand: "DIA Láctea",
    });
    const normalized = normalizeProduct(product);
    expect(normalized.originalName).toBe(product.name);
    expect(normalized.normalizedBrand).toBe("dia lactea");
    expect(normalized.variant).toBe("semidesnatada");
    expect(normalized.normalizedName).toBe("leche semidesnatada");
    expect(normalized.baseName).toBe("leche");
  });

  it("parses a conservative single package from a DIA-style name", () => {
    const normalized = normalizeProduct(
      dia("Pan de leche El Molino de Dia 350 g"),
    );
    expect(normalized.packaging.packageSize).toMatchObject({
      amount: 350,
      unit: "g",
      baseAmount: 350,
    });
    expect(normalized.packaging.source).toBe("NAME");
  });

  it("prefers provider structured packaging without mutating it", () => {
    const product = dia("Leche entera Dia Láctea botella 1500 ml", {
      packageSize: 1.5,
      packageUnit: "l",
    });
    const normalized = normalizeProduct(product);
    expect(normalized.packaging.source).toBe("STRUCTURED");
    expect(normalized.packaging.totalAmount).toMatchObject({
      amount: 1.5,
      unit: "l",
      baseAmount: 1500,
    });
    expect(product.packageSize).toBe(1.5);
  });
});

describe("unit and packaging normalization", () => {
  it.each([
    [2000, "ml", 2, "l", 2000, "ml"],
    [1000, "g", 1, "kg", 1000, "g"],
    [2500, "mg", 2.5, "g", 2.5, "g"],
    [75, "cl", 750, "ml", 750, "ml"],
    [3, "piezas", 3, "unit", 3, "unit"],
  ])(
    "normalizes %s %s",
    (amount, unit, expectedAmount, expectedUnit, baseAmount, baseUnit) => {
      expect(normalizeQuantity(amount, unit)).toMatchObject({
        amount: expectedAmount,
        unit: expectedUnit,
        baseAmount,
        baseUnit,
      });
    },
  );

  it("parses 6 x 125 g and calculates 750 g", () => {
    const packaging = parsePackagingFromName("Yogur natural pack 6 x 125 g");
    expect(packaging.packageCount).toBe(6);
    expect(packaging.packageSize).toMatchObject({ amount: 125, unit: "g" });
    expect(packaging.totalAmount).toMatchObject({
      amount: 750,
      unit: "g",
      baseAmount: 750,
    });
  });

  it("parses pack 6 x 1 L and calculates 6 L", () => {
    const packaging = parsePackagingFromName("Leche pack 6 x 1 L");
    expect(packaging.packageCount).toBe(6);
    expect(packaging.totalAmount).toMatchObject({
      amount: 6,
      unit: "l",
      baseAmount: 6000,
    });
  });

  it("parses counted bottles", () => {
    expect(
      parsePackagingFromName("Agua 2 botellas de 2 L").totalAmount,
    ).toMatchObject({ amount: 4, unit: "l" });
  });

  it("does not compare mass with volume", () => {
    expect(
      quantitiesCompatible(
        normalizeQuantity(1, "kg"),
        normalizeQuantity(1, "l"),
      ),
    ).toBe(false);
  });

  it("leaves unknown packaging unknown", () => {
    expect(parsePackagingFromName("Fruta selección familiar")).toEqual({
      source: "UNKNOWN",
    });
  });
});

function dia(
  name: string,
  overrides: Partial<RetailerProduct> = {},
): RetailerProduct {
  return {
    retailer: "DIA",
    externalId: "dia-product",
    name,
    variableWeight: false,
    marketId: "postal-code:50009",
    observedAt: new Date("2026-08-09T00:00:00Z"),
    ...overrides,
  };
}
