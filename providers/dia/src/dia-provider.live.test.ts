import { describe, expect, it } from "vitest";

import { DiaProvider } from "./dia-provider.js";

describe.skipIf(process.env.RUN_LIVE_PROVIDER_TESTS !== "true")(
  "DiaProvider live",
  () => {
    it("resuelve 50009 y obtiene 261354", async () => {
      const provider = new DiaProvider({ timeoutMs: 15_000 });
      const market = await provider.resolveMarket("50009");
      const product = await provider.getProduct("261354", market);
      const [offer] = await provider.refreshPrices(["261354"], market);

      expect(market).toMatchObject({
        retailer: "DIA",
        externalId: "postal-code:50009",
        postalCode: "50009",
      });
      expect(product).toMatchObject({
        retailer: "DIA",
        externalId: "261354",
        marketId: "postal-code:50009",
      });
      expect(product.name.toLocaleLowerCase("es-ES")).toContain(
        "solomillos de pollo",
      );
      expect(offer).toMatchObject({
        retailerProductId: "261354",
        marketId: "postal-code:50009",
      });
      expect(typeof offer?.available).toBe("boolean");
      expect(offer?.normalPrice).toBeGreaterThan(0);
    }, 30_000);

    it("busca leche con resultados válidos", async () => {
      const provider = new DiaProvider({ timeoutMs: 15_000 });
      const market = await provider.resolveMarket("50009");
      const { products, offers } = await provider.searchProducts(
        "leche",
        market,
      );

      expect(products.length).toBeGreaterThan(0);
      expect(offers.length).toBeGreaterThan(0);
      for (const product of products) {
        expect(product.externalId.trim()).not.toBe("");
        expect(product.name.trim()).not.toBe("");
        expect(product.retailer).toBe("DIA");
      }
    }, 30_000);

    it("recorre la categoría de leche confirmada", async () => {
      const provider = new DiaProvider({ timeoutMs: 15_000 });
      const market = await provider.resolveMarket("50009");
      const categories = await provider.getCategories(market);
      expect(
        categories.find((category) => category.externalId === "L2051"),
      ).toMatchObject({ name: "Leche" });

      const { products, offers } = await provider.getProductsByCategory(
        "L2051",
        market,
      );
      expect(products.length).toBeGreaterThan(0);
      expect(offers.length).toBeGreaterThan(0);
      expect(
        products.every(
          (product) =>
            product.retailer === "DIA" &&
            product.marketId === "postal-code:50009",
        ),
      ).toBe(true);
    }, 60_000);
  },
);
