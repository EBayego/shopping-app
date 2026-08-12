import type { ShoppingIntentUnit } from "./types.ts";

export const UNIT_ALIASES: Readonly<Record<string, ShoppingIntentUnit>> = {
  g: "g",
  gr: "g",
  gramo: "g",
  gramos: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  ml: "ml",
  mililitro: "ml",
  mililitros: "ml",
  cl: "cl",
  centilitro: "cl",
  centilitros: "cl",
  l: "l",
  litro: "l",
  litros: "l",
  unidad: "unit",
  unidades: "unit",
};

export const CONTAINER_ALIASES: Readonly<Record<string, ShoppingIntentUnit>> = {
  bote: "pack",
  botes: "pack",
  botella: "bottle",
  botellas: "bottle",
  lata: "can",
  latas: "can",
  pack: "pack",
  packs: "pack",
  paquete: "pack",
  paquetes: "pack",
};

export const COLLECTIVE_QUANTITIES: Readonly<Record<string, number>> = {
  docena: 12,
  docenas: 12,
};

export interface LexiconMatch {
  value: string;
  length: number;
}

const BRANDS: readonly (readonly [readonly string[], string])[] = [
  [["coca", "cola"], "Coca-Cola"],
  [["central", "lechera", "asturiana"], "Central Lechera Asturiana"],
  [["leche", "pascual"], "Pascual"],
  [["pascual"], "Pascual"],
  [["danone"], "Danone"],
  [["nestle"], "Nestlé"],
  [["hacendado"], "Hacendado"],
  [["campofrio"], "Campofrío"],
  [["kaiku"], "Kaiku"],
];

const VARIANTS: readonly (readonly [readonly string[], string])[] = [
  [["sin", "lactosa"], "sin lactosa"],
  [["sin", "azucar"], "sin azúcar"],
  [["semidesnatado"], "semidesnatado"],
  [["semidesnatada"], "semidesnatada"],
  [["desnatado"], "desnatado"],
  [["desnatada"], "desnatada"],
  [["entero"], "entero"],
  [["entera"], "entera"],
  [["griegos"], "griego"],
  [["griego"], "griego"],
  [["griega"], "griego"],
  [["zero"], "zero"],
  [["light"], "light"],
  [["integral"], "integral"],
  [["ecologico"], "ecológico"],
  [["ecologica"], "ecológico"],
];

export const KNOWN_BARE_PRODUCTS = new Set([
  "agua",
  "arroz",
  "azucar",
  "cafe",
  "carne",
  "cereales",
  "cerveza",
  "detergente",
  "huevo",
  "huevos",
  "leche",
  "pan",
  "pasta",
  "pollo",
  "queso",
  "sal",
  "tomate",
  "tomates",
  "yogur",
  "yogures",
]);

export const ADJACENT_STAPLES = new Set(["pan", "huevos", "leche"]);

export function findBrand(tokens: readonly string[]): LexiconMatch | undefined {
  return findLexiconMatch(tokens, BRANDS);
}

export function findVariant(
  tokens: readonly string[],
): LexiconMatch | undefined {
  return findLexiconMatch(tokens, VARIANTS);
}

function findLexiconMatch(
  tokens: readonly string[],
  entries: readonly (readonly [readonly string[], string])[],
): LexiconMatch | undefined {
  for (const [phrase, value] of entries) {
    if (containsSequence(tokens, phrase))
      return { value, length: phrase.length };
  }
  return undefined;
}

export function removeSequence(
  tokens: readonly string[],
  value: string,
): string[] {
  const phrase = value.split(" ");
  const index = sequenceIndex(tokens, phrase);
  return index < 0
    ? [...tokens]
    : [...tokens.slice(0, index), ...tokens.slice(index + phrase.length)];
}

function containsSequence(
  tokens: readonly string[],
  phrase: readonly string[],
): boolean {
  return sequenceIndex(tokens, phrase) >= 0;
}

function sequenceIndex(
  tokens: readonly string[],
  phrase: readonly string[],
): number {
  return tokens.findIndex((_, index) =>
    phrase.every((token, offset) => tokens[index + offset] === token),
  );
}
