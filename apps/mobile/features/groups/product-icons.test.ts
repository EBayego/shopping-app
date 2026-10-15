import { describe, expect, it } from "vitest";
import { productIcon } from "./product-icons";
describe("product icons", () => {
  it("recognizes accents, plurals and custom names locally", () => {
    expect(productIcon("Plátanos de Canarias")).toBe("🍌");
    expect(productIcon("leche para el desayuno")).toBe("🥛");
    expect(productIcon("leche corporal")).toBe("🧴");
  });
  it("uses a neutral fallback without a catalog dependency", () => {
    expect(productIcon("mi producto especial")).toBe("🛒");
  });
});
