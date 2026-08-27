const SMALL_CARDINALS: Readonly<Record<string, number>> = {
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
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const TENS: Readonly<Record<string, number>> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const HUNDREDS: Readonly<Record<string, number>> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
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
  const integer = parseIntegerAt(tokens, index);
  const fraction = FRACTIONS[token];
  const initial = numeric ?? integer?.value ?? fraction;
  if (initial === undefined || !Number.isFinite(initial) || initial <= 0) {
    return undefined;
  }

  const initialConsumed = numeric !== undefined ? 1 : (integer?.consumed ?? 1);
  const isFraction = fraction !== undefined;
  const conjunction = tokens[index + initialConsumed];
  const trailingFraction = tokens[index + initialConsumed + 1];
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
      consumed: initialConsumed + 2,
      fraction: false,
    };
  }

  if (
    !isFraction &&
    (tokens[index + initialConsumed] === "coma" ||
      tokens[index + initialConsumed] === "punto") &&
    tokens[index + initialConsumed + 1] !== undefined
  ) {
    const decimalIndex = index + initialConsumed + 1;
    const decimalToken = tokens[decimalIndex];
    if (decimalToken === undefined) return undefined;
    const decimalDigits = numberAsDigits(decimalToken);
    if (decimalDigits !== undefined) {
      return {
        value: Number(`${initial}.${decimalDigits}`),
        consumed: initialConsumed + 2,
        fraction: false,
      };
    }
  }

  return { value: initial, consumed: initialConsumed, fraction: isFraction };
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
  const value = SMALL_CARDINALS[token];
  return value === undefined ? undefined : String(value);
}

function parseIntegerAt(
  tokens: readonly string[],
  index: number,
): { value: number; consumed: number } | undefined {
  const first = tokens[index];
  if (first === undefined) return undefined;

  const small = SMALL_CARDINALS[first];
  if (small !== undefined) return { value: small, consumed: 1 };

  const tens = TENS[first];
  if (tens !== undefined) {
    const unit = SMALL_CARDINALS[tokens[index + 2] ?? ""];
    if (tokens[index + 1] === "y" && unit !== undefined && unit < 10) {
      return { value: tens + unit, consumed: 3 };
    }
    return { value: tens, consumed: 1 };
  }

  const hundreds = HUNDREDS[first];
  if (hundreds === undefined) return undefined;
  const remainder = parseIntegerUnderHundred(tokens, index + 1);
  return remainder === undefined
    ? { value: hundreds, consumed: 1 }
    : {
        value: hundreds + remainder.value,
        consumed: 1 + remainder.consumed,
      };
}

function parseIntegerUnderHundred(
  tokens: readonly string[],
  index: number,
): { value: number; consumed: number } | undefined {
  const token = tokens[index];
  if (token === undefined) return undefined;
  const small = SMALL_CARDINALS[token];
  if (small !== undefined) return { value: small, consumed: 1 };
  const tens = TENS[token];
  if (tens === undefined) return undefined;
  const unit = SMALL_CARDINALS[tokens[index + 2] ?? ""];
  return tokens[index + 1] === "y" && unit !== undefined && unit < 10
    ? { value: tens + unit, consumed: 3 }
    : { value: tens, consumed: 1 };
}
