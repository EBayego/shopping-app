import { describe, expect, it } from "vitest";

import {
  MarketResolutionError,
  ProductNotFoundError,
} from "@shopping-app/retailer-contracts";

import { MockRetailerProvider } from "./mock-provider.js";

describe("MockRetailerProvider", () => {
  it("resuelve mercado y separa productos de ofertas al buscar", async () => {
    const provider = new MockRetailerProvider("DIA");
    const market = await provider.resolveMarket("50009");
    const { products, offers } = await provider.searchProducts("leche", market);

    expect(market).toMatchObject({
      retailer: "DIA",
      postalCode: "50009",
    });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      externalId: "261354",
      marketId: market.externalId,
      variableWeight: false,
    });
    expect(products[0]).not.toHaveProperty("normalPrice");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      retailerProductId: "261354",
      normalPrice: 1.19,
      promoPrice: 0.99,
    });
  });

  it("obtiene producto y refresca su oferta por separado", async () => {
    const provider = new MockRetailerProvider("MERCADONA");
    const market = await provider.resolveMarket("50009");
    const product = await provider.getProduct("261354", market);
    const offers = await provider.refreshPrices([product.externalId], market);

    expect(product.externalId).toBe("261354");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      retailerProductId: "261354",
      normalPrice: 1.19,
      promoPrice: 0.99,
      promotionType: "fixed-price",
      available: true,
    });
  });

  it("expone un health check saludable para cada mock", async () => {
    const provider = new MockRetailerProvider("ALCAMPO");

    await expect(provider.healthCheck()).resolves.toMatchObject({
      retailer: "ALCAMPO",
      status: "healthy",
    });
  });

  it("lanza errores tipados para productos y mercados inválidos", async () => {
    const provider = new MockRetailerProvider("EROSKI");
    const market = await provider.resolveMarket("50009");

    await expect(provider.getProduct("unknown", market)).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );
    await expect(
      provider.searchProducts("leche", { ...market, retailer: "DIA" }),
    ).rejects.toBeInstanceOf(MarketResolutionError);
  });
});
