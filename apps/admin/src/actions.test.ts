import { describe, expect, it, vi } from "vitest";

import { AdminActions, parseProductIds } from "./actions.js";
import { SupabaseRestClient } from "./supabase.js";

describe("AdminActions", () => {
  it("sends provider changes only to the protected Supabase RPC", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const actions = new AdminActions(
      new SupabaseRestClient({
        url: "https://example.supabase.co",
        serviceRoleKey: "server-only-key",
        fetch,
      }),
      "operator",
    );

    await actions.setProviderStatus(
      "00000000-0000-4000-8000-000000000001",
      "DEGRADED",
    );

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(requestUrl(url)).toContain("/rest/v1/rpc/admin_set_provider_status");
    const body = init?.body;
    expect(typeof body).toBe("string");
    expect(
      JSON.parse(typeof body === "string" ? body : "null") as unknown,
    ).toEqual({
      target_retailer_id: "00000000-0000-4000-8000-000000000001",
      target_status: "DEGRADED",
      actor: "operator",
    });
  });

  it("rejects malformed identifiers before querying the backend", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const actions = new AdminActions(
      new SupabaseRestClient({
        url: "https://example.supabase.co",
        serviceRoleKey: "key",
        fetch,
      }),
      "operator",
    );
    expect(() => actions.acceptMatch("not-a-uuid")).toThrow(
      "matchId must be a UUID",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes and deduplicates optional product ids", () => {
    expect(parseProductIds("sku-1, sku-2\nsku-1")).toEqual(["sku-1", "sku-2"]);
  });
});

function requestUrl(input: string | URL | Request | undefined): string {
  if (input === undefined) return "";
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
