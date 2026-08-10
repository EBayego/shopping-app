import type { ProductUnit } from "@shopping-app/domain";

export interface AlcampoMoneyDto {
  amount: number;
  currency: string;
}

export interface AlcampoUnitPriceDto extends AlcampoMoneyDto {
  unit: ProductUnit;
}

export interface AlcampoQuantityDto {
  amount: number;
  unit: ProductUnit;
}

export interface AlcampoCatchweightDto {
  min: AlcampoQuantityDto;
  typical: AlcampoQuantityDto;
  max: AlcampoQuantityDto;
}

export interface AlcampoProductDto {
  productId: string;
  retailerProductId: string;
  type: string;
  name: string;
  brand: string;
  packSizeDescription: string;
  price: AlcampoMoneyDto;
  unitPrice: AlcampoUnitPriceDto;
  available: boolean;
  catchweight?: AlcampoCatchweightDto;
  categoryPath: string[];
  images: unknown[];
  promotions: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function decimal(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const normalized = value.trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function productUnit(value: unknown): ProductUnit | undefined {
  const normalized = nonEmptyString(value)?.toLocaleLowerCase("es-ES");
  switch (normalized) {
    case "unit":
    case "unidad":
    case "ud":
      return "unit";
    case "g":
    case "gram":
    case "gramo":
      return "g";
    case "kg":
    case "kilogram":
    case "kilogramo":
      return "kg";
    case "ml":
    case "millilitre":
    case "mililitro":
      return "ml";
    case "l":
    case "litre":
    case "litro":
      return "l";
    default:
      return undefined;
  }
}

function money(value: unknown): AlcampoMoneyDto | undefined {
  if (!isRecord(value)) return undefined;
  const amount = decimal(value.amount);
  const currency = nonEmptyString(value.currency)?.toUpperCase();
  if (amount === undefined || amount < 0 || currency === undefined)
    return undefined;
  return { amount, currency };
}

function unitPrice(value: unknown): AlcampoUnitPriceDto | undefined {
  const parsedMoney = money(value);
  if (!isRecord(value) || parsedMoney === undefined) return undefined;
  const unit = productUnit(value.unit);
  return unit === undefined ? undefined : { ...parsedMoney, unit };
}

function quantity(value: unknown): AlcampoQuantityDto | undefined {
  if (!isRecord(value)) return undefined;
  const amount = decimal(value.amount);
  const unit = productUnit(value.unit);
  if (amount === undefined || amount <= 0 || unit === undefined)
    return undefined;
  return { amount, unit };
}

function inGrams(quantityValue: AlcampoQuantityDto): number | undefined {
  if (quantityValue.unit === "g") return quantityValue.amount;
  if (quantityValue.unit === "kg") return quantityValue.amount * 1_000;
  return undefined;
}

function catchweight(value: unknown): AlcampoCatchweightDto | undefined {
  if (!isRecord(value)) return undefined;
  const min = quantity(value.min);
  const typical = quantity(value.typical);
  const max = quantity(value.max);
  if (min === undefined || typical === undefined || max === undefined)
    return undefined;
  const weights = [inGrams(min), inGrams(typical), inGrams(max)];
  if (
    weights.some((weight) => weight === undefined) ||
    (weights[0] as number) > (weights[1] as number) ||
    (weights[1] as number) > (weights[2] as number)
  ) {
    return undefined;
  }
  return { min, typical, max };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value as readonly unknown[]) {
    const parsed = nonEmptyString(item);
    if (parsed === undefined) return undefined;
    result.push(parsed);
  }
  return result;
}

export function parseAlcampoProduct(
  payload: unknown,
): AlcampoProductDto | undefined {
  if (!isRecord(payload)) return undefined;
  const productId = nonEmptyString(payload.productId);
  const retailerProductId = nonEmptyString(payload.retailerProductId);
  const type = nonEmptyString(payload.type);
  const name = nonEmptyString(payload.name);
  const brand = nonEmptyString(payload.brand);
  const packSizeDescription = nonEmptyString(payload.packSizeDescription);
  const parsedPrice = money(payload.price);
  const parsedUnitPrice = unitPrice(payload.unitPrice);
  const categoryPath = stringArray(payload.categoryPath);
  const parsedCatchweight =
    payload.catchweight == null ? undefined : catchweight(payload.catchweight);
  if (
    productId === undefined ||
    retailerProductId === undefined ||
    type === undefined ||
    name === undefined ||
    brand === undefined ||
    packSizeDescription === undefined ||
    parsedPrice === undefined ||
    parsedUnitPrice === undefined ||
    typeof payload.available !== "boolean" ||
    categoryPath === undefined ||
    !Array.isArray(payload.images) ||
    !Array.isArray(payload.promotions) ||
    (payload.catchweight != null && parsedCatchweight === undefined) ||
    (type.toUpperCase() === "CATCHWEIGHT" && parsedCatchweight === undefined)
  )
    return undefined;
  return {
    productId,
    retailerProductId,
    type: type.toUpperCase(),
    name,
    brand,
    packSizeDescription,
    price: parsedPrice,
    unitPrice: parsedUnitPrice,
    available: payload.available,
    ...(parsedCatchweight === undefined
      ? {}
      : { catchweight: parsedCatchweight }),
    categoryPath,
    images: Array.from(payload.images as readonly unknown[]),
    promotions: Array.from(payload.promotions as readonly unknown[]),
  };
}
