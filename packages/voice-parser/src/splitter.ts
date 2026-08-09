import { ADJACENT_STAPLES, UNIT_ALIASES } from "./lexicon.js";
import { isNumberStart } from "./numbers.js";

export function splitTranscript(rawText: string): string[] {
  const commaSafe = rawText.replace(/(?<!\d)[,;](?!\d)/g, "|");
  const initial = commaSafe
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return initial.flatMap(splitConjunction).flatMap(splitAdjacentStaples);
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

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
