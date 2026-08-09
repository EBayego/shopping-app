import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  ProviderContractChangedError,
  ProviderUnavailableError,
  RateLimitedError,
} from "@shopping-app/retailer-contracts";

import { DiaProvider } from "./dia-provider.js";

const SEARCH_FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL("./fixtures/search-leche-page-1.json", import.meta.url),
    "utf8",
  ),
);
const INVALID_FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL("./fixtures/search-invalid.json", import.meta.url),
    "utf8",
  ),
);
const PRODUCT_FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL("./fixtures/product-261354.json", import.meta.url),
    "utf8",
  ),
);

const INITIAL_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CART_ID = "22222222-2222-4222-8222-222222222222";
const DEFINITIVE_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const OBSERVED_AT = new Date("2026-08-08T12:00:00.000Z");

function marketResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { session_id: DEFINITIVE_SESSION_ID },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider(fetchMock: typeof fetch): DiaProvider {
  const ids = [CART_ID, INITIAL_SESSION_ID];
  return new DiaProvider({
    fetch: fetchMock,
    createId: () => {
      const id = ids.shift();
      if (id === undefined) throw new Error("Unexpected UUID request");
      return id;
    },
    now: () => OBSERVED_AT,
  });
}

describe("DiaProvider search", () => {
  it("busca leche y separa productos de ofertas", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(SEARCH_FIXTURE));
    const provider = createProvider(fetchMock);
    const market = await provider.resolveMarket("50009");

    const products = await provider.searchProducts("leche", market);

    expect(products).toHaveLength(5);
    expect(products[0]).toEqual({
      retailer: "DIA",
      externalId: "504P6",
      name: "Leche semidesnatada Dia Láctea pack 6 x 1 L",
      brand: "DIA Láctea",
      packageSize: 1,
      packageUnit: "l",
      packageCount: 6,
      totalAmount: 6,
      variableWeight: false,
      category: "Huevos, leche y mantequilla",
      subcategory: "Leche",
      imageUrl: "https://www.dia.es/product_images/504P6.jpg",
      productUrl: "https://www.dia.es/huevos-leche-y-mantequilla/leche/p/504P6",
      marketId: "postal-code:50009",
      observedAt: OBSERVED_AT,
    });
    expect(products[1]?.externalId).toBe("LACTOSA1L");
    expect(products[1]?.name).toContain("sin lactosa");
    expect(products[1]?.imageUrl).toBe(
      "https://www.dia.es/product_images/LACTOSA1L.jpg",
    );
    expect(products[1]?.productUrl).toBe(
      "https://www.dia.es/huevos-leche-y-mantequilla/leche-sin-lactosa-y-enriquecidas/p/LACTOSA1L",
    );
    expect(products[0]).not.toHaveProperty("normalPrice");

    const searchCall = fetchMock.mock.calls[1];
    expect(searchCall?.[0]).toBeInstanceOf(URL);
    expect((searchCall?.[0] as URL).href).toBe(
      "https://www.dia.es/api/v1/search-back/search/reduced?q=leche&page=1",
    );
    const headers = new Headers(searchCall?.[1]?.headers);
    expect(headers.get("cart_id")).toBe(CART_ID);
    expect(headers.get("session_id")).toBe(DEFINITIVE_SESSION_ID);
    expect(headers.get("cookie")).toBe(`session_id=${DEFINITIVE_SESSION_ID}`);
  });

  it("devuelve paginación y ofertas, incluyendo falta de stock y promo", async () => {
    const provider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(jsonResponse(SEARCH_FIXTURE)),
    );
    const market = await provider.resolveMarket("50009");

    const page = await provider.searchProductsPage("leche", market, 1);

    expect(page.pagination).toEqual({
      pageNumber: 1,
      pageSize: 30,
      totalPages: 14,
      totalItems: 410,
    });
    expect(page.offers).toHaveLength(3);
    expect(
      page.offers.find((offer) => offer.retailerProductId === "SIN-STOCK"),
    ).toMatchObject({ normalPrice: 0.95, available: false });
    expect(
      page.offers.find((offer) => offer.retailerProductId === "PROMO3L"),
    ).toMatchObject({
      normalPrice: 2.4,
      promoPrice: 1.8,
      promotionType: "fixed-price",
      available: true,
    });
    expect(
      page.offers.some((offer) => offer.retailerProductId === "LACTOSA1L"),
    ).toBe(false);
    expect(
      page.offers.some((offer) => offer.retailerProductId === "STOCK-UNKNOWN"),
    ).toBe(false);
  });

  it("codifica espacios, acentos y caracteres especiales y permite otra página", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          cart: { postal_code: "50009" },
          pagination: { page_number: 2, page_size: 30, total_pages: 2 },
          total_items: 31,
          search_items: [],
        }),
      );
    const provider = createProvider(fetchMock);
    const market = await provider.resolveMarket("50009");

    await provider.searchProductsPage("leche sin lactosa & café", market, 2);

    expect((fetchMock.mock.calls[1]?.[0] as URL).href).toBe(
      "https://www.dia.es/api/v1/search-back/search/reduced?q=leche+sin+lactosa+%26+caf%C3%A9&page=2",
    );
  });

  it("rechaza respuestas incompatibles", async () => {
    const provider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(jsonResponse(INVALID_FIXTURE)),
    );
    const market = await provider.resolveMarket("50009");
    await expect(
      provider.searchProducts("leche", market),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);
  });

  it("acepta search_items ausente cuando no hay resultados", async () => {
    const provider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(
          jsonResponse({
            pagination: { page_number: 1, page_size: 30, total_pages: 0 },
            total_items: 0,
          }),
        ),
    );
    const market = await provider.resolveMarket("50009");
    await expect(
      provider.searchProducts("inexistente", market),
    ).resolves.toEqual([]);
  });

  it("mapea HTTP 429 y 5xx a errores tipados", async () => {
    const limitedProvider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(new Response("limited", { status: 429 })),
    );
    const limitedMarket = await limitedProvider.resolveMarket("50009");
    await expect(
      limitedProvider.searchProducts("leche", limitedMarket),
    ).rejects.toBeInstanceOf(RateLimitedError);

    const unavailableProvider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 })),
    );
    const unavailableMarket = await unavailableProvider.resolveMarket("50009");
    await expect(
      unavailableProvider.searchProducts("leche", unavailableMarket),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("mantiene inmutable la identidad de mercado durante todo el flujo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(SEARCH_FIXTURE))
      .mockResolvedValueOnce(jsonResponse(PRODUCT_FIXTURE))
      .mockResolvedValueOnce(jsonResponse(SEARCH_FIXTURE))
      .mockResolvedValueOnce(jsonResponse(PRODUCT_FIXTURE));
    const provider = createProvider(fetchMock);

    const market = await provider.resolveMarket("50009");
    const marketId = market.externalId;
    const firstSearch = await provider.searchProducts("leche", market);
    expect(market.externalId).toBe(marketId);
    const product = await provider.getProduct("261354", market);
    expect(market.externalId).toBe(marketId);
    const secondSearch = await provider.searchProducts("leche", market);
    expect(market.externalId).toBe(marketId);
    const offers = await provider.refreshPrices(["261354"], market);

    expect(marketId).toBe("postal-code:50009");
    expect(
      [...firstSearch, product, ...secondSearch].every(
        (candidate) => candidate.marketId === marketId,
      ),
    ).toBe(true);
    expect(offers.every((offer) => offer.marketId === marketId)).toBe(true);
    expect(market.externalId).toBe(marketId);
  });
});
