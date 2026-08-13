import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAlcampoProduct } from "./alcampo-dtos.js";
import { AlcampoMapper } from "./alcampo-mapper.js";

const OBSERVED_AT = new Date("2026-08-09T09:00:00.000Z");
const MARKET = {
  retailer: "ALCAMPO",
  externalId: "region-fixture",
  postalCode: "50009",
} as const;
function dto(name: string) {
  const parsed = parseAlcampoProduct(
    JSON.parse(
      readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
    ) as unknown,
  );
  if (parsed === undefined) throw new Error("Invalid fixture");
  return parsed;
}

describe("AlcampoMapper", () => {
  it("mapea REGULAR, formato múltiple, imagen y URL", () => {
    const product = new AlcampoMapper().toProduct(
      {
        ...dto("product-54180.json"),
        productUrl:
          "https://www.compraonline.alcampo.es/products/example/54180",
      },
      MARKET,
      OBSERVED_AT,
    );
    expect(product).toMatchObject({
      externalId: "54180",
      packageSize: 1,
      packageUnit: "l",
      packageCount: 6,
      totalAmount: 6,
      variableWeight: false,
      imageUrl: "https://cdn.example.test/54180.jpg",
      productUrl: "https://www.compraonline.alcampo.es/products/example/54180",
    });
  });

  it("conserva peso típico y €/kg sin tratar el estimado como peso fijo", () => {
    const product = new AlcampoMapper().toProduct(
      dto("product-70212.json"),
      MARKET,
      OBSERVED_AT,
    );
    const offer = new AlcampoMapper().toOffer(
      dto("product-70212.json"),
      MARKET,
      OBSERVED_AT,
    );
    expect(product).toMatchObject({
      packageSize: 400,
      packageUnit: "g",
      variableWeight: true,
    });
    expect(offer).toMatchObject({
      normalPrice: 4.78,
      pricePerUnit: 11.95,
      referenceUnit: "kg",
    });
  });

  it("conserva promoción no calculable y availability", () => {
    const promotion = new AlcampoMapper().toOffer(
      dto("product-54178-promotion.json"),
      MARKET,
      OBSERVED_AT,
    );
    const unavailable = new AlcampoMapper().toOffer(
      dto("product-unavailable.json"),
      MARKET,
      OBSERVED_AT,
    );
    expect(promotion).toMatchObject({
      promotionText: "Producto en folleto",
      promotionType: "other",
    });
    expect(promotion.promoPrice).toBeUndefined();
    expect(unavailable.available).toBe(false);
  });

  it("clasifica LOYALTY y ofertas multi-buy sin inventar precio", () => {
    const mapper = new AlcampoMapper();
    const base = dto("product-54180.json");
    const loyalty = mapper.toOffer(
      {
        ...base,
        promotions: [
          {
            type: "LOYALTY",
            description: "Club Alcampo 40% acumulado en tu tarjeta",
            requiresMembership: true,
          },
        ],
      },
      MARKET,
      OBSERVED_AT,
    );
    const multiBuy = mapper.toOffer(
      {
        ...base,
        promotions: [{ type: "OFFER", description: "2ª unidad -50%" }],
      },
      MARKET,
      OBSERVED_AT,
    );
    expect(loyalty).toMatchObject({
      promotionType: "membership",
      requiresMembership: true,
    });
    expect(multiBuy.promotionType).toBe("multi-buy");
    expect(loyalty.promoPrice).toBeUndefined();
    expect(multiBuy.promoPrice).toBeUndefined();
  });
});
