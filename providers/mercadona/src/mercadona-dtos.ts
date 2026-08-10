export interface MercadonaMarketDto {
  postalCode: string;
  warehouse: string;
  warehouseChanged: boolean;
}

export interface MercadonaCategorySummaryDto {
  id: string;
  name: string;
  order?: number;
}

export interface MercadonaCategoryDto extends MercadonaCategorySummaryDto {
  categories: MercadonaCategorySummaryDto[];
}

export interface MercadonaPriceInstructionsDto {
  approxSize: boolean;
  isPack: boolean;
  packSize?: number;
  referenceFormat?: string;
  referencePrice?: number;
  sizeFormat?: string;
  totalUnits?: number;
  unitPrice: number;
  unitSize?: number;
}

export interface MercadonaProductDto {
  id: string;
  displayName: string;
  brand?: string;
  ean?: string;
  published: boolean;
  unavailableFrom?: string;
  variableWeight?: boolean;
  thumbnail?: string;
  shareUrl?: string;
  categories: MercadonaCategorySummaryDto[];
  subcategory?: MercadonaCategorySummaryDto;
  priceInstructions: MercadonaPriceInstructionsDto;
}

export interface MercadonaCategoryDetailDto extends MercadonaCategorySummaryDto {
  groups: Array<
    MercadonaCategorySummaryDto & { products: MercadonaProductDto[] }
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : stringValue(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : numberValue(value);
}

function parseCategorySummary(
  value: unknown,
): MercadonaCategorySummaryDto | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const order = optionalNumber(value.order);
  if (id === undefined || name === undefined) return undefined;
  return {
    id,
    name,
    ...(order === undefined ? {} : { order }),
  };
}

function parsePriceInstructions(
  value: unknown,
): MercadonaPriceInstructionsDto | undefined {
  if (!isRecord(value)) return undefined;
  const unitPrice = numberValue(value.unit_price);
  if (
    unitPrice === undefined ||
    unitPrice < 0 ||
    typeof value.is_pack !== "boolean" ||
    typeof value.approx_size !== "boolean"
  ) {
    return undefined;
  }
  const packSize = optionalNumber(value.pack_size);
  const referenceFormat = optionalString(value.reference_format);
  const referencePrice = optionalNumber(value.reference_price);
  const sizeFormat = optionalString(value.size_format);
  const totalUnits = optionalNumber(value.total_units);
  const unitSize = optionalNumber(value.unit_size);
  return {
    unitPrice,
    isPack: value.is_pack,
    approxSize: value.approx_size,
    ...(packSize === undefined ? {} : { packSize }),
    ...(referenceFormat === undefined ? {} : { referenceFormat }),
    ...(referencePrice === undefined ? {} : { referencePrice }),
    ...(sizeFormat === undefined ? {} : { sizeFormat }),
    ...(totalUnits === undefined ? {} : { totalUnits }),
    ...(unitSize === undefined ? {} : { unitSize }),
  };
}

function parseProduct(
  value: unknown,
  subcategory?: MercadonaCategorySummaryDto,
): MercadonaProductDto | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const displayName = stringValue(value.display_name);
  const priceInstructions = parsePriceInstructions(value.price_instructions);
  if (
    id === undefined ||
    displayName === undefined ||
    typeof value.published !== "boolean" ||
    priceInstructions === undefined
  ) {
    return undefined;
  }
  const rawCategories = value.categories;
  if (!Array.isArray(rawCategories)) return undefined;
  const categories: MercadonaCategorySummaryDto[] = [];
  for (const rawCategory of rawCategories as readonly unknown[]) {
    const category = parseCategorySummary(rawCategory);
    if (category === undefined) return undefined;
    categories.push(category);
  }
  const brand = optionalString(value.brand);
  const ean = optionalString(value.ean);
  const thumbnail = optionalString(value.thumbnail);
  const shareUrl = optionalString(value.share_url);
  const unavailableFrom = optionalString(value.unavailable_from);
  const variableWeight =
    typeof value.is_variable_weight === "boolean"
      ? value.is_variable_weight
      : undefined;
  return {
    id,
    displayName,
    published: value.published,
    categories,
    priceInstructions,
    ...(brand === undefined ? {} : { brand }),
    ...(ean === undefined ? {} : { ean }),
    ...(thumbnail === undefined ? {} : { thumbnail }),
    ...(shareUrl === undefined ? {} : { shareUrl }),
    ...(unavailableFrom === undefined ? {} : { unavailableFrom }),
    ...(variableWeight === undefined ? {} : { variableWeight }),
    ...(subcategory === undefined ? {} : { subcategory }),
  };
}

export function parseMercadonaMarketBody(
  payload: unknown,
): Pick<MercadonaMarketDto, "warehouseChanged"> | undefined {
  return isRecord(payload) && typeof payload.warehouse_changed === "boolean"
    ? { warehouseChanged: payload.warehouse_changed }
    : undefined;
}

export function parseMercadonaCategories(
  payload: unknown,
): MercadonaCategoryDto[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return undefined;
  const categories: MercadonaCategoryDto[] = [];
  for (const rawCategory of payload.results as readonly unknown[]) {
    const category = parseCategorySummary(rawCategory);
    if (
      !isRecord(rawCategory) ||
      category === undefined ||
      !Array.isArray(rawCategory.categories)
    ) {
      return undefined;
    }
    const children: MercadonaCategorySummaryDto[] = [];
    for (const rawChild of rawCategory.categories as readonly unknown[]) {
      const child = parseCategorySummary(rawChild);
      if (child === undefined) return undefined;
      children.push(child);
    }
    categories.push({ ...category, categories: children });
  }
  return categories;
}

export function parseMercadonaCategoryDetail(
  payload: unknown,
): MercadonaCategoryDetailDto | undefined {
  const category = parseCategorySummary(payload);
  if (
    !isRecord(payload) ||
    category === undefined ||
    !Array.isArray(payload.categories)
  ) {
    return undefined;
  }
  const groups: MercadonaCategoryDetailDto["groups"] = [];
  for (const rawGroup of payload.categories as readonly unknown[]) {
    const group = parseCategorySummary(rawGroup);
    if (
      !isRecord(rawGroup) ||
      group === undefined ||
      !Array.isArray(rawGroup.products)
    ) {
      return undefined;
    }
    const products: MercadonaProductDto[] = [];
    for (const rawProduct of rawGroup.products as readonly unknown[]) {
      const product = parseProduct(rawProduct, group);
      if (product === undefined) return undefined;
      products.push(product);
    }
    groups.push({ ...group, products });
  }
  return { ...category, groups };
}

export function parseMercadonaProduct(
  payload: unknown,
): MercadonaProductDto | undefined {
  return parseProduct(payload);
}
