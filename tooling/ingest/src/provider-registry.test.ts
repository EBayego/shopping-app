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

  it("registers targeted price refresh for Alcampo and Eroski", () => {
    expect(getIngestionCapabilities("EROSKI")).toEqual(["PRICE_REFRESH"]);
    expect(getIngestionCapabilities("ALCAMPO")).toEqual(["PRICE_REFRESH"]);
    expect(createPriceRefreshStrategy("EROSKI").kind).toBe("PRICE_REFRESH");
    expect(createPriceRefreshStrategy("ALCAMPO").kind).toBe("PRICE_REFRESH");
  });
});
