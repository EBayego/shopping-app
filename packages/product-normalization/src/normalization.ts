import type { ProductUnit, RetailerProduct } from "@shopping-app/domain";

import { isValidGtin } from "./gtin.js";
import type { NormalizedPackaging, NormalizedProduct } from "./types.js";
import { normalizeQuantity, parsePackagingFromName } from "./units.js";

const PACKAGING_WORDS = new Set([
  "pack",
  "paquete",
  "paquetes",
  "botella",
  "botellas",
  "bote",
  "botes",
  "brick",
  "bricks",
  "brik",
  "briks",
  "lata",
  "latas",
  "caja",
  "cajas",
  "formato",
  "envase",
  "envases",
]);

const VARIANTS = [
  "sin lactosa",
  "sin gluten",
  "sin azucar",
  "azucar cero",
  "cero azucar",
  "semidesnatada",
  "desnatada",
  "entera",
  "zero",
  "light",
  "integral",
  "ecologico",
  "ecologica",
  "bio",
] as const;

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[×]/g, "x")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeProduct(product: RetailerProduct): NormalizedProduct {
  const normalizedOriginal = normalizeText(product.name);
  const comparableOriginal = normalizeText(
    stripPackagingExpressions(product.name),
  );
  const normalizedBrand = optionalNormalized(product.brand);
  const variant = extractVariant(normalizedOriginal);
  const packaging =
    structuredPackaging(product) ?? parsePackagingFromName(product.name);
  const withoutBrand = removePhrase(comparableOriginal, normalizedBrand);
  const normalizedName = removePackaging(withoutBrand);
  const baseName = removePhrase(normalizedName, variant);
  const candidateGtin = product.gtin ?? product.ean;
  return {
    originalName: product.name,
    normalizedName,
    baseName,
    ...(normalizedBrand === undefined ? {} : { normalizedBrand }),
    ...(variant === undefined ? {} : { variant }),
    ...(product.category === undefined
      ? {}
      : { normalizedCategory: normalizeText(product.category) }),
    ...(isValidGtin(candidateGtin) ? { gtin: candidateGtin } : {}),
    packaging,
  };
}

function stripPackagingExpressions(value: string): string {
  const units =
    "mg|miligramos?|kg|kilos?|kilogramos?|g|gr|gramos?|ml|mililitros?|cl|centilitros?|l|litros?|ud(?:s)?|unidades?|piezas?";
  return value
    .replace(
      new RegExp(
        `\\b(?:pack\\s+)?\\d+\\s*(?:x|×)\\s*\\d+(?:[.,]\\d+)?\\s*(?:${units})\\b`,
        "gi",
      ),
      " ",
    )
    .replace(
      new RegExp(
        `\\b\\d+\\s+(?:botellas?|latas?|botes?|bricks?|briks?|paquetes?|unidades?|uds?\\.?)\\s+(?:de\\s+)?\\d+(?:[.,]\\d+)?\\s*(?:${units})\\b`,
        "gi",
      ),
      " ",
    )
    .replace(new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*(?:${units})\\b`, "gi"), " ");
}

function structuredPackaging(
  product: RetailerProduct,
): NormalizedPackaging | undefined {
  const size = structuredQuantity(product.packageSize, product.packageUnit);
  const explicitTotal = structuredQuantity(
    product.totalAmount,
    product.packageUnit,
  );
  if (
    size === undefined &&
    explicitTotal === undefined &&
    product.packageCount === undefined
  ) {
    return undefined;
  }
  const count = validCount(product.packageCount);
  const calculatedTotal =
    explicitTotal ??
    (size === undefined
      ? undefined
      : normalizeQuantity(size.baseAmount * (count ?? 1), size.baseUnit));
  return {
    ...(count === undefined ? {} : { packageCount: count }),
    ...(size === undefined ? {} : { packageSize: size }),
    ...(calculatedTotal === undefined ? {} : { totalAmount: calculatedTotal }),
    source: "STRUCTURED",
  };
}

function structuredQuantity(
  amount: number | undefined,
  unit: ProductUnit | undefined,
) {
  return amount === undefined || unit === undefined
    ? undefined
    : normalizeQuantity(amount, unit);
}

function validCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function extractVariant(value: string): string | undefined {
  return VARIANTS.find((candidate) => value.includes(candidate));
}

function removePhrase(value: string, phrase: string | undefined): string {
  if (phrase === undefined || phrase === "") return value;
  const phraseTokens = new Set(phrase.split(" "));
  return value
    .split(" ")
    .filter((token) => !phraseTokens.has(token))
    .join(" ")
    .trim();
}

function removePackaging(value: string): string {
  const unitTokens = new Set([
    "mg",
    "g",
    "gr",
    "kg",
    "ml",
    "cl",
    "l",
    "ud",
    "uds",
    "unidad",
    "unidades",
    "miligramo",
    "miligramos",
    "gramo",
    "gramos",
    "kilo",
    "kilos",
    "kilogramo",
    "kilogramos",
    "mililitro",
    "mililitros",
    "centilitro",
    "centilitros",
    "litro",
    "litros",
  ]);
  const tokens = value.split(" ");
  return tokens
    .filter((token, index) => {
      if (PACKAGING_WORDS.has(token) || unitTokens.has(token) || token === "x")
        return false;
      if (/^\d+(?:\.\d+)?$/.test(token)) {
        const adjacent = tokens[index + 1];
        const previous = tokens[index - 1];
        return (
          !(
            adjacent !== undefined &&
            (unitTokens.has(adjacent) || adjacent === "x")
          ) && previous !== "x"
        );
      }
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function optionalNormalized(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeText(value);
  return normalized === "" ? undefined : normalized;
}
