import type { ProductUnit } from "@shopping-app/domain";

type JsonRecord = Record<string, unknown>;

export interface AlcampoAreaSummaryDto {
  areaId: string;
}
export interface AlcampoAreaDto {
  areaId: string;
  city: string;
  community: string;
  countryCode: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
}
export interface AlcampoTemporaryDestinationDto {
  deliveryDestinationId: string;
}
export interface AlcampoDeliveryAddressDto {
  postalCode: string;
  deliverability: string;
  deliveryMethod: string;
  resolvedRegionId: string;
}
export interface AlcampoActiveSessionDto {
  cartId?: string;
  regionId: string;
  deliveryDestinationId: string;
}
export interface AlcampoCategoryDto {
  categoryId: string;
  retailerCategoryId: string;
  name: string;
  children: AlcampoCategoryDto[];
}
export interface AlcampoCategoryListingDto {
  retailerProductIds: string[];
  productUrls: ReadonlyMap<string, string>;
  internalProductIds: ReadonlyMap<string, string>;
}
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
export interface AlcampoPromotionDto {
  promoId?: string;
  retailerPromotionId?: string;
  description?: string;
  type?: string;
  price?: AlcampoMoneyDto;
  requiresMembership?: boolean;
}
export interface AlcampoImageDto {
  url: string;
}
export interface AlcampoProductDto {
  productId: string;
  retailerProductId: string;
  type: string;
  name: string;
  brand?: string;
  packSizeDescription?: string;
  price: AlcampoMoneyDto;
  unitPrice?: AlcampoUnitPriceDto;
  available: boolean;
  catchweight?: AlcampoCatchweightDto;
  categoryPath: string[];
  images: AlcampoImageDto[];
  promotions: AlcampoPromotionDto[];
  productUrl?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}
function decimal(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const parsed =
    typeof value === "string" ? Number(value.trim().replace(",", ".")) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
function unit(value: unknown): ProductUnit | undefined {
  switch (text(value)?.toLocaleLowerCase("es-ES")) {
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
  const currency = text(value.currency)?.toUpperCase();
  return amount === undefined || amount < 0 || currency === undefined
    ? undefined
    : { amount, currency };
}
function quantity(value: unknown): AlcampoQuantityDto | undefined {
  if (!isRecord(value)) return undefined;
  const amount = decimal(value.amount);
  const parsedUnit = unit(value.unit);
  return amount === undefined || amount <= 0 || parsedUnit === undefined
    ? undefined
    : { amount, unit: parsedUnit };
}
function unitPrice(value: unknown): AlcampoUnitPriceDto | undefined {
  if (!isRecord(value)) return undefined;
  const parsed = money(value.price ?? value);
  const reference = unitPriceReference(value.unit, value.unitName);
  return parsed === undefined || reference === undefined
    ? undefined
    : {
        ...parsed,
        amount: parsed.amount * reference.amountMultiplier,
        unit: reference.unit,
      };
}

function unitPriceReference(
  value: unknown,
  unitName: unknown,
): { unit: ProductUnit; amountMultiplier: number } | undefined {
  const parsedUnit = unit(value);
  if (parsedUnit !== undefined)
    return { unit: parsedUnit, amountMultiplier: 1 };
  const candidates = [value, unitName]
    .map((candidate) => text(candidate)?.toLocaleLowerCase("es-ES"))
    .filter((candidate): candidate is string => candidate !== undefined);
  for (const candidate of candidates) {
    switch (candidate) {
      case "fop.price.per.each":
      case "each":
        return { unit: "unit", amountMultiplier: 1 };
      case "fop.price.per.kg":
      case "per_1kg":
        return { unit: "kg", amountMultiplier: 1 };
      case "fop.price.per.litre":
      case "per_litre":
        return { unit: "l", amountMultiplier: 1 };
      case "fop.price.per.100ml":
      case "per_100ml":
        return { unit: "l", amountMultiplier: 10 };
    }
  }
  return undefined;
}
function grams(value: AlcampoQuantityDto): number | undefined {
  return value.unit === "g"
    ? value.amount
    : value.unit === "kg"
      ? value.amount * 1_000
      : undefined;
}
function parseCatchweight(value: unknown): AlcampoCatchweightDto | undefined {
  if (!isRecord(value)) return undefined;
  const observedQuantity = (
    candidate: unknown,
  ): AlcampoQuantityDto | undefined => {
    if (!isRecord(candidate)) return undefined;
    return quantity({
      amount: candidate.amount ?? candidate.value,
      unit: candidate.unit ?? candidate.uom,
    });
  };
  const min = observedQuantity(value.min ?? value.minQuantity);
  const typical = observedQuantity(value.typical ?? value.typicalQuantity);
  const max = observedQuantity(value.max ?? value.maxQuantity);
  if (min === undefined || typical === undefined || max === undefined)
    return undefined;
  const weights = [grams(min), grams(typical), grams(max)];
  if (
    weights.some((candidate) => candidate === undefined) ||
    (weights[0] as number) > (weights[1] as number) ||
    (weights[1] as number) > (weights[2] as number)
  )
    return undefined;
  return { min, typical, max };
}
function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.map(text);
  return parsed.some((candidate) => candidate === undefined)
    ? undefined
    : (parsed as string[]);
}
function images(value: unknown): AlcampoImageDto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: AlcampoImageDto[] = [];
  for (const item of value) {
    const url =
      text(item) ??
      (isRecord(item) ? (text(item.url) ?? text(item.src)) : undefined);
    if (url !== undefined) result.push({ url });
  }
  return result;
}
function promotions(value: unknown): AlcampoPromotionDto[] | undefined {
  if (value == null) return [];
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const parsedPrice = money(item.price ?? item.promoPrice);
    const promoId = text(item.promoId);
    const retailerPromotionId = text(item.retailerPromotionId);
    const description = text(item.description);
    const type = text(item.type);
    const promotion: AlcampoPromotionDto = {
      ...(promoId === undefined ? {} : { promoId }),
      ...(retailerPromotionId === undefined ? {} : { retailerPromotionId }),
      ...(description === undefined ? {} : { description }),
      ...(type === undefined ? {} : { type }),
      ...(parsedPrice === undefined ? {} : { price: parsedPrice }),
      ...(typeof item.requiresMembership === "boolean"
        ? { requiresMembership: item.requiresMembership }
        : type?.toUpperCase() === "LOYALTY"
          ? { requiresMembership: true }
          : {}),
    };
    return [promotion];
  });
}

export function parseAreaSearch(
  payload: unknown,
): AlcampoAreaSummaryDto[] | undefined {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.areas)
      ? payload.areas
      : undefined;
  if (candidates === undefined) return undefined;
  const result = candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const areaId =
      text(candidate.areaId) ?? text(candidate.id) ?? text(candidate.placeId);
    return areaId === undefined ? [] : [{ areaId }];
  });
  return result.length === 0 ? undefined : result;
}
export function parseArea(
  payload: unknown,
  areaId: string,
): AlcampoAreaDto | undefined {
  if (!isRecord(payload)) return undefined;
  const city = text(payload.city);
  const community = text(payload.community);
  const countryCode = text(payload.countryCode);
  const postalCode = text(payload.postalCode);
  const latitude = decimal(payload.latitude);
  const longitude = decimal(payload.longitude);
  const formattedAddress = text(payload.formattedAddress);
  return city === undefined ||
    community === undefined ||
    countryCode === undefined ||
    postalCode === undefined ||
    latitude === undefined ||
    longitude === undefined ||
    formattedAddress === undefined
    ? undefined
    : {
        areaId,
        city,
        community,
        countryCode,
        postalCode,
        latitude,
        longitude,
        formattedAddress,
      };
}
export function parseTemporaryDestination(
  payload: unknown,
): AlcampoTemporaryDestinationDto | undefined {
  const direct = text(payload);
  if (direct !== undefined) return { deliveryDestinationId: direct };
  if (!isRecord(payload)) return undefined;
  const deliveryDestinationId =
    text(payload.deliveryDestinationId) ??
    (isRecord(payload.deliveryDestination)
      ? text(payload.deliveryDestination.id)
      : undefined);
  return deliveryDestinationId === undefined
    ? undefined
    : { deliveryDestinationId };
}
export function parseDeliveryAddress(
  payload: unknown,
): AlcampoDeliveryAddressDto | undefined {
  if (!isRecord(payload)) return undefined;
  const postalCode = text(payload.postalCode);
  const deliverability = text(payload.deliverability);
  const deliveryMethod = text(payload.deliveryMethod);
  const resolvedRegionId =
    text(payload.resolvedRegionId) ?? text(payload.regionId);
  return postalCode === undefined ||
    deliverability === undefined ||
    deliveryMethod === undefined ||
    resolvedRegionId === undefined
    ? undefined
    : { postalCode, deliverability, deliveryMethod, resolvedRegionId };
}
export function parseActiveSession(
  payload: unknown,
): AlcampoActiveSessionDto | undefined {
  if (!isRecord(payload)) return undefined;
  const regionId = text(payload.regionId);
  const deliveryDestinationId = text(payload.deliveryDestinationId);
  const cartId = text(payload.cartId);
  return regionId === undefined || deliveryDestinationId === undefined
    ? undefined
    : {
        regionId,
        deliveryDestinationId,
        ...(cartId === undefined ? {} : { cartId }),
      };
}
export function parseCategories(
  payload: unknown,
): AlcampoCategoryDto[] | undefined {
  if (!Array.isArray(payload)) return undefined;
  const parse = (value: unknown): AlcampoCategoryDto | undefined => {
    if (!isRecord(value) || !Array.isArray(value.childCategories))
      return undefined;
    const categoryId = text(value.categoryId);
    const retailerCategoryId = text(value.retailerCategoryId);
    const name = text(value.name);
    const children = value.childCategories.map(parse);
    return categoryId === undefined ||
      retailerCategoryId === undefined ||
      name === undefined ||
      children.some((child) => child === undefined)
      ? undefined
      : {
          categoryId,
          retailerCategoryId,
          name,
          children: children as AlcampoCategoryDto[],
        };
  };
  const result = payload.map(parse);
  return result.some((item) => item === undefined)
    ? undefined
    : (result as AlcampoCategoryDto[]);
}
export function parseAlcampoProduct(
  payload: unknown,
): AlcampoProductDto | undefined {
  if (!isRecord(payload)) return undefined;
  const product = isRecord(payload.product) ? payload.product : payload;
  const productId = text(product.productId);
  const retailerProductId = text(product.retailerProductId);
  const type = text(product.type);
  const name = text(product.name);
  const parsedPrice = money(product.price);
  const parsedUnitPrice =
    product.unitPrice == null ? undefined : unitPrice(product.unitPrice);
  const categoryPath = strings(product.categoryPath);
  const parsedImages = images(product.images);
  const parsedPromotions = promotions(product.promotions);
  const parsedCatchweight =
    product.catchweight == null
      ? undefined
      : parseCatchweight(product.catchweight);
  if (
    productId === undefined ||
    retailerProductId === undefined ||
    type === undefined ||
    name === undefined ||
    parsedPrice === undefined ||
    typeof product.available !== "boolean" ||
    categoryPath === undefined ||
    parsedImages === undefined ||
    parsedPromotions === undefined ||
    (product.unitPrice != null && parsedUnitPrice === undefined) ||
    (product.catchweight != null && parsedCatchweight === undefined) ||
    (type.toUpperCase() === "CATCHWEIGHT" && parsedCatchweight === undefined)
  )
    return undefined;
  const brand = text(product.brand);
  const packSizeDescription = text(product.packSizeDescription);
  const productUrl = text(product.productUrl);
  return {
    productId,
    retailerProductId,
    type: type.toUpperCase(),
    name,
    ...(brand === undefined ? {} : { brand }),
    ...(packSizeDescription === undefined ? {} : { packSizeDescription }),
    price: parsedPrice,
    ...(parsedUnitPrice === undefined ? {} : { unitPrice: parsedUnitPrice }),
    available: product.available,
    ...(parsedCatchweight === undefined
      ? {}
      : { catchweight: parsedCatchweight }),
    categoryPath,
    images: parsedImages,
    promotions: parsedPromotions,
    ...(productUrl === undefined ? {} : { productUrl }),
  };
}

export function parseAlcampoProductsBatch(
  payload: unknown,
): AlcampoProductDto[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.products)) return undefined;
  const parsed = payload.products.map(parseAlcampoProduct);
  return parsed.some((product) => product === undefined)
    ? undefined
    : (parsed as AlcampoProductDto[]);
}
