import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseMercadonaCategories,
  parseMercadonaProduct,
} from "./mercadona-dtos.js";
import { MercadonaMapper } from "./mercadona-mapper.js";
import { MercadonaMarketContext } from "./mercadona-market-context.js";

const PRODUCT_FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL("./fixtures/product-10382.json", import.meta.url),
    "utf8",
  ),
);
const CATEGORIES_FIXTURE: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/categories.json", import.meta.url), "utf8"),
);
const OBSERVED_AT = new Date("2026-08-09T09:00:00.000Z");

describe("MercadonaMapper", () => {
  it("mapea mercado, producto y oferta sin exponer el DTO", () => {
    const mapper = new MercadonaMapper();
    const market = mapper.toMarket(
      new MercadonaMarketContext({ postalCode: "50009", warehouse: "4491" }),
    );
    const dto = parseMercadonaProduct(PRODUCT_FIXTURE);
    expect(dto).toBeDefined();
    if (dto === undefined) return;

    expect(Object.isFrozen(market)).toBe(true);
    expect(market).toEqual({
      retailer: "MERCADONA",
      externalId: "warehouse:4491",
      postalCode: "50009",
      name: "Mercadona 50009",
      metadata: { warehouse: "4491" },
    });
    expect(mapper.toProduct(dto, market, OBSERVED_AT)).toEqual({
      retailer: "MERCADONA",
      externalId: "10382",
      name: "Leche semidesnatada Hacendado",
      brand: "Hacendado",
      gtin: "8402001002106",
      ean: "8402001002106",
      packageSize: 1,
      packageUnit: "l",
      variableWeight: false,
      category: "Huevos, leche y mantequilla",
      imageUrl:
        "https://prod-mercadona.imgix.net/images/leche.jpg?fit=crop&h=300&w=300",
      productUrl:
        "https://tienda.mercadona.es/product/10382/leche-semidesnatada-hacendado-brick",
      marketId: "warehouse:4491",
      observedAt: OBSERVED_AT,
    });
    expect(mapper.toOffer(dto, market, OBSERVED_AT)).toEqual({
      retailerProductId: "10382",
      marketId: "warehouse:4491",
      normalPrice: 0.84,
      pricePerUnit: 0.84,
      referenceUnit: "l",
      requiresMembership: false,
      available: true,
      observedAt: OBSERVED_AT,
    });
  });

  it("mapea la jerarquía de Mercadona a categorías genéricas planas", () => {
    const mapper = new MercadonaMapper();
    const dtos = parseMercadonaCategories(CATEGORIES_FIXTURE);
    expect(dtos).toBeDefined();
    if (dtos === undefined || dtos[0] === undefined) return;

    expect(mapper.toCategories(dtos[0])).toEqual([
      {
        externalId: "6",
        name: "Huevos, leche y mantequilla",
        level: 0,
        order: 373,
      },
      {
        externalId: "72",
        name: "Leche y bebidas vegetales",
        parentExternalId: "6",
        level: 1,
        order: 373,
      },
    ]);
  });
});
