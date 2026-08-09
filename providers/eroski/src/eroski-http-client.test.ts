import { describe, expect, it, vi } from "vitest";

import { EroskiHttpClient, EroskiHttpError } from "./eroski-http-client.js";

const PRODUCT_PATH = "/es/productdetail/18631259-producto/";

describe("EroskiHttpClient", () => {
  it("realiza únicamente GET público y exige HTML", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<!doctype html><title>Producto</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const page = await new EroskiHttpClient({
      fetch: fetchMock,
    }).getProductPage(PRODUCT_PATH);

    expect(page.url).toBe(`https://supermercado.eroski.es${PRODUCT_PATH}`);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0]?.[0] as URL).href).toBe(page.url);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "follow",
    });
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("accept"),
    ).toContain("text/html");
  });

  it("rechaza otros orígenes, respuestas no HTML y cuerpos vacíos", async () => {
    const client = new EroskiHttpClient({ fetch: vi.fn<typeof fetch>() });
    await expect(
      client.getProductPage("https://example.com/es/productdetail/1/"),
    ).rejects.toBeInstanceOf(RangeError);

    const jsonClient = new EroskiHttpClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", {
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    await expect(jsonClient.getProductPage(PRODUCT_PATH)).rejects.toMatchObject(
      {
        kind: "invalid-response",
      },
    );

    const emptyClient = new EroskiHttpClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("   ", { headers: { "content-type": "text/html" } }),
        ),
    });
    await expect(
      emptyClient.getProductPage(PRODUCT_PATH),
    ).rejects.toBeInstanceOf(EroskiHttpError);
  });
});
