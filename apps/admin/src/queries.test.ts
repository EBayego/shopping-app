import { describe, expect, it, vi } from "vitest";

import { AdminQueries, offerFreshness } from "./queries.js";
import { SupabaseRestClient } from "./supabase.js";

describe("critical admin queries", () => {
  it("encodes catalog filters and bounds unsafe search syntax", async () => {
    const requestedUrls: string[] = [];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        const url = requestUrl(input);
        requestedUrls.push(url);
        const payload = url.includes("/rpc/get_offer_freshness_policy")
          ? [{ stale_after_ms: 1_000, very_stale_after_ms: 2_000 }]
          : [];
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });
    const queries = new AdminQueries(
      new SupabaseRestClient({
        url: "https://example.supabase.co",
        serviceRoleKey: "secret",
        fetch,
      }),
    );
    await queries.catalog({ active: false, query: "leche,*)" });
    const catalogUrl = requestedUrls.find((url) =>
      url.includes("/retailer_products?"),
    );
    expect(catalogUrl).toBeDefined();
    const parsed = new URL(catalogUrl ?? "https://invalid.local");
    expect(parsed.searchParams.get("active")).toBe("eq.false");
    expect(parsed.searchParams.get("name")).toBe("ilike.*leche   *");
  });

  it("classifies freshness using the database policy boundaries", () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const policy = { stale_after_ms: 6_000, very_stale_after_ms: 24_000 };
    expect(offerFreshness(undefined, policy, now)).toBe("NO_OFFER");
    expect(offerFreshness("2026-08-09T11:59:55.000Z", policy, now)).toBe(
      "FRESH",
    );
    expect(offerFreshness("2026-08-09T11:59:50.000Z", policy, now)).toBe(
      "STALE",
    );
    expect(offerFreshness("2026-08-09T11:59:30.000Z", policy, now)).toBe(
      "VERY_STALE",
    );
  });

  it("uses a PostgREST anti-join for truly unmatched products", async () => {
    const requestedUrls: string[] = [];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((input) => {
        requestedUrls.push(requestUrl(input));
        return Promise.resolve(
          new Response("[]", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });
    const queries = new AdminQueries(
      new SupabaseRestClient({
        url: "https://example.supabase.co",
        serviceRoleKey: "secret",
        fetch,
      }),
    );

    await queries.matching("unmatched");

    const unmatchedUrl = requestedUrls.find((url) =>
      url.includes("/retailer_products?"),
    );
    expect(
      new URL(unmatchedUrl ?? "https://invalid.local").searchParams.get(
        "retailer_product_concepts",
      ),
    ).toBe("is.null");
  });
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
