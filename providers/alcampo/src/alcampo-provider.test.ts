import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  ProviderCapabilityUnavailableError,
  ProviderContractChangedError,
  ProviderUnavailableError,
  supportsSearch,
} from "@shopping-app/retailer-contracts";

import { AlcampoProvider } from "./alcampo-provider.js";
import { AlcampoSessionContext } from "./alcampo-session-context.js";

const OBSERVED_AT = new Date("2026-08-09T09:00:00.000Z");

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

function context(): AlcampoSessionContext {
  return new AlcampoSessionContext({
    globalSid: "sid-test",
    awsWafToken: "waf-test",
    csrfToken: "csrf-test",
    marketExternalId: "configured:test",
    postalCode: "50009",
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AlcampoProvider", () => {
  it("mantiene deshabilitadas las requests live sin contexto legítimo explícito", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new AlcampoProvider({ fetch: fetchMock, environment: {} });
    await expect(
      provider.getProduct("70212", {
        retailer: "ALCAMPO",
        externalId: "configured:test",
        postalCode: "50009",
      }),
    ).rejects.toBeInstanceOf(ProviderCapabilityUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("consulta únicamente el endpoint confirmado con el contexto suministrado", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(fixture("product-70212.json"))),
      );
    const provider = new AlcampoProvider({
      fetch: fetchMock,
      sessionContext: context(),
      now: () => OBSERVED_AT,
    });
    const market = provider.configuredMarket();
    const product = await provider.getProduct(" 70212 ", market);
    const offers = await provider.refreshPrices(["70212"], market);
    expect(product).toMatchObject({
      externalId: "70212",
      variableWeight: true,
    });
    expect(offers[0]).toMatchObject({ normalPrice: 4.78, pricePerUnit: 11.95 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[0] as URL).href).toBe(
      "https://www.compraonline.alcampo.es/api/webproductpagews/v5/products/bop?retailerProductId=70212",
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-csrf-token")).toBe("csrf-test");
    expect(headers.get("cookie")).toBe(
      "global_sid=sid-test; aws-waf-token=waf-test",
    );
  });

  it("no finge SEARCH y declara resolución de mercado no disponible", async () => {
    const provider = new AlcampoProvider({ sessionContext: context() });
    await expect(provider.resolveMarket("50009")).rejects.toBeInstanceOf(
      ProviderCapabilityUnavailableError,
    );
    expect(supportsSearch(provider)).toBe(false);
  });

  it("mapea 403 sin reintentar y detecta respuestas incompatibles", async () => {
    const forbiddenFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const forbidden = new AlcampoProvider({
      fetch: forbiddenFetch,
      sessionContext: context(),
    });
    await expect(
      forbidden.getProduct("70212", forbidden.configuredMarket()),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(forbiddenFetch).toHaveBeenCalledTimes(1);

    const invalid = new AlcampoProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(fixture("product-invalid.json"))),
      sessionContext: context(),
    });
    await expect(
      invalid.getProduct("70212", invalid.configuredMarket()),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);
  });
});
