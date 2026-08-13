import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EroskiHtmlParser,
  EroskiHtmlStructureError,
} from "./eroski-html-parser.js";

const PRODUCT_URL =
  "https://supermercado.eroski.es/es/productdetail/18631259-solomillo-de-pavo-al-vacio-eroski-bipack-sobre-al-peso-aprox-750-g/";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("EroskiHtmlParser", () => {
  it("extrae producto, precio y shopRef del HTML mediante el DOM", () => {
    const dto = new EroskiHtmlParser().parse(
      fixture("product-18631259.html"),
      PRODUCT_URL,
    );

    expect(dto).toEqual({
      externalId: "18631259",
      name: "Solomillo de pavo al vacío EROSKI, bipack, sobre al peso aprox. 750 g",
      brand: "EROSKI",
      normalPrice: 6,
      unitPrice: { amount: 8, unit: "kg" },
      weight: { amount: 750, unit: "g" },
      shopRef: "sanitized-shop-001",
      image: "https://supermercado.eroski.es/images/products/18631259.jpg",
      availability: true,
      variableWeight: true,
      productUrl: PRODUCT_URL,
      requiresMembership: false,
    });
  });

  it("usa datos semánticos como fallback y tolera JSON-LD ajeno malformado", () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{invalid</script>
      <script type="application/ld+json">{
        "@graph": [{"@type":"Product","sku":"42","name":"Leche EROSKI 1 l","brand":"EROSKI","image":"/42.jpg","offers":{"price":"1,25","availability":"https://schema.org/OutOfStock"}}]
      }</script>
      </head><body><main data-shop-ref="shop-42"><p class="unit-price">1 LITRO A 1,25 €</p></main></body></html>`;

    expect(
      new EroskiHtmlParser().parse(
        html,
        "https://supermercado.eroski.es/es/productdetail/42-leche/",
      ),
    ).toMatchObject({
      externalId: "42",
      name: "Leche EROSKI 1 l",
      brand: "EROSKI",
      normalPrice: 1.25,
      unitPrice: { amount: 1.25, unit: "l" },
      weight: { amount: 1, unit: "l" },
      shopRef: "shop-42",
      availability: false,
    });
  });

  it("detecta de forma explícita un cambio de estructura", () => {
    expect(() =>
      new EroskiHtmlParser().parse(
        fixture("product-structure-changed.html"),
        PRODUCT_URL,
      ),
    ).toThrow(EroskiHtmlStructureError);

    try {
      new EroskiHtmlParser().parse(
        fixture("product-structure-changed.html"),
        PRODUCT_URL,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(EroskiHtmlStructureError);
      expect((error as EroskiHtmlStructureError).missingFields).toEqual([
        "name",
        "normalPrice",
        "shopRef",
        "availability",
      ]);
    }
  });
});
