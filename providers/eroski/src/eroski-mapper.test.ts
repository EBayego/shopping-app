import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MarketResolutionError } from "@shopping-app/retailer-contracts";

import { EroskiHtmlParser } from "./eroski-html-parser.js";
import { EroskiMapper } from "./eroski-mapper.js";

const PRODUCT_URL =
  "https://supermercado.eroski.es/es/productdetail/18631259-solomillo-de-pavo-al-vacio-eroski-bipack-sobre-al-peso-aprox-750-g/";
const OBSERVED_AT = new Date("2026-08-09T12:00:00.000Z");
const MARKET = {
  retailer: "EROSKI",
  externalId: "shop-ref:sanitized-shop-001",
  postalCode: "unknown",
  metadata: { shopRef: "sanitized-shop-001" },
} as const;

function dto() {
  return new EroskiHtmlParser().parse(
    readFileSync(
      new URL("./fixtures/product-18631259.html", import.meta.url),
      "utf8",
    ),
    PRODUCT_URL,
  );
}

describe("EroskiMapper", () => {
  it("mantiene producto y oferta separados", () => {
    const mapper = new EroskiMapper();
    const product = mapper.toProduct(dto(), MARKET, OBSERVED_AT);
    const offer = mapper.toOffer(dto(), MARKET, OBSERVED_AT);

    expect(product).toEqual({
      retailer: "EROSKI",
      externalId: "18631259",
      name: "Solomillo de pavo al vacío EROSKI, bipack, sobre al peso aprox. 750 g",
      brand: "EROSKI",
      packageSize: 750,
      packageUnit: "g",
      variableWeight: true,
      imageUrl: "https://supermercado.eroski.es/images/products/18631259.jpg",
      productUrl: PRODUCT_URL,
      marketId: "shop-ref:sanitized-shop-001",
      observedAt: OBSERVED_AT,
    });
    expect(product).not.toHaveProperty("price");
    expect(product).not.toHaveProperty("normalPrice");
    expect(offer).toEqual({
      retailerProductId: "18631259",
      marketId: "shop-ref:sanitized-shop-001",
      normalPrice: 6,
      pricePerUnit: 8,
      referenceUnit: "kg",
      requiresMembership: false,
      available: true,
      observedAt: OBSERVED_AT,
    });
  });

  it("rechaza un shopRef distinto al mercado suministrado", () => {
    expect(() =>
      new EroskiMapper().toOffer(
        dto(),
        { ...MARKET, externalId: "shop-ref:other", metadata: {} },
        OBSERVED_AT,
      ),
    ).toThrow(MarketResolutionError);
  });
});
