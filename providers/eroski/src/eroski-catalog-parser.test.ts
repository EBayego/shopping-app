import { describe, expect, it } from "vitest";

import {
  EroskiCatalogParser,
  EroskiCatalogStructureError,
} from "./eroski-catalog-parser.js";

const BASE_URL = "https://supermercado.eroski.es/";

function metrics(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "select_item",
    ecommerce: {
      currency: "EUR",
      items: [
        {
          price: 5.59,
          item_name:
            "Solomillo de pavo al vacío EROSKI, bipack, sobre al peso aprox. 750 g",
          item_id: "18631259",
          item_brand: "EROSKI",
          item_category: "2059698",
          item_category2: "2059746",
          item_category3: "2059750",
          ...overrides,
        },
      ],
    },
  }).replaceAll('"', "&quot;");
}

describe("EroskiCatalogParser", () => {
  it("extrae categorías de segundo nivel del menú de alimentación", () => {
    const html = `<ul class="nav-level-1">
      <li class="nav-item"><a>Alimentación</a><ul class="nav-level-2">
        <li><a href="/es/supermercado/2059806-alimentacion/2059851-mantequilla-nata-y-cremas/">Mantequilla, nata y cremas</a><ul>
          <li class="nav-item-seeall"><a class="no-children" href="/es/supermercado/2059806-alimentacion/2059851-mantequilla-nata-y-cremas/">Ver todo</a></li>
          <li><a class="no-children" href="/es/supermercado/2059806-alimentacion/2059851-mantequilla-nata-y-cremas/2059852-mantequilla/">Mantequilla</a></li>
        </ul></li>
      </ul></li>
      <li class="nav-item featured-items"><a>Electrónica</a><ul><li><a class="no-children" href="/es/supermercado/6000420-electronica/6000568-consolas/6000575-switch/">Switch</a></li></ul></li>
    </ul>`;

    expect(new EroskiCatalogParser().parseCategories(html, BASE_URL)).toEqual([
      {
        externalId: "2059851",
        name: "Mantequilla, nata y cremas",
        path: "/es/supermercado/2059806-alimentacion/2059851-mantequilla-nata-y-cremas/",
        rootName: "Alimentación",
        parentName: "Mantequilla, nata y cremas",
        order: 0,
      },
    ]);
  });

  it("mapea promoción, precio anterior y peso variable de una tarjeta", () => {
    const html = `<div id="productListZone"><div class="product-item big-item">
      <img class="product-img" src="/images/18631259.jpg">
      <a class="product-title-link" data-metrics="${metrics()}" href="/es/productdetail/18631259-solomillo/">Solomillo de pavo al vacío EROSKI, bipack, sobre al peso aprox. 750 g</a>
      <p class="quantity-text">1 KILO A 7,45 €</p>
      <div class="product-offer">-6%</div>
      <span class="offer-before">6,00</span>
      <span class="price-offer-now">5,59</span>
    </div></div>`;

    expect(
      new EroskiCatalogParser().parseProducts(html, BASE_URL, "157", {
        rootName: "Frescos",
        parentName: "Carnes y aves",
      }),
    ).toEqual([
      {
        externalId: "18631259",
        name: "Solomillo de pavo al vacío EROSKI, bipack, sobre al peso aprox. 750 g",
        brand: "EROSKI",
        normalPrice: 6,
        promoPrice: 5.59,
        unitPrice: { amount: 7.45, unit: "kg" },
        weight: { amount: 750, unit: "g" },
        shopRef: "157",
        image: "https://supermercado.eroski.es/images/18631259.jpg",
        availability: true,
        variableWeight: true,
        productUrl:
          "https://supermercado.eroski.es/es/productdetail/18631259-solomillo/",
        category: "Frescos",
        subcategory: "Carnes y aves",
        promotionType: "percentage",
        promotionText: "-6%",
        requiresMembership: false,
      },
    ]);
  });

  it("valida que el precio visible coincida con analytics", () => {
    const html = `<div class="product-item big-item"><a class="product-title-link" data-metrics="${metrics({ price: 4 })}" href="/es/productdetail/18631259-x/">Producto</a><span class="price-offer-now">5,59</span></div>`;
    expect(() =>
      new EroskiCatalogParser().parseProducts(html, BASE_URL, "157"),
    ).toThrow(EroskiCatalogStructureError);
  });
});
