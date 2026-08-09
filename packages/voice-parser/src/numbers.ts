const CARDINALS: Readonly<Record<string, number>> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
};

const FRACTIONS: Readonly<Record<string, number>> = {
  medio: 0.5,
  media: 0.5,
  cuarto: 0.25,
};

export interface ParsedNumber {
  value: number;
  consumed: number;
  fraction: boolean;
}

export function parseNumberAt(
  tokens: readonly string[],
  index: number,
): ParsedNumber | undefined {
  const token = tokens[index];
  if (token === undefined) return undefined;

  const numeric = parseNumericToken(token);
  const cardinal = CARDINALS[token];
  const fraction = FRACTIONS[token];
  const initial = numeric ?? cardinal ?? fraction;
  if (initial === undefined || !Number.isFinite(initial) || initial <= 0) {
    return undefined;
  }

  const isFraction = fraction !== undefined;
  const conjunction = tokens[index + 1];
  const trailingFraction = tokens[index + 2];
  if (
    !isFraction &&
    conjunction === "y" &&
    trailingFraction !== undefined &&
    FRACTIONS[trailingFraction] !== undefined
  ) {
    const fractionValue = FRACTIONS[trailingFraction];
    if (fractionValue === undefined) return undefined;
    return {
      value: initial + fractionValue,
      consumed: 3,
      fraction: false,
    };
  }

  if (
    !isFraction &&
    tokens[index + 1] === "coma" &&
    tokens[index + 2] !== undefined
  ) {
    const decimalToken = tokens[index + 2];
    if (decimalToken === undefined) return undefined;
    const decimalDigits = numberAsDigits(decimalToken);
    if (decimalDigits !== undefined) {
      return {
        value: Number(`${initial}.${decimalDigits}`),
        consumed: 3,
        fraction: false,
      };
    }
  }

  return { value: initial, consumed: 1, fraction: isFraction };
}

export function isNumberStart(token: string | undefined): boolean {
  return token !== undefined && parseNumberAt([token], 0) !== undefined;
}

function parseNumericToken(token: string): number | undefined {
  if (!/^\d+(?:[.,]\d+)?$/.test(token)) return undefined;
  return Number(token.replace(",", "."));
}

function numberAsDigits(token: string): string | undefined {
  if (/^\d+$/.test(token)) return token;
  const value = CARDINALS[token];
  return value === undefined ? undefined : String(value);
}
