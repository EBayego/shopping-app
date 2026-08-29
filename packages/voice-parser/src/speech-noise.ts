const FILLER_WORDS = new Set([
  "ah",
  "bueno",
  "digamos",
  "este",
  "esto",
  "luego",
  "pues",
  "tambien",
  "vale",
]);

const FILLER_PHRASES: readonly (readonly string[])[] = [
  ["a", "ver"],
  ["o", "sea"],
  ["por", "favor"],
];

export function removeSpeechNoise(tokens: readonly string[]): string[] {
  const withoutPhrases: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const phrase = FILLER_PHRASES.find((candidate) =>
      candidate.every((token, offset) => tokens[index + offset] === token),
    );
    if (phrase !== undefined) {
      index += phrase.length - 1;
      continue;
    }
    const token = tokens[index];
    if (token !== undefined && !isSpeechFiller(token)) {
      withoutPhrases.push(token);
    }
  }
  return withoutPhrases;
}

export function correctLikelyRecognitionErrors(
  tokens: readonly string[],
): string[] {
  const corrected = [...tokens];
  for (let index = 0; index < corrected.length; index += 1) {
    const token = corrected[index];
    const next = corrected[index + 1];
    if (token === "toma" && (next === "triturado" || next === "triturada")) {
      corrected[index] = "tomate";
      continue;
    }
    if (
      (token === "zona" || token === "zonas") &&
      corrected[index + 1] === "de" &&
      corrected[index + 2] === "huevos"
    ) {
      corrected[index] = token === "zona" ? "docena" : "docenas";
    }
  }
  return corrected;
}

export function isSpeechFiller(token: string): boolean {
  return (
    FILLER_WORDS.has(token) || /^(?:e+h+m*|e+m+|h?m{2,}|u+h+m*)$/.test(token)
  );
}
