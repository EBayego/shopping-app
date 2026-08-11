import { describe, expect, it } from "vitest";

import { parseShoppingIntents, parseShoppingIntentSegments } from "./index.ts";

describe("parseShoppingIntents", () => {
  describe("numbers and measured quantities", () => {
    it.each([
      ["un litro de leche", 1, "leche"],
      ["una unidad de pan", 1, "pan"],
      ["dos litros de leche", 2, "leche"],
      ["tres litros de leche", 3, "leche"],
      ["diez litros de leche", 10, "leche"],
      ["doce litros de leche", 12, "leche"],
      ["veinte litros de leche", 20, "leche"],
      ["7 litros de leche", 7, "leche"],
    ])("parses %s", (text, quantity, product) => {
      expect(parseShoppingIntents(text)).toEqual([
        expect.objectContaining({
          product,
          requestedQuantity: quantity,
          requestedUnit: text.includes("unidad") ? "unit" : "l",
        }),
      ]);
    });

    it.each([
      ["1,5 litros de leche", 1.5],
      ["1.5 litros de leche", 1.5],
      ["uno coma cinco litros de leche", 1.5],
      ["dos litros y medio de leche", 2.5],
    ])("parses decimal quantity in %s", (text, expected) => {
      expect(parseShoppingIntents(text)[0]).toMatchObject({
        product: "leche",
        requestedQuantity: expected,
        requestedUnit: "l",
        totalAmount: expected,
        confidence: "HIGH",
      });
    });

    it("parses medio kilo", () => {
      expect(parseShoppingIntents("medio kilo de carne")).toEqual([
        {
          rawText: "medio kilo de carne",
          product: "carne",
          requestedQuantity: 0.5,
          requestedUnit: "kg",
          totalAmount: 0.5,
          confidence: "HIGH",
        },
      ]);
    });

    it("parses cuarto de kilo only in a measured context", () => {
      expect(parseShoppingIntents("cuarto de kilo de queso")[0]).toMatchObject({
        product: "queso",
        requestedQuantity: 0.25,
        requestedUnit: "kg",
        confidence: "HIGH",
      });
      expect(parseShoppingIntents("cuarto queso")[0]).toMatchObject({
        requestedQuantity: 0.25,
        requestedUnit: "unit",
        confidence: "LOW",
      });
    });

    it.each([
      ["250 gramos de queso", 250, "g"],
      ["2 kg de pollo", 2, "kg"],
      ["500 ml de agua", 500, "ml"],
      ["500ml de agua", 500, "ml"],
      ["75 cl de cerveza", 75, "cl"],
      ["1,5l de agua", 1.5, "l"],
      ["3 unidades de tomate", 3, "unit"],
    ])("recognizes supported units in %s", (text, amount, unit) => {
      expect(parseShoppingIntents(text)[0]).toMatchObject({
        requestedQuantity: amount,
        requestedUnit: unit,
      });
    });
  });

  describe("counts and packaging", () => {
    it("does not confuse product count with volume", () => {
      expect(parseShoppingIntents("dos leches")[0]).toMatchObject({
        product: "leche",
        requestedQuantity: 2,
        requestedUnit: "unit",
        confidence: "MEDIUM",
      });
      expect(parseShoppingIntents("dos leches")[0]).not.toHaveProperty(
        "packageSize",
      );

      expect(parseShoppingIntents("dos litros de leche")[0]).toMatchObject({
        product: "leche",
        requestedQuantity: 2,
        requestedUnit: "l",
        totalAmount: 2,
        confidence: "HIGH",
      });
    });

    it("parses counted bottles with their individual size and total", () => {
      expect(
        parseShoppingIntents("dos botellas de coca cola de dos litros")[0],
      ).toMatchObject({
        product: "coca cola",
        brandPreference: "Coca-Cola",
        packageCount: 2,
        packageSize: 2,
        packageUnit: "l",
        totalAmount: 4,
        confidence: "HIGH",
      });
    });

    it("parses a bottle size placed before the product", () => {
      expect(
        parseShoppingIntents("2 botellas de 2 litros de agua")[0],
      ).toMatchObject({
        product: "agua",
        packageCount: 2,
        packageSize: 2,
        packageUnit: "l",
        totalAmount: 4,
      });
    });

    it("parses packs of units", () => {
      expect(
        parseShoppingIntents("dos packs de seis yogures")[0],
      ).toMatchObject({
        product: "yogur",
        packageCount: 2,
        packageSize: 6,
        packageUnit: "unit",
        totalAmount: 12,
        confidence: "HIGH",
      });
    });

    it.each([
      ["tres latas de cerveza de 330 ml", "can"],
      ["dos paquetes de arroz de 1 kg", "pack"],
      ["cuatro botellas de agua de medio litro", "bottle"],
    ])("supports container phrasing: %s", (text) => {
      const result = parseShoppingIntents(text)[0];
      expect(result).toMatchObject({ confidence: "HIGH" });
      expect(result?.packageCount).toBeGreaterThan(0);
      expect(result?.packageSize).toBeGreaterThan(0);
    });

    it("combines a requested item with its trailing package size", () => {
      expect(
        parseShoppingIntents("una coca cola zero de dos litros")[0],
      ).toMatchObject({
        product: "coca cola",
        variant: "zero",
        brandPreference: "Coca-Cola",
        requestedQuantity: 1,
        requestedUnit: "unit",
        packageCount: 1,
        packageSize: 2,
        packageUnit: "l",
        totalAmount: 2,
      });
    });
  });

  describe("products, variants and brands", () => {
    it("extracts a dairy variant", () => {
      expect(
        parseShoppingIntents("dos litros de leche semidesnatada")[0],
      ).toMatchObject({
        product: "leche",
        variant: "semidesnatada",
      });
    });

    it("extracts a multi-word variant", () => {
      expect(parseShoppingIntents("dos leches sin lactosa")[0]).toMatchObject({
        product: "leche",
        variant: "sin lactosa",
      });
    });

    it("extracts known brands without guessing unknown capitalized words", () => {
      expect(
        parseShoppingIntents("dos litros de leche Pascual semidesnatada")[0],
      ).toMatchObject({
        product: "leche",
        brandPreference: "Pascual",
        variant: "semidesnatada",
      });
      expect(
        parseShoppingIntents("seis yogures Danone griegos")[0],
      ).toMatchObject({
        product: "yogur",
        brandPreference: "Danone",
        variant: "griego",
      });
      expect(
        parseShoppingIntents("dos cajas de marca inventada")[0],
      ).not.toHaveProperty("brandPreference");
    });
  });

  describe("multiple items", () => {
    it("splits adjacent quantified items without punctuation", () => {
      expect(
        parseShoppingIntents("un kilo de judías verdes una docena de patatas"),
      ).toEqual([
        expect.objectContaining({
          rawText: "un kilo de judías verdes",
          product: "judias verdes",
          requestedQuantity: 1,
          requestedUnit: "kg",
        }),
        expect.objectContaining({
          rawText: "una docena de patatas",
          product: "patatas",
          requestedQuantity: 12,
          requestedUnit: "unit",
        }),
      ]);
    });

    it.each([
      ["una docena de huevos", 12],
      ["dos docenas de huevos", 24],
      ["media docena de huevos", 6],
    ])("parses collective quantity %s", (text, requestedQuantity) => {
      expect(parseShoppingIntents(text)).toEqual([
        expect.objectContaining({
          product: "huevo",
          requestedQuantity,
          requestedUnit: "unit",
        }),
      ]);
    });

    it("uses native speech segments while merging an incomplete phrase", () => {
      expect(
        parseShoppingIntentSegments([
          "un kilo de judías verdes",
          "una docena de patatas",
        ]).map((item) => item.product),
      ).toEqual(["judias verdes", "patatas"]);
      expect(
        parseShoppingIntentSegments(["un kilo de", "judías verdes"]),
      ).toEqual([
        expect.objectContaining({
          product: "judias verdes",
          requestedQuantity: 1,
          requestedUnit: "kg",
        }),
      ]);
    });

    it.each([
      "un kilo y medio de tomates",
      "dos botellas de agua de un litro",
      "coca cola de dos litros",
    ])("does not split an internal quantity in %s", (text) => {
      expect(parseShoppingIntents(text)).toHaveLength(1);
    });

    it("splits commas and a conjunction followed by a quantity", () => {
      expect(parseShoppingIntents("leche, pan y seis huevos")).toEqual([
        expect.objectContaining({ rawText: "leche", product: "leche" }),
        expect.objectContaining({ rawText: "pan", product: "pan" }),
        expect.objectContaining({
          rawText: "seis huevos",
          product: "huevo",
          requestedQuantity: 6,
        }),
      ]);
    });

    it("handles a common transcript with a missing conjunction", () => {
      expect(
        parseShoppingIntents("pan huevos y dos litros de leche").map(
          (item) => item.product,
        ),
      ).toEqual(["pan", "huevo", "leche"]);
    });

    it("does not split compound product names", () => {
      expect(parseShoppingIntents("pan de leche")).toHaveLength(1);
      expect(parseShoppingIntents("dos coca cola zero")).toHaveLength(1);
      expect(parseShoppingIntents("aceite de oliva virgen extra")).toHaveLength(
        0,
      );
    });

    it("does not treat a decimal comma as an item separator", () => {
      expect(parseShoppingIntents("1,5 litros de agua")).toHaveLength(1);
    });
  });

  describe("ambiguous, incomplete and false-positive input", () => {
    it.each(["dos", "dos litros de", "medio"])(
      "keeps incomplete quantified transcript %s with low confidence",
      (text) => {
        expect(parseShoppingIntents(text)).toEqual([
          expect.objectContaining({ rawText: text, confidence: "LOW" }),
        ]);
      },
    );

    it("accepts polite command fillers but does not make them products", () => {
      expect(
        parseShoppingIntents("necesito dos kilos de pollo")[0],
      ).toMatchObject({
        product: "pollo",
        requestedQuantity: 2,
      });
    });

    it.each([
      "",
      "   ",
      "hola",
      "gracias",
      "por favor",
      "dos por uno",
      "llama a mama",
    ])("rejects non-shopping false positive %j", (text) =>
      expect(parseShoppingIntents(text)).toEqual([]),
    );

    it("does not invent quantity, unit, brand or variant for a bare product", () => {
      const [draft] = parseShoppingIntents("pan");
      expect(draft).toEqual({
        rawText: "pan",
        product: "pan",
        confidence: "MEDIUM",
      });
    });
  });
});
