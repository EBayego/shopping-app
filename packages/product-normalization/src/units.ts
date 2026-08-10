import type { ProductUnit } from "@shopping-app/domain";

import type { NormalizedPackaging, NormalizedQuantity } from "./types.ts";

const UNIT_ALIASES: Readonly<Record<string, ProductUnit>> = {
  mg: "g",
  miligramo: "g",
  miligramos: "g",
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
  cl: "ml",
  centilitro: "ml",
  centilitros: "ml",
  l: "l",
  litro: "l",
  litros: "l",
  ud: "unit",
  uds: "unit",
  unidad: "unit",
  unidades: "unit",
  pieza: "unit",
  piezas: "unit",
};

const QUANTITY_UNIT_PATTERN =
  "mg|miligramos?|kg|kilos?|kilogramos?|g|gr|gramos?|ml|mililitros?|cl|centilitros?|l|litros?|ud(?:s)?|unidades?|piezas?";

export function normalizeQuantity(
  amount: number,
  rawUnit: string,
): NormalizedQuantity | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const token = rawUnit.toLocaleLowerCase("es-ES").replaceAll(".", "").trim();
  const unit = UNIT_ALIASES[token];
  if (unit === undefined) return undefined;

  let baseAmount: number;
  let baseUnit: NormalizedQuantity["baseUnit"];
  let dimension: NormalizedQuantity["dimension"];
  if (token === "mg" || token.startsWith("miligram")) {
    baseAmount = amount / 1000;
    baseUnit = "g";
    dimension = "MASS";
  } else if (unit === "kg") {
    baseAmount = amount * 1000;
    baseUnit = "g";
    dimension = "MASS";
  } else if (unit === "g") {
    baseAmount = amount;
    baseUnit = "g";
    dimension = "MASS";
  } else if (token === "cl" || token.startsWith("centilitr")) {
    baseAmount = amount * 10;
    baseUnit = "ml";
    dimension = "VOLUME";
  } else if (unit === "l") {
    baseAmount = amount * 1000;
    baseUnit = "ml";
    dimension = "VOLUME";
  } else if (unit === "ml") {
    baseAmount = amount;
    baseUnit = "ml";
    dimension = "VOLUME";
  } else {
    baseAmount = amount;
    baseUnit = "unit";
    dimension = "COUNT";
  }

  const preferred = preferredQuantity(baseAmount, baseUnit);
  return { ...preferred, baseAmount, baseUnit, dimension };
}

export function parsePackagingFromName(name: string): NormalizedPackaging {
  const normalized = name.normalize("NFKC");
  const packPattern = new RegExp(
    `\\b(?:pack\\s+)?(\\d+)\\s*(?:x|×)\\s*(\\d+(?:[.,]\\d+)?)\\s*(${QUANTITY_UNIT_PATTERN})\\b`,
    "i",
  );
  const bottlePattern = new RegExp(
    `\\b(\\d+)\\s+(?:botellas?|latas?|botes?|bricks?|briks?|paquetes?|unidades?|uds?\\.?)\\s+(?:de\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(${QUANTITY_UNIT_PATTERN})\\b`,
    "i",
  );
  const packMatch =
    normalized.match(packPattern) ?? normalized.match(bottlePattern);
  if (
    packMatch?.[1] !== undefined &&
    packMatch[2] !== undefined &&
    packMatch[3] !== undefined
  ) {
    const packageCount = Number(packMatch[1]);
    const packageSize = normalizeQuantity(
      parseDecimal(packMatch[2]),
      packMatch[3],
    );
    if (
      Number.isInteger(packageCount) &&
      packageCount > 0 &&
      packageSize !== undefined
    ) {
      const totalAmount = normalizeQuantity(
        packageCount * packageSize.baseAmount,
        packageSize.baseUnit,
      );
      return {
        packageCount,
        packageSize,
        ...(totalAmount === undefined ? {} : { totalAmount }),
        source: "NAME",
      };
    }
  }

  const singlePattern = new RegExp(
    `\\b(\\d+(?:[.,]\\d+)?)\\s*(${QUANTITY_UNIT_PATTERN})\\b`,
    "i",
  );
  const singleMatch = normalized.match(singlePattern);
  if (singleMatch?.[1] === undefined || singleMatch[2] === undefined) {
    return { source: "UNKNOWN" };
  }
  const packageSize = normalizeQuantity(
    parseDecimal(singleMatch[1]),
    singleMatch[2],
  );
  return packageSize === undefined
    ? { source: "UNKNOWN" }
    : { packageSize, totalAmount: packageSize, source: "NAME" };
}

export function quantitiesCompatible(
  left: NormalizedQuantity | undefined,
  right: NormalizedQuantity | undefined,
  relativeTolerance = 0.02,
): boolean | undefined {
  if (left === undefined || right === undefined) return undefined;
  if (left.dimension !== right.dimension) return false;
  const maximum = Math.max(left.baseAmount, right.baseAmount);
  return (
    Math.abs(left.baseAmount - right.baseAmount) / maximum <= relativeTolerance
  );
}

function preferredQuantity(
  baseAmount: number,
  baseUnit: NormalizedQuantity["baseUnit"],
): Pick<NormalizedQuantity, "amount" | "unit"> {
  if (baseUnit === "g" && baseAmount >= 1000) {
    return { amount: baseAmount / 1000, unit: "kg" };
  }
  if (baseUnit === "ml" && baseAmount >= 1000) {
    return { amount: baseAmount / 1000, unit: "l" };
  }
  return { amount: baseAmount, unit: baseUnit };
}

function parseDecimal(value: string): number {
  return Number(value.replace(",", "."));
}
