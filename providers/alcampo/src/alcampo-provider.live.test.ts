import { describe, expect, it } from "vitest";

import { ProductNotFoundError } from "@shopping-app/retailer-contracts";

import { AlcampoProvider } from "./alcampo-provider.js";

const diagnosticFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.ok) {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const sanitized = (await response.clone().text())
      .slice(0, 1_000)
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "<UUID>",
      )
      .replace(/[A-Za-z0-9_+/=-]{48,}/g, "<REDACTED>");
    console.error(
      JSON.stringify({
        event: "alcampo.live_http_error",
        method: init?.method ?? "GET",
        path: url.pathname,
        status: response.status,
        response: sanitized,
        requestHeaderNames: [...new Headers(init?.headers).keys()],
        cookieNames: (new Headers(init?.headers).get("cookie") ?? "")
          .split(";")
          .map((cookie) => cookie.split("=", 1)[0]?.trim())
          .filter(Boolean),
      }),
    );
  }
  return response;
};

describe.skipIf(process.env.RUN_LIVE_PROVIDER_TESTS !== "true")(
  "AlcampoProvider live desde Node limpio",
  () => {
    it("resuelve 50009 y recorre OC1603 sin contexto copiado", async () => {
      const provider = new AlcampoProvider({
        environment: {},
        timeoutMs: 15_000,
        fetch: diagnosticFetch,
      });
      const market = await provider.resolveMarket("50009");
      const category = await provider.getProductsByCategory("OC1603", market);
      const product = await provider.getProduct("54180", market);
      const [offer] = await provider.refreshPrices(["54180"], market);

      expect(market.externalId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(category.products.length).toBeGreaterThan(0);
      expect(
        category.products.some((candidate) =>
          /^\d+$/.test(candidate.externalId),
        ),
      ).toBe(true);
      expect(product).toMatchObject({
        retailer: "ALCAMPO",
        externalId: "54180",
        variableWeight: false,
      });
      expect(product.name.length).toBeGreaterThan(0);
      expect(offer?.normalPrice).toBeGreaterThan(0);
      expect(typeof offer?.available).toBe("boolean");
    }, 120_000);

    it("comprueba CATCHWEIGHT si el SKU 70212 continúa publicado", async () => {
      const provider = new AlcampoProvider({
        environment: {},
        timeoutMs: 15_000,
        fetch: diagnosticFetch,
      });
      const market = await provider.resolveMarket("50009");
      try {
        const product = await provider.getProduct("70212", market);
        expect(product.variableWeight).toBe(true);
      } catch (error) {
        if (!(error instanceof ProductNotFoundError)) throw error;
      }
    }, 60_000);
  },
);
