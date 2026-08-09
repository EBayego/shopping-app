import { describe, expect, it } from "vitest";

import {
  isValidSpanishPostalCode,
  normalizeShoppingItemInput,
  validateCreateGroup,
} from "./validation";

describe("validateCreateGroup", () => {
  it("acepta nombres y un código postal español de cinco dígitos", () => {
    expect(
      validateCreateGroup({
        groupName: "Casa",
        listName: "Semanal",
        postalCode: "50009",
      }),
    ).toEqual({});
  });

  it("devuelve errores por campo sin depender de la UI nativa", () => {
    expect(
      validateCreateGroup({ groupName: " ", listName: "", postalCode: "123" }),
    ).toEqual({
      groupName: "Escribe un nombre para el grupo.",
      listName: "Escribe un nombre para la lista.",
      postalCode: "El código postal debe tener cinco dígitos.",
    });
  });
});

describe("normalizeShoppingItemInput", () => {
  it("conserva el texto limpio y reutiliza la normalización compartida", () => {
    expect(normalizeShoppingItemInput("  Leche Entera 1L  ")).toEqual({
      rawText: "Leche Entera 1L",
      normalizedName: "leche entera 1l",
    });
  });

  it("rechaza entradas vacías", () => {
    expect(() => normalizeShoppingItemInput("   ")).toThrow(
      "Escribe un producto.",
    );
  });
});

describe("isValidSpanishPostalCode", () => {
  it("solo acepta cinco dígitos", () => {
    expect(isValidSpanishPostalCode("28013")).toBe(true);
    expect(isValidSpanishPostalCode("2801")).toBe(false);
    expect(isValidSpanishPostalCode("28A13")).toBe(false);
  });
});
