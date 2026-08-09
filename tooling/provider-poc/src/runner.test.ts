import { describe, expect, it } from "vitest";

import { runProviderPoc } from "./runner.js";
import { createMockProvider } from "./mock-provider.js";

describe("runProviderPoc", () => {
  it("ejecuta el flujo de búsqueda con provider mock", async () => {
    const result = await runProviderPoc(
      {
        provider: "DIA",
        postalCode: "50009",
        query: "leche",
      },
      createMockProvider("DIA"),
    );

    expect(result.mode).toBe("search");
    if (result.mode === "search") {
      expect(result.products).toHaveLength(1);
    }
  });

  it("ejecuta el flujo de detalle y oferta con provider mock", async () => {
    const result = await runProviderPoc(
      {
        provider: "DIA",
        postalCode: "50009",
        product: "261354",
      },
      createMockProvider("DIA"),
    );

    expect(result.mode).toBe("product");
    if (result.mode === "product") {
      expect(result.product.externalId).toBe("261354");
      expect(result.offers).toHaveLength(1);
    }
  });
});
