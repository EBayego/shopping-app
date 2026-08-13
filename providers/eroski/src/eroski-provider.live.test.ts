import { describe, expect, it } from "vitest";

import { EroskiProvider } from "./eroski-provider.js";

describe.skipIf(process.env.RUN_LIVE_PROVIDER_TESTS !== "true")(
  "Eroski public provider live",
  () => {
    it("resuelve el mercado público y obtiene el detalle por id", async () => {
      const provider = new EroskiProvider({ timeoutMs: 20_000 });
      const market = await provider.resolveMarket("50009");
      const product = await provider.getProduct("18631259", market);
      const [offer] = await provider.refreshPrices(["18631259"], market);

      expect(market.metadata).toMatchObject({ shopRef: "157" });
      expect(product.externalId).toBe("18631259");
      expect(product.name.toLocaleLowerCase("es-ES")).toContain(
        "solomillo de pavo",
      );
      expect(offer?.normalPrice).toBeGreaterThan(0);
    }, 45_000);

    it("obtiene categorías y productos de una categoría pública", async () => {
      const provider = new EroskiProvider({ timeoutMs: 20_000 });
      const market = await provider.resolveMarket("50009");
      const categories = await provider.getCategories(market);
      const butter = categories.find(
        (category) => category.externalId === "2059851",
      );
      expect(butter?.name.toLocaleLowerCase("es-ES")).toContain("mantequilla");
      const result = await provider.getProductsByCategory("2059851", market);
      expect(result.products.length).toBeGreaterThan(0);
      expect(result.offers).toHaveLength(result.products.length);
    }, 60_000);

    it("busca y conserva promociones y pesos variables", async () => {
      const provider = new EroskiProvider({ timeoutMs: 20_000 });
      const market = await provider.resolveMarket("50009");
      const search = await provider.searchProducts("leche", market);
      expect(search.products.length).toBeGreaterThan(0);
      expect(
        search.products.some((product) =>
          product.name.toLocaleLowerCase("es-ES").includes("leche"),
        ),
      ).toBe(true);

      const variableProducts = await Promise.all([
        provider.getProduct("8475048", market),
        provider.getProduct("26794016", market),
      ]);
      expect(variableProducts.every((product) => product.variableWeight)).toBe(
        true,
      );
      const offers = await provider.refreshPrices(
        ["18631259", "8475048", "26794016"],
        market,
      );
      expect(offers).toHaveLength(3);
      expect(offers.every((offer) => offer.normalPrice > 0)).toBe(true);
      expect(offers.every((offer) => offer.referenceUnit === "kg")).toBe(true);
    }, 60_000);
  },
);
