import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderContractChangedError,
  ProviderUnavailableError,
  RateLimitedError,
  supportsCatalog,
  supportsSearch,
} from "@shopping-app/retailer-contracts";
import { AlcampoProvider } from "./alcampo-provider.js";
import { AlcampoSessionContext } from "./alcampo-session-context.js";

const OBSERVED_AT = new Date("2026-08-09T09:00:00.000Z");
const REGION = "96ad34dc-8555-4013-b6d7-91cd5bdca3fb";
function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}
function context(): AlcampoSessionContext {
  return new AlcampoSessionContext({
    postalCode: "50009",
    regionId: REGION,
    deliveryDestinationId: "delivery-destination-fixture",
    visitorId: "visitor-fixture",
    cartId: "cart-fixture",
    csrfToken: "csrf-fixture",
    globalSid: "sid-fixture",
  });
}
function json(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
function html(payload: string): Response {
  return new Response(payload, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
function requestUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}
function requestBody(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  index: number,
): string {
  const body = fetchMock.mock.calls[index]?.[1]?.body;
  if (typeof body !== "string")
    throw new Error("Expected a string request body");
  return body;
}

describe("AlcampoProvider", () => {
  it("resuelve 50009 mediante el flujo confirmado y mantiene regionId como identidad inmutable", async () => {
    const responses = [
      html(
        readFileSync(
          new URL("./fixtures/bootstrap-home.html", import.meta.url),
          "utf8",
        ),
      ),
      json(fixture("area-search-50009.json")),
      json(fixture("area-detail-50009.json")),
      json(fixture("temporary-destination.json")),
      json(fixture("delivery-address-50009.json")),
      json(fixture("active-session.json")),
      json(fixture("product-54180.json")),
    ];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(responses.shift()!));
    const provider = new AlcampoProvider({
      fetch: fetchMock,
      environment: {},
      now: () => OBSERVED_AT,
      uuid: () => "00000000-0000-4000-8000-000000000001",
      maxRetries: 0,
    });
    const market = await provider.resolveMarket("50009");
    expect(market).toEqual({
      retailer: "ALCAMPO",
      externalId: REGION,
      postalCode: "50009",
      name: "Alcampo 50009",
      metadata: { regionId: REGION },
    });
    expect(Object.isFrozen(market)).toBe(true);
    await provider.getProduct("54180", market);
    expect(market.externalId).toBe(REGION);
    const temporaryBody = JSON.parse(requestBody(fetchMock, 3)) as Record<
      string,
      unknown
    >;
    expect(temporaryBody).toMatchObject({
      visitorId: "00000000-0000-4000-8000-000000000011",
      latitude: 41.640049,
      longitude: -0.9032769,
      postalCode: "50009",
      formattedAddress: "50009 Zaragoza, España",
    });
    expect(requestBody(fetchMock, 5)).toContain(REGION);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestUrl(input).includes("address-lookup/by-coordinates"),
      ),
    ).toBe(false);
  });

  it("recorre catálogo SSR, deduplica y produce observaciones separadas", async () => {
    const categoryHtml = readFileSync(
      new URL("./fixtures/category-oc1603.html", import.meta.url),
      "utf8",
    );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.includes("categories?"))
        return Promise.resolve(json(fixture("categories.json")));
      if (url.includes("/categories/"))
        return Promise.resolve(html(categoryHtml));
      if (url.includes("/v6/products"))
        return Promise.resolve(
          json({
            products: [
              fixture("product-54180.json"),
              fixture("product-54178-promotion.json"),
            ],
            missedPromotions: [],
            restrictedGroups: [],
          }),
        );
      if (url.includes("54180"))
        return Promise.resolve(json(fixture("product-54180.json")));
      if (url.includes("54178"))
        return Promise.resolve(json(fixture("product-54178-promotion.json")));
      throw new Error(`Unexpected ${url}`);
    });
    const provider = new AlcampoProvider({
      fetch: fetchMock,
      sessionContext: context(),
      now: () => OBSERVED_AT,
      maxRetries: 0,
    });
    const market = await provider.resolveMarket("50009");
    const categories = await provider.getCategories(market);
    const observations = await provider.getProductsByCategory("OC1603", market);
    expect(categories).toEqual([
      { externalId: "OC1603", name: "Leche", level: 1, order: 0 },
    ]);
    expect(observations.products.map((product) => product.externalId)).toEqual([
      "54180",
      "54178",
    ]);
    expect(observations.offers).toHaveLength(2);
    expect(observations.products[0]).not.toHaveProperty("normalPrice");
    expect(observations.products[0]?.productUrl).toContain("/54180");
  });

  it("materializa los 50 productos del ItemList aunque excedan un lote de viewport", async () => {
    const ids = Array.from({ length: 50 }, (_, index) =>
      String(54_000 + index),
    );
    const itemListElement = ids.map((id, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: { url: `/products/producto-${index + 1}/${id}` },
    }));
    const internalByRetailer = new Map(
      ids.map((id, index) => [
        id,
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ]),
    );
    const productEntities = Object.fromEntries(
      [...internalByRetailer].map(([retailerProductId, productId]) => [
        productId,
        { productId, retailerProductId },
      ]),
    );
    const initialState = `<script data-test="initial-state-script">window.__INITIAL_STATE__=${JSON.stringify({ session: { csrf: { token: "csrf" }, metadata: { visitorId: "visitor" } }, data: { products: { productEntities } } })}</script>`;
    const categoryHtml = `${initialState}<script data-test="product-listing-structured-data" type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement })}</script>`;
    let batchRequests = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const url = requestUrl(input);
        if (url.includes("categories?"))
          return Promise.resolve(json(fixture("categories.json")));
        if (url.includes("/categories/"))
          return Promise.resolve(html(categoryHtml));
        if (!url.includes("/v6/products") || typeof init?.body !== "string")
          throw new Error(`Unexpected ${url}`);
        batchRequests += 1;
        const requested = JSON.parse(init.body) as string[];
        const products = requested.map((productId) => {
          const retailerProductId = [...internalByRetailer].find(
            ([, internalId]) => internalId === productId,
          )?.[0];
          if (retailerProductId === undefined)
            throw new Error("Unknown internal product id");
          return {
            ...(fixture("product-54180.json") as Record<string, unknown>),
            productId,
            retailerProductId,
          };
        });
        return Promise.resolve(
          json({ products, missedPromotions: [], restrictedGroups: [] }),
        );
      });
    const provider = new AlcampoProvider({
      fetch: fetchMock,
      sessionContext: context(),
      maxRetries: 0,
      concurrency: 6,
    });
    const market = await provider.resolveMarket("50009");
    const observations = await provider.getProductsByCategory("OC1603", market);
    expect(observations.products).toHaveLength(50);
    expect(observations.offers).toHaveLength(50);
    expect(batchRequests).toBe(3);
  });

  it("getProduct admite IDs numéricos y alfanuméricos y refreshPrices conserva éxitos parciales", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.includes("99999"))
        return Promise.resolve(new Response("missing", { status: 404 }));
      const externalId = url.includes("81299-LONCHA-NORMAL-2-A-3-MM")
        ? "81299-LONCHA-NORMAL-2-A-3-MM"
        : "54180";
      return Promise.resolve(
        json({
          product: {
            ...(fixture("product-54180.json") as Record<string, unknown>),
            retailerProductId: externalId,
          },
        }),
      );
    });
    const provider = new AlcampoProvider({
      fetch: fetchMock,
      sessionContext: context(),
      now: () => OBSERVED_AT,
      maxRetries: 0,
    });
    const market = await provider.resolveMarket("50009");
    await expect(provider.getProduct("54180", market)).resolves.toMatchObject({
      externalId: "54180",
      observedAt: OBSERVED_AT,
    });
    await expect(
      provider.getProduct("81299-LONCHA-NORMAL-2-A-3-MM", market),
    ).resolves.toMatchObject({
      externalId: "81299-LONCHA-NORMAL-2-A-3-MM",
    });
    await expect(
      provider.refreshPrices(["54180", "99999"], market),
    ).resolves.toEqual([
      expect.objectContaining({
        retailerProductId: "54180",
        observedAt: OBSERVED_AT,
      }),
    ]);
    expect(market.externalId).toBe(REGION);
  });

  it("no presenta una observación anterior como resultado de un refresh nuevo", async () => {
    const times = [
      new Date("2026-08-09T09:00:00.000Z"),
      new Date("2026-08-10T09:00:00.000Z"),
    ];
    const provider = new AlcampoProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          Promise.resolve(json(fixture("product-54180.json"))),
        ),
      sessionContext: context(),
      now: () => times.shift() ?? new Date("2026-08-10T09:00:00.000Z"),
      maxRetries: 0,
    });
    const market = await provider.resolveMarket("50009");
    const first = await provider.refreshPrices(["54180"], market);
    const second = await provider.refreshPrices(["54180"], market);
    expect(second[0]?.observedAt.getTime()).toBeGreaterThan(
      first[0]?.observedAt.getTime() ?? 0,
    );
  });

  it("mapea contrato roto, 429 y 5xx", async () => {
    const marketProvider = (response: Response) =>
      new AlcampoProvider({
        fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
        sessionContext: context(),
        maxRetries: 0,
      });
    const invalid = marketProvider(json(fixture("product-invalid.json")));
    await expect(
      invalid.getProduct("70212", await invalid.resolveMarket("50009")),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);
    const limited = marketProvider(
      new Response("limited", { status: 429, headers: { "retry-after": "2" } }),
    );
    await expect(
      limited.getProduct("54180", await limited.resolveMarket("50009")),
    ).rejects.toMatchObject({
      name: "RateLimitedError",
      retryAfterMs: 2000,
    } satisfies Partial<RateLimitedError>);
    const unavailable = marketProvider(
      new Response("failure", { status: 503 }),
    );
    await expect(
      unavailable.getProduct("54180", await unavailable.resolveMarket("50009")),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("declara CATALOG y no finge SEARCH", () => {
    const provider = new AlcampoProvider({ sessionContext: context() });
    expect(supportsCatalog(provider)).toBe(true);
    expect(supportsSearch(provider)).toBe(false);
  });
});
