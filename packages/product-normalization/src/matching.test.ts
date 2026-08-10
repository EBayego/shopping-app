import type { CanonicalProduct, RetailerProduct } from "@shopping-app/domain";
import { describe, expect, it } from "vitest";

import { isValidGtin } from "./gtin.ts";
import { generateMatchCandidates, scoreProductMatch } from "./matching.ts";

describe("GTIN identity", () => {
  it.each(["4006381333931", "96385074"])(
    "validates a correct GTIN %s",
    (gtin) => {
      expect(isValidGtin(gtin)).toBe(true);
    },
  );

  it.each(["4006381333932", "123", "ABCDEFGHIJKLM"])(
    "rejects invalid GTIN %s",
    (gtin) => {
      expect(isValidGtin(gtin)).toBe(false);
    },
  );

  it("gives a valid identical GTIN precedence over other differences", () => {
    const candidate = scoreProductMatch(
      retailer("Coca-Cola Zero 2 L", { gtin: "4006381333931" }),
      canonical("cola", { gtin: "4006381333931" }),
    );
    expect(candidate).toMatchObject({
      matchType: "EXACT_MATCH",
      method: "GTIN_EXACT",
      score: 1,
      confidence: "HIGH",
      autoAccept: true,
    });
  });

  it("does not use an invalid identical code as exact identity", () => {
    const candidate = scoreProductMatch(
      retailer("Producto A", { gtin: "12345678" }),
      canonical("Producto B", { gtin: "12345678" }),
    );
    expect(candidate?.method).not.toBe("GTIN_EXACT");
  });
});

describe("explainable matching cascade", () => {
  it("identifies same brand, variant and format as a commercial exact match", () => {
    const candidate = scoreProductMatch(
      retailer("Leche semidesnatada Central Lechera botella 1 L", {
        brand: "Central Lechera",
        category: "Leche",
        packageSize: 1,
        packageUnit: "l",
      }),
      canonical("Leche semidesnatada", {
        brand: "Central Lechera",
        category: "Leche",
        packageSize: 1,
        packageUnit: "l",
        variant: "semidesnatada",
      }),
    );
    expect(candidate).toMatchObject({
      matchType: "EXACT_MATCH",
      method: "BRAND_VARIANT_FORMAT",
      confidence: "HIGH",
    });
    expect(
      candidate?.reasons.some(
        (reason) => reason.feature === "brand" && reason.matched,
      ),
    ).toBe(true);
  });

  it("classifies equivalent DIA and Hacendado milk as substitute", () => {
    const candidate = scoreProductMatch(
      retailer("Leche semidesnatada Dia Láctea 1 L", {
        brand: "Dia Láctea",
        category: "Leche",
        packageSize: 1,
        packageUnit: "l",
      }),
      canonical("Leche semidesnatada", {
        brand: "Hacendado",
        category: "Leche",
        packageSize: 1,
        packageUnit: "l",
        variant: "semidesnatada",
      }),
    );
    expect(candidate).toMatchObject({
      matchType: "SUBSTITUTE",
      confidence: "MEDIUM",
      autoAccept: false,
    });
  });

  it("rejects different categories even with similar names", () => {
    expect(
      scoreProductMatch(
        retailer("Crema de leche 500 ml", {
          category: "Lácteos",
          packageSize: 500,
          packageUnit: "ml",
        }),
        canonical("Crema de leche", {
          category: "Cosmética",
          packageSize: 500,
          packageUnit: "ml",
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects incompatible formats and dimensions", () => {
    expect(
      scoreProductMatch(
        retailer("Tomate triturado 1 kg", {
          packageSize: 1,
          packageUnit: "kg",
        }),
        canonical("Tomate triturado", { packageSize: 1, packageUnit: "l" }),
      ),
    ).toBeUndefined();
  });

  it("avoids a textual false positive", () => {
    expect(
      scoreProductMatch(
        retailer("Leche corporal hidratante"),
        canonical("Leche semidesnatada"),
      ),
    ).toBeUndefined();
  });

  it("returns low confidence candidates but never auto-accepts them", () => {
    const candidate = scoreProductMatch(
      retailer("Leche semidesnatada"),
      canonical("Leche fresca semidesnatada", { variant: "semidesnatada" }),
    );
    expect(candidate).toMatchObject({ confidence: "LOW", autoAccept: false });
  });

  it("sorts candidates deterministically and omits non-candidates", () => {
    const product = retailer("Leche semidesnatada 1 L", {
      category: "Leche",
      packageSize: 1,
      packageUnit: "l",
    });
    const candidates = generateMatchCandidates(product, [
      canonical("Detergente", { id: "z" }),
      canonical("Leche semidesnatada", {
        id: "a",
        category: "Leche",
        packageSize: 1,
        packageUnit: "l",
      }),
    ]);
    expect(candidates.map((candidate) => candidate.canonicalProductId)).toEqual(
      ["a"],
    );
  });
});

function retailer(
  name: string,
  overrides: Partial<RetailerProduct> = {},
): RetailerProduct {
  return {
    retailer: "DIA",
    externalId: "retailer-id",
    name,
    variableWeight: false,
    marketId: "market",
    observedAt: new Date(0),
    ...overrides,
  };
}

function canonical(
  name: string,
  overrides: Partial<CanonicalProduct> = {},
): CanonicalProduct {
  const normalizedName = name.toLocaleLowerCase("es-ES");
  return {
    id: "canonical-id",
    name,
    normalizedName,
    baseName: normalizedName.replace(" semidesnatada", ""),
    ...overrides,
  };
}
