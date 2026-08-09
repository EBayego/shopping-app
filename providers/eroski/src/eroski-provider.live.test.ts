import { describe, expect, it } from "vitest";

import { EroskiHtmlParser } from "./eroski-html-parser.js";
import { EroskiHttpClient } from "./eroski-http-client.js";

const PRODUCT_URL =
  "https://supermercado.eroski.es/es/productdetail/18631259-solomillo-de-pavo-al-vacio-eroski-bipack-sobre-al-peso-aprox-750-g/";

describe.skipIf(process.env.RUN_LIVE_PROVIDER_TESTS !== "true")(
  "Eroski public product page live",
  () => {
    it("obtiene y parsea la página SSR confirmada", async () => {
      const page = await new EroskiHttpClient({
        timeoutMs: 15_000,
      }).getProductPage(PRODUCT_URL);
      const dto = new EroskiHtmlParser().parse(page.html, page.url);

      expect(dto).toMatchObject({
        externalId: "18631259",
      });
      expect(typeof dto.availability).toBe("boolean");
      expect(dto.name.toLocaleLowerCase("es-ES")).toContain(
        "solomillo de pavo",
      );
      expect(dto.price).toBeGreaterThan(0);
      expect(dto.shopRef).not.toBe("");
    }, 30_000);
  },
);
