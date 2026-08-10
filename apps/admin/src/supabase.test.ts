import { describe, expect, it, vi } from "vitest";

import { SupabaseRestClient } from "./supabase.js";

describe("SupabaseRestClient", () => {
  it("keeps the service role in server-side request headers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ id: "retailer-1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new SupabaseRestClient({
      url: "https://example.supabase.co/",
      serviceRoleKey: "server-only-key",
      fetch,
    });
    await client.select("retailers", { select: "id", active: "eq.true" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(requestUrl(url)).toBe(
      "https://example.supabase.co/rest/v1/retailers?select=id&active=eq.true",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer server-only-key",
    );
  });
});

function requestUrl(input: string | URL | Request | undefined): string {
  if (input === undefined) return "";
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
