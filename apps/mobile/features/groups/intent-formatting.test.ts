import { describe, expect, it } from "vitest";

import { formatShoppingIntent } from "./intent-formatting";

describe("formatShoppingIntent", () => {
  it.each([
    ["3 litros de leche", "leche", 3, "l", "Leche", "3", "L"],
    ["dos unidades de huevos", "huevo", 2, "unit", "Huevos", "2", "Uds."],
    ["una docena de patatas", "patatas", 12, "unit", "Patatas", "12", "Uds."],
    ["400 gramos de carne", "carne", 400, "g", "Carne", "400", "G"],
  ])(
    "formats structured voice item %s",
    (rawText, normalizedName, amount, requestedUnit, title, quantity, unit) => {
      expect(
        formatShoppingIntent(
          intent({
            raw_text: rawText,
            normalized_name: normalizedName,
            requested_quantity: amount,
            requested_unit: requestedUnit,
          }),
        ),
      ).toEqual({ title, quantity, unit });
    },
  );

  it("formats a specific container independently from its count", () => {
    expect(
      formatShoppingIntent(
        intent({
          raw_text: "tres botes de dos kilos de tomate triturado",
          normalized_name: "tomate triturado",
          requested_quantity: 3,
          requested_unit: "unit",
          package_count: 3,
          package_size: 2,
          package_unit: "kg",
        }),
      ),
    ).toEqual({
      title: "Tomate triturado",
      quantity: "3",
      unit: "Botes de 2 Kg",
    });
  });

  it("adds a structured variant once", () => {
    expect(
      formatShoppingIntent(
        intent({ normalized_name: "leche", variant: "semidesnatada" }),
      ).title,
    ).toBe("Leche semidesnatada");
  });

  it("preserves the spelling of a manually entered item", () => {
    expect(
      formatShoppingIntent(
        intent({
          raw_text: "Regalo para Marta",
          normalized_name: "regalo para marta",
        }),
      ).title,
    ).toBe("Regalo para Marta");
  });
});

function intent(
  overrides: Partial<Parameters<typeof formatShoppingIntent>[0]>,
): Parameters<typeof formatShoppingIntent>[0] {
  return {
    raw_text: "pan",
    normalized_name: "pan",
    requested_quantity: 1,
    requested_unit: null,
    package_count: null,
    package_size: null,
    package_unit: null,
    variant: null,
    ...overrides,
  };
}
