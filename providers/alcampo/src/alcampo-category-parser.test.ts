import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AlcampoCategoryHtmlError,
  AlcampoCategoryParser,
} from "./alcampo-category-parser.js";

describe("AlcampoCategoryParser", () => {
  const parser = new AlcampoCategoryParser();
  it("extrae IDs numéricos, URLs y deduplica", () => {
    const html = readFileSync(
      new URL("./fixtures/category-oc1603.html", import.meta.url),
      "utf8",
    );
    const result = parser.parse(
      html,
      "https://www.compraonline.alcampo.es/categories/a/b/OC1603",
    );
    expect(result.retailerProductIds).toEqual(["54180", "54178"]);
    expect(result.productUrls.get("54180")).toContain(
      "/products/duplicado/54180",
    );
    expect(result.internalProductIds.get("54180")).toBe(
      "f4a76c09-e523-4667-99fb-a390a581a78c",
    );
  });

  it("no confunde el primer lote con una categoría completa de 50 productos", () => {
    const itemListElement = Array.from({ length: 50 }, (_, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: { url: `/products/producto-${index + 1}/${54000 + index}` },
    }));
    const html = `<script data-test="product-listing-structured-data" type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement })}</script>`;
    expect(
      parser.parse(
        html,
        "https://www.compraonline.alcampo.es/categories/a/b/OC1603",
      ).retailerProductIds,
    ).toHaveLength(50);
  });

  it("rechaza script ausente, JSON inválido, ItemList incompatible y URL inválida", () => {
    expect(() => parser.parse("<html></html>", "https://example.test")).toThrow(
      AlcampoCategoryHtmlError,
    );
    expect(() =>
      parser.parse(
        '<script data-test="product-listing-structured-data" type="application/ld+json">{</script>',
        "https://example.test",
      ),
    ).toThrow(AlcampoCategoryHtmlError);
    expect(() =>
      parser.parse(
        '<script data-test="product-listing-structured-data" type="application/ld+json">{"@type":"Product"}</script>',
        "https://example.test",
      ),
    ).toThrow(AlcampoCategoryHtmlError);
    expect(() =>
      parser.parse(
        '<script data-test="product-listing-structured-data" type="application/ld+json">{"@type":"ItemList","itemListElement":[{"item":{"url":"/bad"}}]}</script>',
        "https://example.test",
      ),
    ).toThrow(AlcampoCategoryHtmlError);
  });
});
