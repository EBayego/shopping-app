import {
  COLLECTIVE_QUANTITIES,
  CONTAINER_ALIASES,
  KNOWN_BARE_PRODUCTS,
  UNIT_ALIASES,
} from "./lexicon.ts";
import { isNumberStart, parseNumberAt } from "./numbers.ts";
import { isSpeechFiller } from "./speech-noise.ts";

export function splitTranscript(rawText: string): string[] {
  const punctuationSafe = replaceSpokenSeparators(
    rawText.replace(/[;:!?]+|(?<!\d)[,.]+|[,.]+(?!\d)/g, "|"),
  );
  const initial = punctuationSafe
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return initial
    .flatMap(splitConjunction)
    .flatMap(splitImplicitQuantityStarts)
    .flatMap(splitAdjacentStaples);
}

function splitConjunction(part: string): string[] {
  const words = part.split(/\s+/);
  const normalizedWords = words.map((word) => normalize(word));
  for (let index = 1; index < words.length - 1; index += 1) {
    if (normalizedWords[index] !== "y") continue;
    if (isInsideNumber(normalizedWords, index)) continue;
    const rightIndex = nextMeaningfulIndex(normalizedWords, index + 1);
    const rightFirst = normalizedWords[rightIndex] ?? "";
    const leftIndex = previousMeaningfulIndex(normalizedWords, index - 1);
    const leftLast = normalizedWords[leftIndex] ?? "";
    if (
      (rightFirst === "medio" ||
        rightFirst === "media" ||
        rightFirst === "cuarto") &&
      UNIT_ALIASES[leftLast] !== undefined
    ) {
      continue;
    }
    if (isNumberStart(rightFirst) || KNOWN_BARE_PRODUCTS.has(rightFirst)) {
      return [
        words.slice(0, index).join(" "),
        words.slice(index + 1).join(" "),
      ].flatMap(splitConjunction);
    }
  }
  return [part];
}

function splitAdjacentStaples(part: string): string[] {
  const words = part.trim().split(/\s+/);
  if (words.length < 2) return [part];
  const normalizedWords = words.map(normalize);
  const firstMeaningful = nextMeaningfulIndex(normalizedWords, 0);
  if (!KNOWN_BARE_PRODUCTS.has(normalizedWords[firstMeaningful] ?? "")) {
    return [part];
  }
  for (let index = firstMeaningful + 1; index < words.length; index += 1) {
    const current = normalizedWords[index] ?? "";
    const previous =
      normalizedWords[previousMeaningfulIndex(normalizedWords, index - 1)];
    if (
      KNOWN_BARE_PRODUCTS.has(current) &&
      previous !== "de" &&
      previous !== "del" &&
      previous !== "con" &&
      previous !== "sin"
    ) {
      return [
        words.slice(0, index).join(" "),
        ...splitAdjacentStaples(words.slice(index).join(" ")),
      ];
    }
  }
  return [part];
}

function splitImplicitQuantityStarts(part: string): string[] {
  const words = part.trim().split(/\s+/);
  const normalizedWords = words.map(normalize);
  for (let index = 1; index < words.length; index += 1) {
    const previousIndex = previousMeaningfulIndex(normalizedWords, index - 1);
    const previous = normalizedWords[previousIndex];
    if (previous === undefined) continue;
    if (
      previous === "de" ||
      previous === "del" ||
      previous === "coma" ||
      previous === "punto"
    ) {
      continue;
    }
    if (isInsideNumber(normalizedWords, index)) continue;
    if (!startsQuantifiedItem(normalizedWords, index)) continue;
    return [
      words.slice(0, index).join(" "),
      ...splitImplicitQuantityStarts(words.slice(index).join(" ")),
    ];
  }
  return [part];
}

function startsQuantifiedItem(
  words: readonly string[],
  index: number,
): boolean {
  const number = parseNumberAt(words, index);
  if (number === undefined) return false;
  let cursor = index + number.consumed;

  if (
    words[cursor] === "de" &&
    UNIT_ALIASES[words[cursor + 1] ?? ""] !== undefined
  ) {
    cursor += 1;
  }

  const quantityWord = words[cursor] ?? "";
  if (
    UNIT_ALIASES[quantityWord] !== undefined ||
    CONTAINER_ALIASES[quantityWord] !== undefined ||
    COLLECTIVE_QUANTITIES[quantityWord] !== undefined
  ) {
    cursor += 1;
    if (words[cursor] === "de" || words[cursor] === "del") cursor += 1;
    return cursor < words.length;
  }

  return KNOWN_BARE_PRODUCTS.has(quantityWord);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function nextMeaningfulIndex(words: readonly string[], start: number): number {
  let index = start;
  while (index < words.length && isBoundaryNoise(words[index] ?? "")) {
    index += 1;
  }
  return index;
}

function previousMeaningfulIndex(
  words: readonly string[],
  start: number,
): number {
  let index = start;
  while (index >= 0 && isBoundaryNoise(words[index] ?? "")) index -= 1;
  return index;
}

function isBoundaryNoise(token: string): boolean {
  return isSpeechFiller(token) || SPEECH_PREAMBLE.has(token);
}

function isInsideNumber(
  words: readonly string[],
  targetIndex: number,
): boolean {
  for (let index = 0; index < targetIndex; index += 1) {
    const number = parseNumberAt(words, index);
    if (number !== undefined && index + number.consumed > targetIndex) {
      return true;
    }
  }
  return false;
}

const SPEECH_PREAMBLE = new Set([
  "agrega",
  "anade",
  "anademe",
  "apunta",
  "apuntame",
  "bueno",
  "compra",
  "comprame",
  "comprar",
  "dame",
  "favor",
  "gustaria",
  "luego",
  "me",
  "necesito",
  "pon",
  "por",
  "quiero",
  "tambien",
]);

function replaceSpokenSeparators(text: string): string {
  const normalizedWords = text.trim().split(/\s+/).map(normalize);
  return text.replace(
    /\b(?:coma|punto|pausa)\b/gi,
    (separator, offset: number) => {
      const targetIndex = text
        .slice(0, offset)
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      return separator.toLocaleLowerCase("es") !== "pausa" &&
        isInsideNumber(normalizedWords, targetIndex)
        ? separator
        : "|";
    },
  );
}
