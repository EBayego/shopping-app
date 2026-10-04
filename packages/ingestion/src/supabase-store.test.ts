import { describe, expect, it, vi } from "vitest";

import { SupabaseIngestionStore } from "./supabase-store.js";

describe("SupabaseIngestionStore preflight observability", () => {
  it("paginates price refresh candidates beyond the Supabase row cap", async () => {
    const candidate = (index: number) => ({
      retailer_product_external_id: String(index).padStart(5, "0"),
      offer_observed_at: null,
      in_active_list: false,
      last_used_at: null,
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          Array.from({ length: 1_000 }, (_, index) => candidate(index)),
        ),
      )
      .mockResolvedValueOnce(jsonResponse([candidate(1_000)]));
    const store = new SupabaseIngestionStore({
      url: "https://project.supabase.co",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    const candidates = await store.listPriceRefreshCandidates({
      retailerId: "retailer-1",
      marketId: "market-1",
    });

    expect(candidates).toHaveLength(1_001);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://project.supabase.co/rest/v1/rpc/list_price_refresh_candidates?limit=1000&offset=0",
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://project.supabase.co/rest/v1/rpc/list_price_refresh_candidates?limit=1000&offset=1000",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).has("Range")).toBe(false);
      if (typeof init?.body !== "string") {
        throw new TypeError("Expected a JSON request body");
      }
      expect(JSON.parse(init.body)).toEqual({
        target_retailer_id: "retailer-1",
        target_market_id: "market-1",
      });
    }
  });

  it.each([0, 1_000, 2_000, 4_476])(
    "reads %i candidates using query-parameter pagination and terminates",
    async (count) => {
      const rows = Array.from({ length: count }, (_, index) => ({
        retailer_product_external_id: String(index),
        offer_observed_at: "2026-10-04T09:00:00Z",
        in_active_list: index === 0,
        last_used_at: index === 0 ? "2026-10-03T09:00:00Z" : null,
      }));
      const fetch = vi.fn<typeof globalThis.fetch>((input) => {
        if (typeof input !== "string") {
          throw new TypeError("Expected a request URL string");
        }
        const url = new URL(input);
        expect(url.searchParams.get("limit")).toBe("1000");
        const offset = Number(url.searchParams.get("offset"));
        expect(url.searchParams.has("offset")).toBe(true);
        expect(offset).toBe((fetch.mock.calls.length - 1) * 1_000);
        return Promise.resolve(
          jsonResponse(rows.slice(offset, offset + 1_000)),
        );
      });
      const store = new SupabaseIngestionStore({
        url: "https://project.supabase.co",
        secretKey: "sb_secret_test-key",
        fetch,
      });

      const candidates = await store.listPriceRefreshCandidates({
        retailerId: "retailer-1",
        marketId: "market-1",
      });

      expect(candidates).toHaveLength(count);
      expect(
        new Set(candidates.map((row) => row.retailerProductExternalId)).size,
      ).toBe(count);
      expect(fetch).toHaveBeenCalledTimes(Math.floor(count / 1_000) + 1);
      if (count > 0) {
        expect(candidates[0]).toEqual({
          retailerProductExternalId: "0",
          offerObservedAt: new Date("2026-10-04T09:00:00Z"),
          inActiveList: true,
          lastUsedAt: new Date("2026-10-03T09:00:00Z"),
        });
      }
    },
  );

  it.each(["repeated", "overlapping"])(
    "rejects a %s page instead of accumulating candidates indefinitely",
    async (mode) => {
      const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
        retailer_product_external_id: String(index),
        offer_observed_at: null,
        in_active_list: false,
        last_used_at: null,
      }));
      // Even changed metadata must not disguise a repeated product identity.
      const secondPage = (
        mode === "repeated" ? firstPage : firstPage.slice(-1)
      ).map((row) => ({ ...row, in_active_list: true }));
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(firstPage))
        .mockResolvedValueOnce(jsonResponse(secondPage))
        .mockRejectedValue(new Error("Unexpected additional page request"));
      const store = new SupabaseIngestionStore({
        url: "https://project.supabase.co",
        secretKey: "sb_secret_test-key",
        fetch,
      });

      await expect(
        store.listPriceRefreshCandidates({
          retailerId: "retailer-1",
          marketId: "market-1",
        }),
      ).rejects.toThrow("duplicate product at offset 1000");
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("propagates a failed page request without returning incomplete candidates", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          Array.from({ length: 1_000 }, (_, index) => ({
            retailer_product_external_id: String(index),
            offer_observed_at: null,
            in_active_list: false,
            last_used_at: null,
          })),
        ),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const store = new SupabaseIngestionStore({
      url: "https://project.supabase.co",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    await expect(
      store.listPriceRefreshCandidates({
        retailerId: "retailer-1",
        marketId: "market-1",
      }),
    ).rejects.toThrow("Supabase request failed (503)");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("deactivates unique products confirmed missing", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("1", { status: 200 }));
    const store = new SupabaseIngestionStore({
      url: "https://project.supabase.co",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    await store.deactivateProducts(
      { retailerId: "retailer-1", marketId: "market-1" },
      ["16663", "16663"],
    );

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://project.supabase.co/rest/v1/rpc/deactivate_retailer_products",
    );
    const requestBody = fetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new TypeError("Expected a JSON request body");
    }
    expect(JSON.parse(requestBody)).toEqual({
      target_retailer_id: "retailer-1",
      target_market_id: "market-1",
      target_external_ids: ["16663"],
    });
  });

  it("persists a failed run and provider health without a market", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: "retailer-1" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "run-1" }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const store = new SupabaseIngestionStore({
      url: "https://project.supabase.co",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    await store.recordPreflightFailure({
      retailer: "EROSKI",
      syncType: "PRICE_REFRESH",
      startedAt: new Date("2026-08-10T08:00:00Z"),
      finishedAt: new Date("2026-08-10T08:00:01Z"),
      errorMessage: "market resolution failed",
    });

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test-key");
    expect(headers.has("Authorization")).toBe(false);

    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://project.supabase.co/rest/v1/provider_sync_runs?select=id",
    );
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetch.mock.calls[1]?.[1]?.body).toContain('"market_id":null');
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "https://project.supabase.co/rest/v1/provider_health?on_conflict=retailer_id%2Cmarket_id",
    );
    expect(fetch.mock.calls[2]?.[1]?.method).toBe("POST");
    expect(fetch.mock.calls[2]?.[1]?.body).toContain('"syncRunId":"run-1"');
  });

  it("records complete-catalog misses against the active sync run", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("0", { status: 200 }));
    const store = new SupabaseIngestionStore({
      url: "https://project.supabase.co",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    await store.recordCatalogProductMisses(
      { retailerId: "retailer-1", marketId: "market-1" },
      "run-1",
      ["sku-1", "sku-2"],
    );

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://project.supabase.co/rest/v1/rpc/record_catalog_product_misses_for_run",
    );
    const requestBody = fetch.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new TypeError("Expected a JSON request body");
    }
    expect(JSON.parse(requestBody)).toEqual({
      target_retailer_id: "retailer-1",
      target_market_id: "market-1",
      target_sync_run_id: "run-1",
      seen_external_ids: ["sku-1", "sku-2"],
      required_misses: 3,
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
