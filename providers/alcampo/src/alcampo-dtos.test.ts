import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseAlcampoProduct } from "./alcampo-dtos.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

describe("parseAlcampoProduct", () => {
  it("normaliza importes y unidades del producto CATCHWEIGHT confirmado", () => {
    expect(parseAlcampoProduct(fixture("product-70212.json"))).toMatchObject({
      retailerProductId: "70212",
      type: "CATCHWEIGHT",
      price: { amount: 4.78, currency: "EUR" },
      unitPrice: { amount: 11.95, currency: "EUR", unit: "kg" },
      catchweight: {
        min: { amount: 300, unit: "g" },
        typical: { amount: 400, unit: "g" },
        max: { amount: 500, unit: "g" },
      },
    });
  });

  it("rechaza importes inválidos, catchweight ausente y rangos incoherentes", () => {
    expect(
      parseAlcampoProduct(fixture("product-invalid.json")),
    ).toBeUndefined();
    const product = fixture("product-70212.json") as Record<string, unknown>;
    expect(
      parseAlcampoProduct({
        ...product,
        catchweight: {
          min: { amount: 500, unit: "g" },
          typical: { amount: 400, unit: "g" },
          max: { amount: 300, unit: "g" },
        },
      }),
    ).toBeUndefined();
  });
});
