import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  ProviderContractChangedError,
  supportsCatalog,
} from "@shopping-app/retailer-contracts";

import { parseDiaCatalogPage, parseDiaMenu } from "./dia-dtos.js";
import { DiaProvider } from "./dia-provider.js";

const INITIAL_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CART_ID = "22222222-2222-4222-8222-222222222222";
const DEFINITIVE_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const OBSERVED_AT = new Date("2026-08-13T19:00:00.000Z");

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

function marketResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { session_id: DEFINITIVE_SESSION_ID },
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
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

describe("DIA catalog", () => {
  it("parsea el menú y las páginas PLP confirmadas", () => {
    expect(parseDiaMenu(fixture("menu-data.json"))).toHaveLength(2);
    expect(
      parseDiaCatalogPage(fixture("catalog-leche-page-1.json")),
    ).toMatchObject({
      categoryId: "L2051",
      pageNumber: 1,
      totalPages: 2,
      totalItems: 3,
      items: [{ skuId: "504P6" }, { skuId: "LACTOSA1L" }],
    });
  });

  it("descarta los Todo duplicados y recorre todas las páginas", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(fixture("menu-data.json")))
      .mockResolvedValueOnce(jsonResponse(fixture("catalog-leche-page-1.json")))
      .mockResolvedValueOnce(
        jsonResponse(fixture("catalog-leche-page-2.json")),
      );
    const provider = createProvider(fetchMock);
    const market = await provider.resolveMarket("50009");

    await expect(provider.getCategories(market)).resolves.toEqual([
      {
        externalId: "L108",
        name: "Huevos, leche y mantequilla",
        level: 0,
        order: 0,
      },
      {
        externalId: "L2051",
        name: "Leche",
        level: 1,
        order: 1,
        parentExternalId: "L108",
      },
      {
        externalId: "L106",
        name: "Arroz, pastas y legumbres",
        level: 0,
        order: 1,
      },
      {
        externalId: "L2270",
        name: "Fideos",
        level: 1,
        order: 1,
        parentExternalId: "L106",
      },
    ]);

    const result = await provider.getProductsByCategory("L2051", market);
    expect(result.products).toHaveLength(3);
    expect(result.offers).toHaveLength(2);
    expect(result.products[0]).toMatchObject({
      retailer: "DIA",
      externalId: "504P6",
      category: "Huevos, leche y mantequilla",
      subcategory: "Leche",
      marketId: "postal-code:50009",
      observedAt: OBSERVED_AT,
    });
    expect(result.offers[0]).toMatchObject({
      retailerProductId: "504P6",
      normalPrice: 5.04,
      pricePerUnit: 0.84,
      referenceUnit: "l",
      available: true,
    });
    expect((fetchMock.mock.calls[1]?.[0] as URL).href).toBe(
      "https://www.dia.es/api/v1/common-aggregator/menu-data",
    );
    expect((fetchMock.mock.calls[2]?.[0] as URL).href).toBe(
      "https://www.dia.es/api/v1/plp-back/reduced/huevos-leche-y-mantequilla/leche/c/L2051",
    );
    expect((fetchMock.mock.calls[3]?.[0] as URL).href).toBe(
      "https://www.dia.es/api/v1/plp-back/reduced/huevos-leche-y-mantequilla/leche/pag-2/c/L2051",
    );
  });

  it("rechaza menú, identidad o paginación incompatibles", async () => {
    expect(
      parseDiaMenu({
        categories: [{ id: "L1", name: "Bad", link: "//evil.test/c/L1" }],
      }),
    ).toBeUndefined();
    expect(
      parseDiaCatalogPage({
        selected_category_id: "L2051",
        pagination: { page_number: 1, page_size: 20, total_pages: 1 },
        total_items: 1,
        plp_items: [{}],
      }),
    ).toBeUndefined();

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(marketResponse())
      .mockResolvedValueOnce(jsonResponse(fixture("menu-data.json")))
      .mockResolvedValueOnce(
        jsonResponse({
          ...(fixture("catalog-leche-page-1.json") as Record<string, unknown>),
          selected_category_id: "L9999",
        }),
      );
    const provider = createProvider(fetchMock);
    const market = await provider.resolveMarket("50009");
    await expect(provider.getCategories(market)).resolves.toHaveLength(4);
    await expect(
      provider.getProductsByCategory("L2051", market),
    ).rejects.toBeInstanceOf(ProviderContractChangedError);
  });

  it("declara la capability de catálogo", () => {
    expect(supportsCatalog(new DiaProvider())).toBe(true);
  });
});
