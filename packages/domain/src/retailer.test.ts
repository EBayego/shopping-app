import { describe, expect, it } from "vitest";

import { isRetailer, RETAILERS } from "./retailer.ts";

describe("isRetailer", () => {
  it.each(RETAILERS)("acepta el retailer %s", (retailer) => {
    expect(isRetailer(retailer)).toBe(true);
  });

  it("rechaza valores desconocidos y diferencias de mayúsculas", () => {
    expect(isRetailer("dia")).toBe(false);
    expect(isRetailer("OTRO")).toBe(false);
  });
});
