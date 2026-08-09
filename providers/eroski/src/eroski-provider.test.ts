import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  MarketResolutionError,
  ProductNotFoundError,
  ProviderCapabilityUnavailableError,
  ProviderContractChangedError,
  RateLimitedError,
} from "@shopping-app/retailer-contracts";

import { EroskiProvider } from "./eroski-provider.js";

const PRODUCT_URL =
  "https://supermercado.eroski.es/es/productdetail/18631259-solomillo-de-pavo-al-vacio-eroski-bipack-sobre-al-peso-aprox-750-g/";
const OBSERVED_AT = new Date("2026-08-09T12:00:00.000Z");
const MARKET = {
  retailer: "EROSKI",
  externalId: "shop-ref:sanitized-shop-001",
  postalCode: "unknown",
  metadata: { shopRef: "sanitized-shop-001" },
} as const;

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("EroskiProvider", () => {
  it("obtiene producto y refresca su oferta desde la URL pública confirmada", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(htmlResponse(fixture("product-18631259.html"))),
      );
    const provider = new EroskiProvider({
      fetch: fetchMock,
      now: () => OBSERVED_AT,
    });

    const product = await provider.getProduct(" 18631259 ", MARKET);
    const offers = await provider.refreshPrices(["18631259"], MARKET);

    expect(product).toMatchObject({
      retailer: "EROSKI",
      externalId: "18631259",
      marketId: MARKET.externalId,
    });
    expect(offers).toEqual([
      expect.objectContaining({
        retailerProductId: "18631259",
        normalPrice: 6,
        pricePerUnit: 8,
        marketId: MARKET.externalId,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[0] as URL).href).toBe(PRODUCT_URL);
  });

  it("declara mercado y búsqueda como capacidades no disponibles", async () => {
    const provider = new EroskiProvider({ fetch: vi.fn<typeof fetch>() });
    await expect(provider.resolveMarket("50009")).rejects.toBeInstanceOf(
      ProviderCapabilityUnavailableError,
    );
    await expect(
      provider.searchProducts("pavo", MARKET),
    ).rejects.toBeInstanceOf(ProviderCapabilityUnavailableError);
  });

  it("no inventa una URL para ids cuyo slug canónico no está confirmado", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new EroskiProvider({ fetch: fetchMock });
    await expect(provider.getProduct("999", MARKET)).rejects.toMatchObject({
      name: "ProviderCapabilityUnavailableError",
      capability: "productUrlResolution",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detecta cambios de estructura y un shopRef incompatible", async () => {
    const changed = new EroskiProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          htmlResponse(fixture("product-structure-changed.html")),
        ),
    });
    await expect(changed.getProduct("18631259", MARKET)).rejects.toBeInstanceOf(
      ProviderContractChangedError,
    );

    const valid = new EroskiProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(htmlResponse(fixture("product-18631259.html"))),
    });
    await expect(
      valid.getProduct("18631259", {
        ...MARKET,
        externalId: "shop-ref:other",
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(MarketResolutionError);
  });

  it("mapea 404 y 429 a los errores tipados existentes", async () => {
    const notFound = new EroskiProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(htmlResponse("missing", 404)),
    });
    await expect(
      notFound.getProduct("18631259", MARKET),
    ).rejects.toBeInstanceOf(ProductNotFoundError);

    const limited = new EroskiProvider({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "2", "content-type": "text/html" },
        }),
      ),
    });
    const error = await limited
      .getProduct("18631259", MARKET)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(2_000);
  });

  it("rechaza mercados de otro retailer antes de consultar", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new EroskiProvider({ fetch: fetchMock });
    await expect(
      provider.getProduct("18631259", {
        retailer: "DIA",
        externalId: "shop-ref:sanitized-shop-001",
        postalCode: "unknown",
      }),
    ).rejects.toBeInstanceOf(MarketResolutionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
