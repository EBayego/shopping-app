import {
  ADJACENT_STAPLES,
  COLLECTIVE_QUANTITIES,
  CONTAINER_ALIASES,
  KNOWN_BARE_PRODUCTS,
  UNIT_ALIASES,
} from "./lexicon.ts";
import { isNumberStart, parseNumberAt } from "./numbers.ts";

export function splitTranscript(rawText: string): string[] {
  const commaSafe = rawText.replace(/(?<!\d)[,;](?!\d)/g, "|");
  const initial = commaSafe
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
  for (let index = 1; index < words.length - 1; index += 1) {
    if (normalize(words[index] ?? "") !== "y") continue;
    const rightFirst = normalize(words[index + 1] ?? "");
    const leftLast = normalize(words[index - 1] ?? "");
    if (
      (rightFirst === "medio" ||
        rightFirst === "media" ||
        rightFirst === "cuarto") &&
      UNIT_ALIASES[leftLast] !== undefined
    ) {
      continue;
    }
    if (isNumberStart(rightFirst)) {
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
  const first = normalize(words[0] ?? "");
  const second = normalize(words[1] ?? "");
  if (ADJACENT_STAPLES.has(first) && ADJACENT_STAPLES.has(second)) {
    return [words[0] ?? "", words.slice(1).join(" ")];
  }
  return [part];
}

function splitImplicitQuantityStarts(part: string): string[] {
  const words = part.trim().split(/\s+/);
  const normalizedWords = words.map(normalize);
  for (let index = 1; index < words.length; index += 1) {
    const previous = normalizedWords[index - 1];
    if (
      previous === "de" ||
      previous === "del" ||
      previous === "coma" ||
      previous === "punto"
    ) {
      continue;
    }
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
