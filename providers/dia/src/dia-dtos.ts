export interface DiaMarketResponseDto {
  sessionId: string;
  shopId?: string;
}

export interface DiaProductAnalyticsDto {
  externalId: string;
  name: string;
  price: number;
  stockAvailability: boolean;
  shopId: string;
}

export interface DiaSearchPricesDto {
  currency: "EUR";
  discountPercentage?: number;
  isClubPrice?: boolean;
  isPromoPrice?: boolean;
  measureUnit?: string;
  price: number;
  pricePerUnit?: number;
  strikethroughPrice?: number;
}

export interface DiaSearchItemDto {
  brand?: string;
  displayName: string;
  image?: string;
  category?: string;
  subcategory?: string;
  skuId: string;
  unitsInStock?: number;
  url?: string;
  prices?: DiaSearchPricesDto;
}

export interface DiaSearchPageDto {
  postalCode?: string;
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  items: DiaSearchItemDto[];
}

export interface DiaMenuCategoryDto {
  id: string;
  name: string;
  link: string;
  children: DiaMenuCategoryDto[];
}

export interface DiaCatalogPageDto {
  categoryId: string;
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  items: DiaSearchItemDto[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  const parsed = asFiniteNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null
    ? undefined
    : asNonEmptyString(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null
    ? undefined
    : asFiniteNumber(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseDiaSearchPrices(value: unknown): DiaSearchPricesDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const price = asFiniteNumber(value.price);
  const currency = asNonEmptyString(value.currency)?.toUpperCase();
  if (price === undefined || price < 0 || currency !== "EUR") {
    return undefined;
  }

  const discountPercentage = optionalNumber(value.discount_percentage);
  const isClubPrice = optionalBoolean(value.is_club_price);
  const isPromoPrice = optionalBoolean(value.is_promo_price);
  const measureUnit = optionalString(value.measure_unit);
  const pricePerUnit = optionalNumber(value.price_per_unit);
  const strikethroughPrice = optionalNumber(value.strikethrough_price);

  return {
    price,
    currency,
    ...(discountPercentage === undefined ? {} : { discountPercentage }),
    ...(isClubPrice === undefined ? {} : { isClubPrice }),
    ...(isPromoPrice === undefined ? {} : { isPromoPrice }),
    ...(measureUnit === undefined ? {} : { measureUnit }),
    ...(pricePerUnit === undefined ? {} : { pricePerUnit }),
    ...(strikethroughPrice === undefined ? {} : { strikethroughPrice }),
  };
}

function parseDiaSearchItem(value: unknown): DiaSearchItemDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const skuId = asNonEmptyString(value.sku_id);
  const displayName = asNonEmptyString(value.display_name);
  if (skuId === undefined || displayName === undefined) {
    return undefined;
  }

  const brand = optionalString(value.brand);
  const image = optionalString(value.image);
  const category = optionalString(value.l1_category_description);
  const subcategory = optionalString(value.l2_category_description);
  const unitsInStock = optionalNumber(value.units_in_stock);
  const url = optionalString(value.url);
  const prices = parseDiaSearchPrices(value.prices);
  if (value.prices != null && prices === undefined) return undefined;

  return {
    skuId,
    displayName,
    ...(brand === undefined ? {} : { brand }),
    ...(image === undefined ? {} : { image }),
    ...(category === undefined ? {} : { category }),
    ...(subcategory === undefined ? {} : { subcategory }),
    ...(unitsInStock === undefined ? {} : { unitsInStock }),
    ...(url === undefined ? {} : { url }),
    ...(prices === undefined ? {} : { prices }),
  };
}

export function parseDiaSearchPage(
  payload: unknown,
): DiaSearchPageDto | undefined {
  if (!isRecord(payload) || !isRecord(payload.pagination)) {
    return undefined;
  }

  const pageNumber = asNonNegativeInteger(payload.pagination.page_number);
  const pageSize = asNonNegativeInteger(payload.pagination.page_size);
  const totalPages = asNonNegativeInteger(payload.pagination.total_pages);
  const totalItems = asNonNegativeInteger(payload.total_items);
  if (
    pageNumber === undefined ||
    pageSize === undefined ||
    totalPages === undefined ||
    totalItems === undefined
  ) {
    return undefined;
  }

  const rawItems = payload.search_items;
  if (!Array.isArray(rawItems)) {
    if (totalItems !== 0) {
      return undefined;
    }
  }
  const items: DiaSearchItemDto[] = [];
  for (const rawItem of (Array.isArray(rawItems)
    ? rawItems
    : []) as readonly unknown[]) {
    const item = parseDiaSearchItem(rawItem);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }

  const cart = payload.cart;
  const postalCode = isRecord(cart)
    ? optionalString(cart.postal_code)
    : undefined;
  return {
    pageNumber,
    pageSize,
    totalPages,
    totalItems,
    items,
    ...(postalCode === undefined ? {} : { postalCode }),
  };
}

function parseDiaMenuCategory(value: unknown): DiaMenuCategoryDto | undefined {
  if (!isRecord(value)) return undefined;
  const id = asNonEmptyString(value.id);
  const name = asNonEmptyString(value.name);
  const link = asNonEmptyString(value.link);
  if (
    id === undefined ||
    !/^L\d+$/.test(id) ||
    name === undefined ||
    link === undefined ||
    !link.startsWith("/") ||
    link.startsWith("//") ||
    link.includes("?") ||
    link.includes("#") ||
    !link.endsWith(`/c/${id}`)
  ) {
    return undefined;
  }
  const rawChildren = value.children;
  if (rawChildren != null && !Array.isArray(rawChildren)) return undefined;
  const children = (Array.isArray(rawChildren) ? rawChildren : []).map(
    parseDiaMenuCategory,
  );
  return children.some((child) => child === undefined)
    ? undefined
    : {
        id,
        name,
        link,
        children: children as DiaMenuCategoryDto[],
      };
}

export function parseDiaMenu(
  payload: unknown,
): DiaMenuCategoryDto[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.categories))
    return undefined;
  const categories = payload.categories.map(parseDiaMenuCategory);
  return categories.length === 0 ||
    categories.some((category) => category === undefined)
    ? undefined
    : (categories as DiaMenuCategoryDto[]);
}

export function parseDiaCatalogPage(
  payload: unknown,
): DiaCatalogPageDto | undefined {
  if (!isRecord(payload) || !isRecord(payload.pagination)) return undefined;
  const categoryId = asNonEmptyString(payload.selected_category_id);
  const pageNumber = asNonNegativeInteger(payload.pagination.page_number);
  const pageSize = asNonNegativeInteger(payload.pagination.page_size);
  const totalPages = asNonNegativeInteger(payload.pagination.total_pages);
  const totalItems = asNonNegativeInteger(payload.total_items);
  if (
    categoryId === undefined ||
    !/^L\d+$/.test(categoryId) ||
    pageNumber === undefined ||
    pageSize === undefined ||
    totalPages === undefined ||
    totalItems === undefined
  ) {
    return undefined;
  }
  const rawItems = payload.plp_items;
  if (!Array.isArray(rawItems) && totalItems !== 0) return undefined;
  const items = (Array.isArray(rawItems) ? rawItems : []).map(
    parseDiaSearchItem,
  );
  return items.some((item) => item === undefined)
    ? undefined
    : {
        categoryId,
        pageNumber,
        pageSize,
        totalPages,
        totalItems,
        items: items as DiaSearchItemDto[],
      };
}

function findProductRecord(
  payload: unknown,
  expectedExternalId: string,
): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !isRecord(payload.page_product_analytics))
    return undefined;
  const candidate = payload.page_product_analytics[expectedExternalId];
  return isRecord(candidate) ? candidate : undefined;
}

export function parseDiaProductAnalytics(
  payload: unknown,
  expectedExternalId: string,
): DiaProductAnalyticsDto | undefined {
  const product = findProductRecord(payload, expectedExternalId);
  if (product === undefined) {
    return undefined;
  }

  const externalId = asNonEmptyString(product.externalId ?? product.item_id);
  const name = asNonEmptyString(product.name ?? product.item_name);
  const price = asFiniteNumber(product.price);
  const stockAvailability = product.stock_availability;
  const initialDataLayer = isRecord(payload)
    ? payload.initial_datalayer
    : undefined;
  const shopId = asNonEmptyString(
    product.shop_id ??
      (isRecord(initialDataLayer) ? initialDataLayer.shop_id : undefined),
  );

  if (
    externalId === undefined ||
    name === undefined ||
    price === undefined ||
    price < 0 ||
    typeof stockAvailability !== "boolean" ||
    shopId === undefined
  ) {
    return undefined;
  }

  return { externalId, name, price, stockAvailability, shopId };
}
