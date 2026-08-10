import { describe, expect, it, vi } from "vitest";

import { SupabaseIngestionStore } from "./supabase-store.js";

describe("SupabaseIngestionStore preflight observability", () => {
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
