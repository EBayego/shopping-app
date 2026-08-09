import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProductNotFoundError,
  ProviderContractChangedError,
  ProviderUnavailableError,
  RateLimitedError,
} from "@shopping-app/retailer-contracts";

import { DiaProvider } from "./dia-provider.js";

const PRODUCT_FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL("./fixtures/product-261354.json", import.meta.url),
    "utf8",
  ),
);
const INCOMPATIBLE_FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL("./fixtures/product-incompatible.json", import.meta.url),
    "utf8",
  ),
);

const INITIAL_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CART_ID = "22222222-2222-4222-8222-222222222222";
const DEFINITIVE_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const OBSERVED_AT = new Date("2026-08-08T12:00:00.000Z");

function marketResponse(
  headers: Record<string, string> = {
    session_id: DEFINITIVE_SESSION_ID,
  },
): Response {
  return new Response(null, { status: 204, headers });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider(
  fetchMock: typeof fetch,
  now: () => Date = () => OBSERVED_AT,
): DiaProvider {
  const ids = [CART_ID, INITIAL_SESSION_ID];
  return new DiaProvider({
    fetch: fetchMock,
    createId: () => {
      const id = ids.shift();
      if (id === undefined) throw new Error("Unexpected UUID request");
      return id;
    },
    now,
  });
}

function productAnalytics(price: number): unknown {
  return {
    initial_datalayer: { shop_id: "3423" },
    page_product_analytics: {
      "261354": {
        item_id: "261354",
        item_name: "solomillos de pollo seleccion de dia 550 g aprox",
        price,
        stock_availability: true,
      },
    },
  };
}

describe("DiaProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resuelve el mercado y usa el session_id definitivo en producto", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(PRODUCT_FIXTURE));
    const provider = createProvider(fetchMock);

    const market = await provider.resolveMarket(" 50009 ");
    const product = await provider.getProduct("261354", market);

    expect(Object.isFrozen(market)).toBe(true);
    expect(market).toEqual({
      retailer: "DIA",
      externalId: "postal-code:50009",
      postalCode: "50009",
      name: "DIA 50009",
    });
    expect(product).toEqual({
      retailer: "DIA",
      externalId: "261354",
      name: "solomillos de pollo seleccion de dia 550 g aprox",
      packageSize: 550,
      packageUnit: "g",
      variableWeight: true,
      marketId: "postal-code:50009",
      observedAt: OBSERVED_AT,
    });

    const marketCall = fetchMock.mock.calls[0];
    expect(marketCall?.[0]).toBeInstanceOf(URL);
    expect((marketCall?.[0] as URL).href).toBe(
      "https://www.dia.es/api/v1/common-aggregator/save-shipping-address?new_postal_code=50009&skip_dry_run=true",
    );
    expect(marketCall?.[1]).toMatchObject({ method: "PUT", body: "null" });
    expect(new Headers(marketCall?.[1]?.headers).get("cart_id")).toBe(CART_ID);
    expect(new Headers(marketCall?.[1]?.headers).get("session_id")).toBe(
      INITIAL_SESSION_ID,
    );

    const productCall = fetchMock.mock.calls[1];
    expect(productCall?.[0]).toBeInstanceOf(URL);
    expect((productCall?.[0] as URL).href).toBe(
      "https://www.dia.es/api/v1/pdp-insight/initial_analytics/261354",
    );
    expect(new Headers(productCall?.[1]?.headers).get("session_id")).toBe(
      DEFINITIVE_SESSION_ID,
    );
    expect(new Headers(productCall?.[1]?.headers).get("cookie")).toBe(
      `session_id=${DEFINITIVE_SESSION_ID}`,
    );
  });

  it("refreshPrices obtiene un precio fresco y lo fecha tras recibirlo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(productAnalytics(3.82)))
      .mockResolvedValueOnce(jsonResponse(productAnalytics(4.15)));
    const firstObservedAt = new Date("2026-08-08T10:00:00.000Z");
    const refreshedAt = new Date("2026-08-08T18:00:00.000Z");
    const observationTimes = [firstObservedAt, refreshedAt];
    const provider = createProvider(fetchMock, () => {
      const observedAt = observationTimes.shift();
      if (observedAt === undefined) throw new Error("Unexpected clock read");
      return observedAt;
    });
    const market = await provider.resolveMarket("50009");

    const product = await provider.getProduct("261354", market);
    await expect(provider.refreshPrices(["261354"], market)).resolves.toEqual([
      {
        retailerProductId: "261354",
        marketId: "postal-code:50009",
        normalPrice: 4.15,
        requiresMembership: false,
        available: true,
        observedAt: refreshedAt,
      },
    ]);
    expect(product.observedAt).toEqual(firstObservedAt);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("acepta como autoritativa una sesión devuelta sin rotación", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse({ session_id: INITIAL_SESSION_ID }))
      .mockResolvedValueOnce(jsonResponse(PRODUCT_FIXTURE));
    const provider = createProvider(fetchMock);

    const market = await provider.resolveMarket("50009");
    await provider.getProduct("261354", market);

    const productHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(productHeaders.get("session_id")).toBe(INITIAL_SESSION_ID);
    expect(productHeaders.get("cookie")).toBe(
      `session_id=${INITIAL_SESSION_ID}`,
    );
  });

  it("rechaza respuestas de mercado o producto incompatibles", async () => {
    const missingHeadersProvider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(marketResponse({ shop_id: "3423" })),
    );
    await expect(
      missingHeadersProvider.resolveMarket("50009"),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);

    const invalidProductProvider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(jsonResponse(INCOMPATIBLE_FIXTURE)),
    );
    const market = await invalidProductProvider.resolveMarket("50009");
    await expect(
      invalidProductProvider.getProduct("261354", market),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);
  });

  it("mapea 404 y 429 a los errores tipados existentes", async () => {
    const notFoundProvider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(jsonResponse({}, 404)),
    );
    const notFoundMarket = await notFoundProvider.resolveMarket("50009");
    await expect(
      notFoundProvider.getProduct("missing", notFoundMarket),
    ).rejects.toBeInstanceOf(ProductNotFoundError);

    const limitedProvider = createProvider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(marketResponse())
        .mockResolvedValueOnce(
          new Response("limited", {
            status: 429,
            headers: { "retry-after": "3" },
          }),
        ),
    );
    const limitedMarket = await limitedProvider.resolveMarket("50009");
    const error = await limitedProvider
      .getProduct("261354", limitedMarket)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(3_000);
  });

  it("aborta por timeout y lo expone como indisponibilidad", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const provider = new DiaProvider({
      fetch: fetchMock,
      timeoutMs: 5,
      createId: () => crypto.randomUUID(),
    });
    await expect(provider.resolveMarket("50009")).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("valida query y página antes de buscar", async () => {
    const provider = createProvider(vi.fn<typeof fetch>());
    const market = {
      retailer: "DIA" as const,
      externalId: "3423",
      postalCode: "50009",
    };
    await expect(provider.searchProducts("   ", market)).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(
      provider.searchProductsPage("leche", market, 0),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
