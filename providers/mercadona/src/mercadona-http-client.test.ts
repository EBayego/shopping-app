import { describe, expect, it, vi } from "vitest";

import {
  MercadonaHttpClient,
  MercadonaHttpError,
} from "./mercadona-http-client.js";

describe("MercadonaHttpClient", () => {
  it("normaliza baseUrl y aborta cada intento por timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const client = new MercadonaHttpClient({
      baseUrl: "https://example.test/api",
      fetch: fetchMock,
      timeoutMs: 5,
      maxRetries: 0,
    });
    const error = await client
      .changePostalCode("50009")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MercadonaHttpError);
    expect((error as MercadonaHttpError).kind).toBe("aborted");
    expect((fetchMock.mock.calls[0]?.[0] as URL).href).toBe(
      "https://example.test/api/postal-codes/actions/change-pc/",
    );
  });
});
