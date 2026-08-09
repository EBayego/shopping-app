import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  ProductNotFoundError,
  ProviderCapabilityUnavailableError,
  ProviderContractChangedError,
  RateLimitedError,
  supportsCatalog,
} from "@shopping-app/retailer-contracts";

import { MercadonaProvider } from "./mercadona-provider.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function marketResponse(): Response {
  return jsonResponse({ warehouse_changed: false }, 200, {
    "x-customer-wh": "4491",
    "x-customer-pc": "50009",
  });
}

const OBSERVED_AT = new Date("2026-08-09T09:00:00.000Z");

function productFixtureWithPrice(price: number): unknown {
  const product = fixture("product-10382.json") as Record<string, unknown>;
  const priceInstructions = product.price_instructions as Record<
    string,
    unknown
  >;
  return {
    ...product,
    price_instructions: {
      ...priceInstructions,
      unit_price: price.toFixed(2),
    },
  };
}

describe("MercadonaProvider", () => {
  it("resuelve un mercado inmutable y conserva el warehouse en el contexto", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(fixture("product-10382.json")));
    const provider = new MercadonaProvider({
      fetch: fetchMock,
      now: () => OBSERVED_AT,
    });

    const market = await provider.resolveMarket(" 50009 ");
    const product = await provider.getProduct("10382", market);

    expect(market.externalId).toBe("warehouse:4491");
    expect(Object.isFrozen(market)).toBe(true);
    expect(product.marketId).toBe("warehouse:4491");
    expect((fetchMock.mock.calls[0]?.[0] as URL).href).toBe(
      "https://tienda.mercadona.es/api/postal-codes/actions/change-pc/",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ new_postal_code: "50009" }),
    );
    const productHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(productHeaders.get("x-customer-wh")).toBe("4491");
    expect(productHeaders.get("x-customer-pc")).toBe("50009");
    expect(Object.fromEntries(productHeaders.entries())).toEqual({
      accept: "application/json",
      "x-customer-pc": "50009",
      "x-customer-wh": "4491",
    });
    expect(supportsCatalog(provider)).toBe(true);
  });

  it("obtiene categorías y productos/ofertas por categoría", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(fixture("categories.json")))
      .mockResolvedValueOnce(jsonResponse(fixture("category-72.json")));
    const provider = new MercadonaProvider({
      fetch: fetchMock,
      now: () => OBSERVED_AT,
    });
    const market = await provider.resolveMarket("50009");

    await expect(provider.getCategories(market)).resolves.toEqual([
      {
        externalId: "6",
        name: "Huevos, leche y mantequilla",
        level: 0,
        order: 373,
      },
      {
        externalId: "72",
        name: "Leche y bebidas vegetales",
        parentExternalId: "6",
        level: 1,
        order: 373,
      },
    ]);
    const result = await provider.getProductsByCategory("72", market);
    expect(result.products[0]).toMatchObject({
      externalId: "10382",
      category: "Leche y bebidas vegetales",
      subcategory: "Leche semidesnatada",
    });
    expect(result.offers[0]).toMatchObject({
      retailerProductId: "10382",
      normalPrice: 0.84,
    });
    expect(
      result.products.every(
        (product) => product.marketId === market.externalId,
      ),
    ).toBe(true);
    expect(
      result.offers.every((offer) => offer.marketId === market.externalId),
    ).toBe(true);
    expect(result.offers).toHaveLength(result.products.length);
    expect(market.externalId).toBe("warehouse:4491");
  });

  it("refreshPrices vuelve a consultar el producto y fecha la respuesta fresca", async () => {
    const firstObservedAt = new Date("2026-08-09T09:00:00.000Z");
    const refreshedAt = new Date("2026-08-09T10:00:00.000Z");
    const observationTimes = [firstObservedAt, refreshedAt];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(productFixtureWithPrice(0.84)))
      .mockResolvedValueOnce(jsonResponse(productFixtureWithPrice(0.89)));
    const provider = new MercadonaProvider({
      fetch: fetchMock,
      now: () => {
        const value = observationTimes.shift();
        if (value === undefined) throw new Error("Unexpected clock read");
        return value;
      },
    });
    const market = await provider.resolveMarket("50009");

    const product = await provider.getProduct("10382", market);
    const offers = await provider.refreshPrices(["10382"], market);

    expect(product.observedAt).toEqual(firstObservedAt);
    expect(offers).toEqual([
      expect.objectContaining({
        retailerProductId: "10382",
        marketId: market.externalId,
        normalPrice: 0.89,
        observedAt: refreshedAt,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[1]?.[0] as URL).href).toBe(
      (fetchMock.mock.calls[2]?.[0] as URL).href,
    );
  });

  it("deja searchProducts explícitamente pendiente", async () => {
    const provider = new MercadonaProvider({ fetch: vi.fn<typeof fetch>() });
    await expect(
      provider.searchProducts("leche", {
        retailer: "MERCADONA",
        externalId: "warehouse:4491",
        postalCode: "50009",
      }),
    ).rejects.toBeInstanceOf(ProviderCapabilityUnavailableError);
  });

  it("detecta cambios de contrato y mapea 404", async () => {
    const invalidProvider = new MercadonaProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(jsonResponse(fixture("invalid-product.json"))),
    });
    const market = await invalidProvider.resolveMarket("50009");
    await expect(
      invalidProvider.getProduct("10382", market),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);

    const missingProvider = new MercadonaProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(jsonResponse({ errors: [] }, 404)),
      maxRetries: 0,
    });
    const missingMarket = await missingProvider.resolveMarket("50009");
    await expect(
      missingProvider.getProduct("missing", missingMarket),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it("reintenta 5xx con backoff y expone 429 tras agotar retries", async () => {
    const sleep = vi
      .fn<(milliseconds: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    const retryingFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(marketResponse());
    const provider = new MercadonaProvider({
      fetch: retryingFetch,
      sleep,
      random: () => 0.5,
      retryBaseDelayMs: 10,
    });
    await provider.resolveMarket("50009");
    expect(sleep).toHaveBeenCalledWith(10);

    const limitedProvider = new MercadonaProvider({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      ),
      sleep,
      maxRetries: 1,
    });
    const error = await limitedProvider
      .resolveMarket("50009")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(2_000);
  });
});
