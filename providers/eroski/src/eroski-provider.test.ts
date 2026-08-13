import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  MarketResolutionError,
  ProductNotFoundError,
  ProviderContractChangedError,
  RateLimitedError,
  supportsCatalog,
  supportsSearch,
} from "@shopping-app/retailer-contracts";

import { EroskiProvider } from "./eroski-provider.js";

const OBSERVED_AT = new Date("2026-08-09T12:00:00.000Z");
const BOOTSTRAP_COOKIES =
  "supermarket.ali.shop=157; Path=/, supermarket.ali.shopName=Bilbondo; Path=/, JSESSIONID=session; Path=/";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function publicProductFixture(): string {
  return fixture("product-18631259.html").replaceAll(
    "sanitized-shop-001",
    "157",
  );
}

function htmlResponse(
  html: string,
  status = 200,
  setCookie?: string,
): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(setCookie === undefined ? {} : { "set-cookie": setCookie }),
    },
  });
}

describe("EroskiProvider", () => {
  it("resuelve la tienda pública y refresca un producto por su id", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        htmlResponse("<!doctype html><nav></nav>", 200, BOOTSTRAP_COOKIES),
      )
      .mockResolvedValueOnce(htmlResponse(publicProductFixture()))
      .mockResolvedValueOnce(htmlResponse(publicProductFixture()));
    const provider = new EroskiProvider({
      fetch: fetchMock,
      now: () => OBSERVED_AT,
    });
    const market = await provider.resolveMarket("50009");
    const product = await provider.getProduct(" 18631259 ", market);
    const offers = await provider.refreshPrices(["18631259"], market);

    expect(market).toMatchObject({
      externalId: "shop-ref:157",
      name: "Eroski Bilbondo",
      postalCode: "50009",
      metadata: {
        shopRef: "157",
        marketResolution: "public-default",
        pricesMayVaryByLocation: true,
      },
    });
    expect(product).toMatchObject({
      retailer: "EROSKI",
      externalId: "18631259",
      marketId: market.externalId,
    });
    expect(offers).toEqual([
      expect.objectContaining({
        retailerProductId: "18631259",
        normalPrice: 6,
        pricePerUnit: 8,
        marketId: market.externalId,
      }),
    ]);
    expect((fetchMock.mock.calls[1]?.[0] as URL).pathname).toBe(
      "/es/productdetail/18631259-x/",
    );
  });

  it("expone catálogo y búsqueda confirmados", () => {
    const provider = new EroskiProvider({ fetch: vi.fn<typeof fetch>() });
    expect(supportsSearch(provider)).toBe(true);
    expect(supportsCatalog(provider)).toBe(true);
  });

  it("detecta cambios de estructura y mercados incompatibles", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        htmlResponse("<!doctype html><nav></nav>", 200, BOOTSTRAP_COOKIES),
      )
      .mockResolvedValueOnce(
        htmlResponse(fixture("product-structure-changed.html")),
      );
    const provider = new EroskiProvider({ fetch: fetchMock });
    const market = await provider.resolveMarket("50009");
    await expect(
      provider.getProduct("18631259", market),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);
    await expect(
      provider.getProduct("18631259", { ...market, retailer: "DIA" }),
    ).rejects.toBeInstanceOf(MarketResolutionError);
  });

  it("mapea 404 y 429 a los errores tipados existentes", async () => {
    const notFoundFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        htmlResponse("<!doctype html>", 200, BOOTSTRAP_COOKIES),
      )
      .mockResolvedValueOnce(htmlResponse("missing", 404));
    const notFound = new EroskiProvider({ fetch: notFoundFetch });
    const market = await notFound.resolveMarket("50009");
    await expect(
      notFound.getProduct("18631259", market),
    ).rejects.toBeInstanceOf(ProductNotFoundError);

    const limitedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        htmlResponse("<!doctype html>", 200, BOOTSTRAP_COOKIES),
      )
      .mockResolvedValueOnce(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "2", "content-type": "text/html" },
        }),
      );
    const limited = new EroskiProvider({ fetch: limitedFetch });
    const limitedMarket = await limited.resolveMarket("50009");
    const error = await limited
      .getProduct("18631259", limitedMarket)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(2_000);
  });

  it("rechaza identificadores y mercados no pertenecientes a esta instancia", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        htmlResponse("<!doctype html>", 200, BOOTSTRAP_COOKIES),
      );
    const provider = new EroskiProvider({ fetch: fetchMock });
    const market = await provider.resolveMarket("50009");
    await expect(provider.getProduct("invalid", market)).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );
    await expect(
      new EroskiProvider({ fetch: fetchMock }).getProduct("1", market),
    ).rejects.toBeInstanceOf(MarketResolutionError);
  });
});
