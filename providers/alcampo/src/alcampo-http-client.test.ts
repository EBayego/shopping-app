import { describe, expect, it, vi } from "vitest";
import { AlcampoHttpClient, AlcampoHttpError } from "./alcampo-http-client.js";
import { AlcampoSessionContext } from "./alcampo-session-context.js";

const CONTEXT = new AlcampoSessionContext({
  postalCode: "50009",
  regionId: "region",
  deliveryDestinationId: "destination",
  visitorId: "visitor",
});
describe("AlcampoHttpClient", () => {
  it("reintenta transitorios con backoff y respeta Retry-After", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValue(
        new Response("{}", { headers: { "content-type": "application/json" } }),
      );
    const sleep = vi
      .fn<(ms: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    await new AlcampoHttpClient({
      fetch: fetchMock,
      sleep,
      maxRetries: 1,
    }).getProduct("1", CONTEXT);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reintenta 5xx con backoff y jitter", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("failure", { status: 503 }))
      .mockResolvedValue(
        new Response("{}", {
          headers: { "content-type": "application/json" },
        }),
      );
    const sleep = vi
      .fn<(ms: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    await new AlcampoHttpClient({
      fetch: fetchMock,
      sleep,
      maxRetries: 1,
      retryBaseDelayMs: 200,
      random: () => 0.5,
    }).getProduct("1", CONTEXT);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it("aborta por timeout y lo clasifica", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      );
    await expect(
      new AlcampoHttpClient({
        fetch: fetchMock,
        timeoutMs: 1,
        maxRetries: 0,
      }).getProduct("1", CONTEXT),
    ).rejects.toMatchObject({
      name: "AlcampoHttpError",
      kind: "aborted",
    } satisfies Partial<AlcampoHttpError>);
  });

  it("no reintenta errores no transitorios", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    await expect(
      new AlcampoHttpClient({ fetch: fetchMock, maxRetries: 2 }).getProduct(
        "1",
        CONTEXT,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("detecta el challenge WAF 202 aunque Response.ok sea true", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-amzn-waf-action": "challenge" },
      }),
    );

    await expect(
      new AlcampoHttpClient({ fetch: fetchMock, maxRetries: 0 }).getCategoryHtml(
        "categories/example/OC1603",
        CONTEXT,
      ),
    ).rejects.toMatchObject({
      name: "AlcampoHttpError",
      kind: "http",
      status: 202,
      message: "Alcampo requires an AWS WAF challenge",
    } satisfies Partial<AlcampoHttpError>);
  });
});
