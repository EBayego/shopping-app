import { classifyConfidence } from "./confidence.ts";
import {
  COLLECTIVE_QUANTITIES,
  CONTAINER_ALIASES,
  findBrand,
  findVariant,
  KNOWN_BARE_PRODUCTS,
  removeSequence,
  UNIT_ALIASES,
} from "./lexicon.ts";
import { parseNumberAt } from "./numbers.ts";
import { splitTranscript } from "./splitter.ts";
import type { ShoppingIntentDraft, ShoppingIntentUnit } from "./types.ts";

const LEADING_FILLERS = new Set([
  "quiero",
  "necesito",
  "compra",
  "comprame",
  "pon",
  "anade",
]);
const NON_PRODUCT_PHRASES = new Set([
  "hola",
  "gracias",
  "adios",
  "por favor",
  "dos por uno",
]);

interface Quantity {
  value: number;
  unit: ShoppingIntentUnit;
  next: number;
  fraction: boolean;
}

interface MutableDraft {
  rawText: string;
  product?: string;
  variant?: string;
  brandPreference?: string;
  requestedQuantity?: number;
  requestedUnit?: ShoppingIntentUnit;
  packageCount?: number;
  packageSize?: number;
  packageUnit?: ShoppingIntentUnit;
  totalAmount?: number;
}

export function parseShoppingIntents(text: string): ShoppingIntentDraft[] {
  return parseItems(text, false);
}

export function parseShoppingIntentSegments(
  rawSegments: readonly string[],
): ShoppingIntentDraft[] {
  const segments = rawSegments.map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return [];
  if (segments.length === 1) return parseShoppingIntents(segments[0] ?? "");

  const merged: string[] = [];
  let current = segments[0] ?? "";
  for (const next of segments.slice(1)) {
    if (isIncompleteSpeechSegment(current) || isContinuationSegment(next)) {
      current = `${current} ${next}`;
      continue;
    }
    merged.push(current);
    current = next;
  }
  merged.push(current);
  return merged.flatMap((segment) => parseItems(segment, true));
}

function parseItems(
  text: string,
  allowUnknownBareProduct: boolean,
): ShoppingIntentDraft[] {
  if (text.trim() === "") return [];
  return splitTranscript(text)
    .map((item) => parseItem(item, allowUnknownBareProduct))
    .filter((draft): draft is ShoppingIntentDraft => draft !== undefined);
}

function parseItem(
  rawItem: string,
  allowUnknownBareProduct: boolean,
): ShoppingIntentDraft | undefined {
  const rawText = rawItem.trim();
  let tokens = tokenize(rawText);
  while (tokens[0] !== undefined && LEADING_FILLERS.has(tokens[0]))
    tokens = tokens.slice(1);
  if (tokens[0] === "de") tokens = tokens.slice(1);
  if (tokens.length === 0 || NON_PRODUCT_PHRASES.has(tokens.join(" ")))
    return undefined;

  const draft: MutableDraft = { rawText };
  let cursor = 0;
  let hasMeasurement = false;
  let hasPackaging = false;
  let hasCount = false;
  let hasCollective = false;
  let ambiguousFraction = false;

  const leadingNumber = parseNumberAt(tokens, cursor);
  if (leadingNumber !== undefined) {
    cursor += leadingNumber.consumed;
    if (tokens[cursor] === "de" && unitAt(tokens, cursor + 1) !== undefined)
      cursor += 1;
    const container = CONTAINER_ALIASES[tokens[cursor] ?? ""];
    const collective = COLLECTIVE_QUANTITIES[tokens[cursor] ?? ""];
    if (collective !== undefined) {
      draft.requestedQuantity = leadingNumber.value * collective;
      draft.requestedUnit = "unit";
      draft.totalAmount = draft.requestedQuantity;
      hasCount = true;
      hasCollective = true;
      cursor += 1;
      if (tokens[cursor] === "de" || tokens[cursor] === "del") cursor += 1;
    } else if (container !== undefined) {
      draft.packageCount = leadingNumber.value;
      hasPackaging = true;
      cursor += 1;
      if (tokens[cursor] === "de") cursor += 1;
    } else {
      const unit = unitAt(tokens, cursor);
      if (unit !== undefined) {
        draft.requestedQuantity = leadingNumber.value;
        draft.requestedUnit = unit;
        draft.totalAmount = leadingNumber.value;
        hasMeasurement = unit !== "unit";
        hasCount = unit === "unit";
        cursor += 1;
        if (tokens[cursor] === "y") {
          const trailingFraction = parseNumberAt(tokens, cursor + 1);
          if (trailingFraction?.fraction === true) {
            draft.requestedQuantity += trailingFraction.value;
            draft.totalAmount += trailingFraction.value;
            cursor += 1 + trailingFraction.consumed;
          }
        }
        if (tokens[cursor] === "de") cursor += 1;
      } else {
        draft.requestedQuantity = leadingNumber.value;
        draft.requestedUnit = "unit";
        hasCount = true;
      }
    }
    ambiguousFraction =
      leadingNumber.fraction &&
      !hasMeasurement &&
      !hasPackaging &&
      !hasCollective;
  }

  let productTokens = tokens.slice(cursor);
  if (hasPackaging) {
    const inner = parseQuantity(productTokens, 0, true);
    if (inner !== undefined) {
      draft.packageSize = inner.value;
      draft.packageUnit = inner.unit;
      draft.totalAmount = (draft.packageCount ?? 1) * inner.value;
      productTokens = productTokens.slice(inner.next);
      if (productTokens[0] === "de") productTokens = productTokens.slice(1);
    }
  }

  const trailing = findTrailingQuantity(productTokens);
  if (trailing !== undefined) {
    if (trailing.packaging) {
      draft.packageSize = trailing.quantity.value;
      draft.packageUnit = trailing.quantity.unit;
      const count = draft.packageCount ?? draft.requestedQuantity ?? 1;
      draft.totalAmount = count * trailing.quantity.value;
      if (
        draft.packageCount === undefined &&
        draft.requestedUnit === "unit" &&
        draft.requestedQuantity !== undefined
      ) {
        draft.packageCount = draft.requestedQuantity;
      }
      hasPackaging = true;
    } else {
      draft.requestedQuantity = trailing.quantity.value;
      draft.requestedUnit = trailing.quantity.unit;
      draft.totalAmount = trailing.quantity.value;
      hasMeasurement = trailing.quantity.unit !== "unit";
      hasCount = trailing.quantity.unit === "unit";
    }
    productTokens = productTokens.slice(0, trailing.start);
  }

  productTokens = trimConnectors(productTokens);
  const variant = findVariant(productTokens);
  if (variant !== undefined) {
    draft.variant = variant.value;
    productTokens = removeVariantTokens(productTokens, variant.value);
  }
  const brand = findBrand(productTokens);
  if (brand !== undefined) {
    draft.brandPreference = brand.value;
    if (brand.value !== "Coca-Cola") {
      productTokens = removeBrandTokens(productTokens, brand.value);
    }
  }

  productTokens = trimConnectors(productTokens);
  if (productTokens.length > 0)
    draft.product = normalizeProduct(productTokens.join(" "));

  const knownBareProduct =
    draft.product !== undefined &&
    KNOWN_BARE_PRODUCTS.has(draft.product.split(" ")[0] ?? "");
  const incomplete =
    tokens.at(-1) === "de" ||
    (draft.product === undefined && leadingNumber !== undefined);
  const confidence = classifyConfidence({
    hasProduct: draft.product !== undefined,
    hasExplicitMeasurement: hasMeasurement,
    hasPackaging,
    hasCount,
    incomplete,
    ambiguousFraction,
    knownBareProduct,
  });

  if (draft.product === undefined && leadingNumber === undefined)
    return undefined;
  if (
    leadingNumber === undefined &&
    !knownBareProduct &&
    brand === undefined &&
    !allowUnknownBareProduct
  )
    return undefined;
  return { ...draft, confidence };
}

function isIncompleteSpeechSegment(segment: string): boolean {
  const normalized = tokenize(segment);
  const last = normalized.at(-1);
  if (last === "de" || last === "del" || last === "y") return true;
  const drafts = parseItems(segment, true);
  return (
    drafts.length === 0 || drafts.some((draft) => draft.product === undefined)
  );
}

function isContinuationSegment(segment: string): boolean {
  const first = tokenize(segment)[0];
  if (first === "de" || first === "del" || first === "con" || first === "sin") {
    return true;
  }
  return parseItems(segment, true).length === 0;
}

function parseQuantity(
  tokens: readonly string[],
  index: number,
  allowImplicitUnits: boolean,
): Quantity | undefined {
  const number = parseNumberAt(tokens, index);
  if (number === undefined) return undefined;
  let next = index + number.consumed;
  if (tokens[next] === "de" && unitAt(tokens, next + 1) !== undefined)
    next += 1;
  const explicitUnit = unitAt(tokens, next);
  if (explicitUnit !== undefined) {
    return {
      value: number.value,
      unit: explicitUnit,
      next: next + 1,
      fraction: number.fraction,
    };
  }
  if (!allowImplicitUnits) return undefined;
  return { value: number.value, unit: "unit", next, fraction: number.fraction };
}

function findTrailingQuantity(
  tokens: readonly string[],
): { start: number; quantity: Quantity; packaging: boolean } | undefined {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const quantity = parseQuantity(tokens, index, false);
    if (quantity?.next === tokens.length) {
      const packaging = index > 0 && tokens[index - 1] === "de";
      return {
        start: packaging ? index - 1 : index,
        quantity,
        packaging,
      };
    }
  }
  return undefined;
}

function unitAt(
  tokens: readonly string[],
  index: number,
): ShoppingIntentUnit | undefined {
  return UNIT_ALIASES[tokens[index] ?? ""];
}

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/(\d)\s+(?:coma|punto)\s+(\d)/g, "$1,$2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9.,]+/g, " ")
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function trimConnectors(tokens: readonly string[]): string[] {
  let start = 0;
  let end = tokens.length;
  while (tokens[start] === "de" || tokens[start] === "del") start += 1;
  while (tokens[end - 1] === "de" || tokens[end - 1] === "del") end -= 1;
  return tokens.slice(start, end);
}

function normalizeProduct(product: string): string {
  const irregular: Readonly<Record<string, string>> = {
    huevos: "huevo",
    leches: "leche",
    yogures: "yogur",
  };
  const words = product.split(" ");
  const first = words[0];
  if (first !== undefined && irregular[first] !== undefined)
    words[0] = irregular[first];
  return words.join(" ");
}

function removeBrandTokens(tokens: readonly string[], brand: string): string[] {
  const normalizedBrand = normalize(brand).replace("-", " ");
  const direct = removeSequence(tokens, normalizedBrand);
  if (direct.length !== tokens.length) return direct;
  if (brand === "Pascual") return removeSequence(tokens, "leche pascual");
  return direct;
}

function removeVariantTokens(
  tokens: readonly string[],
  variant: string,
): string[] {
  if (variant === "griego") {
    for (const form of ["griegos", "griego", "griega"]) {
      const result = removeSequence(tokens, form);
      if (result.length !== tokens.length) return result;
    }
  }
  return removeSequence(tokens, normalize(variant));
}
