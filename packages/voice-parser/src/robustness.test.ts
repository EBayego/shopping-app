import { describe, expect, it } from "vitest";

import { parseShoppingIntents, parseShoppingIntentSegments } from "./index.ts";

describe("voice parser robustness", () => {
  describe("hesitations and natural speech", () => {
    it.each([
      "eh dos kilos de patatas",
      "eeeh dos kilos de patatas",
      "eeehm dos kilos de patatas",
      "em dos kilos de patatas",
      "mmm dos kilos de patatas",
      "bueno pues dos kilos de patatas",
      "a ver necesito dos kilos de patatas por favor",
    ])("ignores fillers without losing the request in %j", (text) => {
      expect(parseShoppingIntents(text)[0]).toMatchObject({
        product: "patatas",
        requestedQuantity: 2,
        requestedUnit: "kg",
        confidence: "HIGH",
      });
    });

    it("ignores fillers between every meaningful field", () => {
      expect(
        parseShoppingIntents(
          "eeeh quiero dos mmm botellas de eh medio litro de agua por favor",
        )[0],
      ).toMatchObject({
        product: "agua",
        packageCount: 2,
        packageSize: 0.5,
        packageUnit: "l",
        totalAmount: 1,
      });
    });

    it("keeps the verbatim item text while excluding fillers from fields", () => {
      const text = "eeeh necesito dos kilos de eh manzanas por favor";
      expect(parseShoppingIntents(text)[0]).toMatchObject({
        rawText: text,
        product: "manzanas",
        requestedQuantity: 2,
      });
    });

    it.each(["eh", "eeehm", "mmm", "bueno pues", "a ver", "por favor"])(
      "does not invent a product from filler-only speech %j",
      (text) => expect(parseShoppingIntents(text)).toEqual([]),
    );

    it("does not erase real words that resemble discourse", () => {
      expect(
        parseShoppingIntents("un litro de aceite de oliva")[0],
      ).toMatchObject({
        product: "aceite de oliva",
      });
    });
  });

  describe("pauses and product boundaries", () => {
    const noisyLocalTranscript =
      "quiero añadir tres garrafas de agua de 8 litros de dos cajas de un kilo de toma triturado y dos zonas de huevos y tres litros de leche";

    it("recovers the four products from the noisy real-device transcript", () => {
      expect(parseShoppingIntents(noisyLocalTranscript)).toEqual([
        expect.objectContaining({
          product: "agua",
          packageCount: 3,
          packageSize: 8,
          packageUnit: "l",
          totalAmount: 24,
          confidence: "HIGH",
        }),
        expect.objectContaining({
          product: "tomate triturado",
          packageCount: 2,
          packageSize: 1,
          packageUnit: "kg",
          totalAmount: 2,
          confidence: "HIGH",
        }),
        expect.objectContaining({
          product: "huevo",
          requestedQuantity: 24,
          requestedUnit: "unit",
        }),
        expect.objectContaining({
          product: "leche",
          requestedQuantity: 3,
          requestedUnit: "l",
          confidence: "HIGH",
        }),
      ]);
    });

    it("recovers the same products when native pauses split the transcript", () => {
      expect(
        parseShoppingIntentSegments([
          "quiero añadir",
          "tres garrafas de agua de 8 litros de",
          "dos cajas de un kilo de toma triturado",
          "y dos zonas de huevos",
          "y tres litros de leche",
        ]).map((draft) => draft.product),
      ).toEqual(["agua", "tomate triturado", "huevo", "leche"]);
    });

    it("does not apply the recognition corrections outside grocery phrases", () => {
      expect(
        parseShoppingIntentSegments(["toma de corriente", "zonas de paso"]).map(
          (draft) => draft.product,
        ),
      ).toEqual(["toma de corriente", "zonas de paso"]);
    });

    it("does not split genuinely nested containers", () => {
      expect(
        parseShoppingIntents("dos packs de tres cajas de leche"),
      ).toHaveLength(1);
    });

    it("never marks an unseparated structured quantity as high confidence", () => {
      expect(
        parseShoppingIntents(
          "tres garrafas de agua de ocho litros de referencia especial",
        )[0],
      ).toMatchObject({ confidence: "LOW" });
    });

    it("uses native pauses to retain unknown multi-word products", () => {
      expect(
        parseShoppingIntentSegments([
          "aguacates",
          "papel higiénico",
          "jabón de manos",
        ]).map((draft) => draft.product),
      ).toEqual(["aguacates", "papel higienico", "jabon de manos"]);
    });

    it("merges a phrase interrupted by several hesitation-only pauses", () => {
      const drafts = parseShoppingIntentSegments([
        "eeeh un kilo de",
        "mmm",
        "manzanas",
        "bueno",
        "dos litros de leche",
      ]);
      expect(drafts).toEqual([
        expect.objectContaining({
          product: "manzanas",
          requestedQuantity: 1,
          requestedUnit: "kg",
        }),
        expect.objectContaining({
          product: "leche",
          requestedQuantity: 2,
          requestedUnit: "l",
        }),
      ]);
    });

    it.each([
      ["leche y pan", ["leche", "pan"]],
      ["manzanas y peras y huevos", ["manzanas", "peras", "huevo"]],
      ["pan huevos arroz", ["pan", "huevo", "arroz"]],
      ["leche punto pan coma seis huevos", ["leche", "pan", "huevo"]],
      ["leche; pan! seis huevos", ["leche", "pan", "huevo"]],
      ["pan y eeehm luego leche", ["pan", "leche"]],
    ] as const)("separates natural list %j", (text, products) => {
      expect(parseShoppingIntents(text).map((draft) => draft.product)).toEqual(
        products,
      );
    });

    it.each(["pan de leche", "café con leche", "un kilo y medio de patatas"])(
      "does not split compound phrase %j",
      (text) => expect(parseShoppingIntents(text)).toHaveLength(1),
    );
  });

  describe("large, compound and decimal numbers", () => {
    it.each([
      ["veintiuna unidades de huevo", 21, "unit"],
      ["treinta y cuatro litros de agua", 34, "l"],
      ["ciento veintiocho gramos de queso", 128, "g"],
      ["novecientos noventa y nueve gramos de arroz", 999, "g"],
      ["treinta y uno coma cinco litros de agua", 31.5, "l"],
      ["dos pares de calcetines", 4, "unit"],
    ] as const)(
      "extracts the complete number in %j",
      (text, quantity, unit) => {
        expect(parseShoppingIntents(text)[0]).toMatchObject({
          requestedQuantity: quantity,
          requestedUnit: unit,
        });
        expect(parseShoppingIntents(text)).toHaveLength(1);
      },
    );
  });

  describe("containers and structured qualifiers", () => {
    it.each([
      ["una caja de doce huevos", 1, 12, "unit", 12],
      ["tres bolsas de cuatro manzanas", 3, 4, "unit", 12],
      ["pack de seis yogures", 1, 6, "unit", 6],
      ["dos garrafas de agua de cinco litros", 2, 5, "l", 10],
    ] as const)(
      "extracts package dimensions from %j",
      (text, count, size, unit, total) => {
        expect(parseShoppingIntents(text)[0]).toMatchObject({
          packageCount: count,
          packageSize: size,
          packageUnit: unit,
          totalAmount: total,
          confidence: "HIGH",
        });
      },
    );

    it("flattens nested containers without losing the total amount", () => {
      expect(
        parseShoppingIntents("dos cajas de doce latas de cerveza de 330 ml")[0],
      ).toMatchObject({
        product: "cerveza",
        packageCount: 24,
        packageSize: 330,
        packageUnit: "ml",
        totalAmount: 7920,
      });
    });

    it("recognizes a known brand introduced explicitly", () => {
      expect(
        parseShoppingIntents(
          "dos litros de leche de marca Pascual semidesnatada",
        )[0],
      ).toMatchObject({
        product: "leche",
        brandPreference: "Pascual",
        variant: "semidesnatada",
      });
    });

    it.each([
      ["cuatro yogures sabor fresa", "yogur", "fresa"],
      ["dos paquetes de arroz variedad basmati", "arroz", "basmati"],
      ["tres latas de atún al natural de 80 gramos", "atun", "al natural"],
    ])(
      "extracts an explicit or known variant from %j",
      (text, product, variant) => {
        expect(parseShoppingIntents(text)[0]).toMatchObject({
          product,
          variant,
        });
      },
    );

    it("still refuses to guess an unknown brand", () => {
      expect(
        parseShoppingIntents("dos cajas de marca totalmente inventada")[0],
      ).not.toHaveProperty("brandPreference");
    });
  });
});
