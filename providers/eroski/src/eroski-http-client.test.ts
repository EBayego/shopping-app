import { describe, expect, it, vi } from "vitest";

import { EroskiHttpClient, EroskiHttpError } from "./eroski-http-client.js";
import { EroskiSessionContext } from "./eroski-session-context.js";

function htmlResponse(
  html: string,
  headers?: ConstructorParameters<typeof Headers>[0],
): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function context(): EroskiSessionContext {
  return new EroskiSessionContext({
    shopRef: "157",
    shopName: "Bilbondo",
    cookies: new Map([["supermarket.ali.shop", "157"]]),
    homeHtml: "<!doctype html>",
    homeUrl: "https://supermercado.eroski.es/",
  });
}

describe("EroskiHttpClient", () => {
  it("inicia sesión pública y obtiene el producto por id con slug neutro", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        htmlResponse("<!doctype html><title>Inicio</title>", {
          "set-cookie":
            "supermarket.ali.shop=157; Path=/, supermarket.ali.shopName=Bilbondo; Path=/, JSESSIONID=session; Path=/",
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse("<!doctype html><title>Producto</title>"),
      );
    const client = new EroskiHttpClient({ fetch: fetchMock });
    const session = await client.bootstrap();
    const page = await client.getProductPage("18631259", session);

    expect(session).toMatchObject({ shopRef: "157", shopName: "Bilbondo" });
    expect(page.url).toBe(
      "https://supermercado.eroski.es/es/productdetail/18631259-x/",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      redirect: "follow",
    });
    const headers = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(headers.get("user-agent")).toContain("Chrome/");
    expect(headers.get("cookie")).toContain("JSESSIONID=session");
  });

  it("reproduce la paginación Tapestry confirmada", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ content: "<div>productos</div>" }), {
        headers: { "content-type": "application/json;charset=UTF-8" },
      }),
    );
    const client = new EroskiHttpClient({ fetch: fetchMock });
    const content = await client.getCategoryProductsPage(
      "/es/supermercado/2059806-alimentacion/2059852-mantequilla/",
      1,
      "https://supermercado.eroski.es/es/supermercado/2059806-alimentacion/2059852-mantequilla/",
      context(),
    );

    expect(content).toBe("<div>productos</div>");
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe("/es/supermarket:loadpage");
    expect(url.searchParams.get("t:ac")).toBe(
      "2059806-alimentacion/2059852-mantequilla",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      "t%3Azoneid=productListZone&pageNumber=1",
    );
  });

  it("rechaza mercados públicos ausentes y respuestas incompatibles", async () => {
    const noMarket = new EroskiHttpClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(htmlResponse("<!doctype html>")),
    });
    await expect(noMarket.bootstrap()).rejects.toMatchObject({
      kind: "invalid-response",
    });

    const jsonClient = new EroskiHttpClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", {
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    await expect(
      jsonClient.getProductPage("1", context()),
    ).rejects.toBeInstanceOf(EroskiHttpError);

    const emptyClient = new EroskiHttpClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("   ", { headers: { "content-type": "text/html" } }),
        ),
    });
    await expect(
      emptyClient.getProductPage("1", context()),
    ).rejects.toBeInstanceOf(EroskiHttpError);
  });
});
