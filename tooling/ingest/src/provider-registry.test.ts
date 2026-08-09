import { describe, expect, it } from "vitest";

import {
  createCatalogStrategy,
  createPriceRefreshStrategy,
  createSearchStrategy,
  getIngestionCapabilities,
} from "./provider-registry.js";

describe("search provider registry", () => {
  it("registers DIA search", () => {
    expect(createSearchStrategy("DIA").kind).toBe("SEARCH_INGESTION");
    expect(createPriceRefreshStrategy("DIA").kind).toBe("PRICE_REFRESH");
  });

  it("keeps Mercadona disabled without a confirmed search capability", () => {
    expect(() => createSearchStrategy("MERCADONA")).toThrow(
      "registered strategies: CATALOG, PRICE_REFRESH",
    );
    expect(getIngestionCapabilities("MERCADONA")).toEqual([
      "CATALOG",
      "PRICE_REFRESH",
    ]);
    expect(createCatalogStrategy("MERCADONA").kind).toBe("CATALOG_SYNC");
    expect(createPriceRefreshStrategy("MERCADONA").kind).toBe("PRICE_REFRESH");
  });

  it("rejects a provider without registered PRICE_REFRESH before execution", () => {
    expect(() => createPriceRefreshStrategy("EROSKI")).toThrow(
      "does not support PRICE_REFRESH",
    );
  });
});
