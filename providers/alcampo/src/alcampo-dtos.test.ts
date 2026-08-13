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

  it("acepta el wrapper v5 y normaliza unidades localizadas de v6", () => {
    const catchweight = fixture("product-70212.json");
    expect(parseAlcampoProduct({ product: catchweight })).toMatchObject({
      retailerProductId: "70212",
      unitPrice: { amount: 11.95, unit: "kg" },
    });

    const shampoo = {
      ...(fixture("product-54180.json") as Record<string, unknown>),
      retailerProductId: "648270",
      price: { amount: "3.87", currency: "EUR" },
      unitPrice: {
        price: { amount: "0.97", currency: "EUR" },
        unit: "fop.price.per.100ml",
        unitName: "PER_100ML",
      },
      promotions: null,
    };
    expect(parseAlcampoProduct(shampoo)).toMatchObject({
      retailerProductId: "648270",
      unitPrice: { amount: 9.7, currency: "EUR", unit: "l" },
      promotions: [],
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
