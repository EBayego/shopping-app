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
import {
  correctLikelyRecognitionErrors,
  removeSpeechNoise,
} from "./speech-noise.ts";
import { splitTranscript } from "./splitter.ts";
import type { ShoppingIntentDraft, ShoppingIntentUnit } from "./types.ts";

const LEADING_FILLERS = new Set([
  "agrega",
  "anademe",
  "apunta",
  "apuntame",
  "comprar",
  "quiero",
  "necesito",
  "compra",
  "comprame",
  "dame",
  "gustaria",
  "anadir",
  "me",
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
    if (startsNewItemAfterSpuriousConnector(current, next)) {
      merged.push(current.replace(/\s+(?:de|del)\s*$/i, ""));
      current = next;
      continue;
    }
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
  let tokens = correctLikelyRecognitionErrors(
    removeSpeechNoise(tokenize(rawText)),
  );
  while (tokens[0] !== undefined && LEADING_FILLERS.has(tokens[0]))
    tokens = tokens.slice(1);
  if (tokens[0] === "y" && tokens.length > 1) tokens = tokens.slice(1);
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
  } else {
    const implicitContainer = CONTAINER_ALIASES[tokens[cursor] ?? ""];
    if (implicitContainer !== undefined) {
      draft.packageCount = 1;
      hasPackaging = true;
      cursor += 1;
      if (tokens[cursor] === "de" || tokens[cursor] === "del") cursor += 1;
    }
  }

  let productTokens = tokens.slice(cursor);
  if (hasPackaging) {
    const nestedContainer = parseNestedContainer(productTokens);
    if (nestedContainer !== undefined) {
      draft.packageCount = (draft.packageCount ?? 1) * nestedContainer.count;
      productTokens = productTokens.slice(nestedContainer.next);
      if (productTokens[0] === "de") productTokens = productTokens.slice(1);
    } else {
      const inner = parseQuantity(productTokens, 0, true);
      if (inner !== undefined) {
        draft.packageSize = inner.value;
        draft.packageUnit = inner.unit;
        draft.totalAmount = (draft.packageCount ?? 1) * inner.value;
        productTokens = productTokens.slice(inner.next);
        if (productTokens[0] === "de") productTokens = productTokens.slice(1);
      }
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
  const explicitBrandCandidate = extractExplicitValue(productTokens, "marca");
  const explicitBrandMatch =
    explicitBrandCandidate === undefined
      ? undefined
      : findBrand(explicitBrandCandidate.valueTokens);
  const explicitBrand =
    explicitBrandCandidate !== undefined && explicitBrandMatch !== undefined
      ? explicitBrandCandidate
      : undefined;
  const brand = findBrand(productTokens);
  if (explicitBrand !== undefined && explicitBrandMatch !== undefined) {
    draft.brandPreference = explicitBrandMatch.value;
    productTokens = explicitBrand.remainingTokens;
  } else if (brand !== undefined) {
    draft.brandPreference = brand.value;
    if (brand.value !== "Coca-Cola") {
      productTokens = removeBrandTokens(productTokens, brand.value);
    }
  }

  const explicitVariant = extractExplicitVariant(productTokens);
  if (draft.variant === undefined && explicitVariant !== undefined) {
    draft.variant = explicitVariant.valueTokens.join(" ");
    productTokens = explicitVariant.remainingTokens;
  }

  productTokens = trimConnectors(productTokens);
  const unexpectedStructure = containsStructuredQuantity(productTokens);
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
    unexpectedStructure,
  });

  if (draft.product === undefined && leadingNumber === undefined)
    return undefined;
  if (
    leadingNumber === undefined &&
    !knownBareProduct &&
    brand === undefined &&
    explicitBrand === undefined &&
    !hasPackaging &&
    !allowUnknownBareProduct
  )
    return undefined;
  return { ...draft, confidence };
}

function containsStructuredQuantity(tokens: readonly string[]): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    const number = parseNumberAt(tokens, index);
    if (number === undefined) continue;
    let quantityIndex = index + number.consumed;
    if (tokens[quantityIndex] === "de") quantityIndex += 1;
    const quantityWord = tokens[quantityIndex] ?? "";
    if (
      UNIT_ALIASES[quantityWord] !== undefined ||
      CONTAINER_ALIASES[quantityWord] !== undefined ||
      COLLECTIVE_QUANTITIES[quantityWord] !== undefined
    ) {
      return true;
    }
  }
  return false;
}

function isIncompleteSpeechSegment(segment: string): boolean {
  const normalized = tokenize(segment);
  const last = normalized.at(-1);
  if (last === "y") return true;
  if (last === "de" || last === "del") return true;
  const drafts = parseItems(segment, true);
  return (
    drafts.length === 0 || drafts.some((draft) => draft.product === undefined)
  );
}

function startsNewItemAfterSpuriousConnector(
  current: string,
  next: string,
): boolean {
  const currentTokens = tokenize(current);
  if (!hasCompletedPackageBeforeTrailingConnector(currentTokens)) return false;
  const nextTokens = tokenize(next);
  let start = 0;
  if (nextTokens[start] === "y") start += 1;
  if (nextTokens[start] === "de" || nextTokens[start] === "del") start += 1;
  return startsContainerOrCollectivePhrase(nextTokens, start);
}

function hasCompletedPackageBeforeTrailingConnector(
  tokens: readonly string[],
): boolean {
  const last = tokens.at(-1);
  if (last !== "de" && last !== "del") return false;
  const completedDrafts = parseItems(tokens.slice(0, -1).join(" "), true);
  const completedPackage = completedDrafts.at(-1);
  return (
    completedPackage?.product !== undefined &&
    completedPackage.packageCount !== undefined &&
    completedPackage.packageSize !== undefined &&
    completedPackage.packageUnit !== undefined
  );
}

function isContinuationSegment(segment: string): boolean {
  const tokens = tokenize(segment);
  const first = tokens[0];
  if (first === "de" || first === "del") {
    if (startsContainerOrCollectivePhrase(tokens, 1)) return false;
    return true;
  }
  if (first === "con" || first === "sin") {
    return true;
  }
  return parseItems(segment, true).length === 0;
}

function startsContainerOrCollectivePhrase(
  tokens: readonly string[],
  index: number,
): boolean {
  const number = parseNumberAt(tokens, index);
  if (number === undefined) return false;
  const quantityWord = tokens[index + number.consumed] ?? "";
  return (
    CONTAINER_ALIASES[quantityWord] !== undefined ||
    COLLECTIVE_QUANTITIES[quantityWord] !== undefined
  );
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

function parseNestedContainer(
  tokens: readonly string[],
): { count: number; next: number } | undefined {
  const number = parseNumberAt(tokens, 0);
  if (number === undefined) return undefined;
  const containerIndex = number.consumed;
  if (CONTAINER_ALIASES[tokens[containerIndex] ?? ""] === undefined) {
    return undefined;
  }
  const connector = tokens[containerIndex + 1];
  return {
    count: number.value,
    next:
      connector === "de" || connector === "del"
        ? containerIndex + 2
        : containerIndex + 1,
  };
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

interface ExplicitValue {
  remainingTokens: string[];
  valueTokens: string[];
}

function extractExplicitValue(
  tokens: readonly string[],
  marker: string,
): ExplicitValue | undefined {
  const markerIndex = tokens.indexOf(marker);
  if (markerIndex < 0 || markerIndex === tokens.length - 1) return undefined;
  let start = markerIndex;
  if (tokens[start - 1] === "la") start -= 1;
  if (tokens[start - 1] === "de") start -= 1;
  return {
    remainingTokens: [...tokens.slice(0, start)],
    valueTokens: [...tokens.slice(markerIndex + 1)],
  };
}

function extractExplicitVariant(
  tokens: readonly string[],
): ExplicitValue | undefined {
  for (const marker of ["sabor", "variedad", "tipo"] as const) {
    const extracted = extractExplicitValue(tokens, marker);
    if (extracted !== undefined) return extracted;
  }
  return undefined;
}
