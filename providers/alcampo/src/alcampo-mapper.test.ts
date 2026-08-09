import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseAlcampoProduct } from "./alcampo-dtos.js";
import { AlcampoMapper } from "./alcampo-mapper.js";

const OBSERVED_AT = new Date("2026-08-09T09:00:00.000Z");
const MARKET = {
  retailer: "ALCAMPO",
  externalId: "configured:test",
  postalCode: "50009",
} as const;

function productFixture() {
  const payload: unknown = JSON.parse(
    readFileSync(
      new URL("./fixtures/product-70212.json", import.meta.url),
      "utf8",
    ),
  );
  const dto = parseAlcampoProduct(payload);
  if (dto === undefined) throw new Error("Invalid test fixture");
  return dto;
}

describe("AlcampoMapper", () => {
  it("usa el peso típico de CATCHWEIGHT y conserva la clasificación", () => {
    const product = new AlcampoMapper().toProduct(
      productFixture(),
      MARKET,
      OBSERVED_AT,
    );
    expect(product).toMatchObject({
      retailer: "ALCAMPO",
      externalId: "70212",
      packageSize: 400,
      packageUnit: "g",
      variableWeight: true,
      category: "Frescos",
      subcategory: "Cerdo",
      marketId: "configured:test",
      observedAt: OBSERVED_AT,
    });
  });

  it("normaliza el precio y el precio por kilogramo", () => {
    const offer = new AlcampoMapper().toOffer(
      productFixture(),
      MARKET,
      OBSERVED_AT,
    );
    expect(offer).toEqual({
      retailerProductId: "70212",
      marketId: "configured:test",
      normalPrice: 4.78,
      pricePerUnit: 11.95,
      referenceUnit: "kg",
      requiresMembership: false,
      available: true,
      observedAt: OBSERVED_AT,
    });
  });
});
