import type {
  CanonicalProduct,
  ProductMatchCandidate,
  ProductMatchConfidence,
  ProductMatchStatus,
  ProductMatchType,
  ProductUnit,
  Retailer,
  RetailerProduct,
} from "@shopping-app/domain";

import { isValidGtin } from "./gtin.ts";
import { normalizeProduct, normalizeText } from "./normalization.ts";
import type {
  CanonicalProductInput,
  MatchDecisionInput,
  NormalizedProduct,
  ProductMatchingRepository,
  StoredProductMatch,
} from "./types.ts";

export interface SupabaseProductMatchingRepositoryOptions {
  url: string;
  serviceRoleKey: string;
  fetch?: typeof globalThis.fetch;
}

type CanonicalRow = {
  id: string;
  name: string;
  normalized_name: string;
  base_name: string;
  category: string | null;
  normalized_category: string | null;
  brand: string | null;
  normalized_brand: string | null;
  variant: string | null;
  gtin: string | null;
  package_size: number | null;
  package_unit: ProductUnit | null;
  package_count: number | null;
  total_amount: number | null;
};

type MatchRow = {
  id: string;
  canonical_product_id: string;
  retailer_product_id: string;
  match_type: ProductMatchType;
  method: string;
  score: number;
  confidence: ProductMatchConfidence;
  reasons: unknown;
  status: ProductMatchStatus;
  reviewed: boolean;
  created_at: string;
  updated_at: string;
};

export class SupabaseProductMatchingRepository implements ProductMatchingRepository {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: SupabaseProductMatchingRepositoryOptions) {
    this.baseUrl = options.url.replace(/\/$/, "");
    this.serviceRoleKey = options.serviceRoleKey;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async findCanonicalCandidates(
    product: NormalizedProduct,
  ): Promise<readonly CanonicalProduct[]> {
    const rows = await this.request<CanonicalRow[]>(
      "/rest/v1/rpc/search_product_match_candidates",
      {
        method: "POST",
        body: JSON.stringify({
          query_gtin: product.gtin ?? null,
          query_normalized_name: product.normalizedName,
          query_normalized_category: product.normalizedCategory ?? null,
          candidate_limit: 50,
        }),
      },
    );
    return rows.map(mapCanonical);
  }

  async createCanonicalProduct(
    input: CanonicalProductInput,
  ): Promise<CanonicalProduct> {
    const derived = normalizeCanonicalInput(input);
    if (derived.normalizedName === "" || derived.baseName === "") {
      throw new TypeError(
        "Canonical product name must contain comparable text",
      );
    }
    if (input.gtin !== undefined && !isValidGtin(input.gtin)) {
      throw new TypeError("Canonical product GTIN is invalid");
    }
    const rows = await this.request<CanonicalRow[]>(
      "/rest/v1/canonical_products?select=*",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          name: input.name,
          normalized_name: derived.normalizedName,
          base_name: derived.baseName,
          category: input.category ?? null,
          normalized_category: derived.normalizedCategory ?? null,
          brand: input.brand ?? null,
          normalized_brand: derived.normalizedBrand ?? null,
          variant: input.variant ?? derived.variant ?? null,
          gtin: input.gtin ?? null,
          package_size: input.packageSize ?? null,
          package_unit: input.packageUnit ?? null,
          package_count: input.packageCount ?? null,
          total_amount: input.totalAmount ?? null,
        }),
      },
    );
    return mapOne(
      rows,
      mapCanonical,
      "Canonical product insert returned no row",
    );
  }

  async saveProposal(
    candidate: ProductMatchCandidate,
  ): Promise<StoredProductMatch> {
    const rows = await this.request<MatchRow[]>(
      "/rest/v1/product_matches?on_conflict=canonical_product_id%2Cretailer_product_id&select=*",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          canonical_product_id: candidate.canonicalProductId,
          retailer_product_id: candidate.retailerProductId,
          match_type: candidate.matchType,
          method: candidate.method,
          score: candidate.score,
          confidence: candidate.confidence,
          reasons: candidate.reasons,
          status: "PROPOSED",
          reviewed: false,
        }),
      },
    );
    return mapOne(rows, mapMatch, "Match proposal upsert returned no row");
  }

  acceptMatch(matchId: string): Promise<StoredProductMatch> {
    return this.matchRpc("accept_product_match", { target_match_id: matchId });
  }

  rejectMatch(matchId: string): Promise<StoredProductMatch> {
    return this.matchRpc("reject_product_match", { target_match_id: matchId });
  }

  changeMatch(input: MatchDecisionInput): Promise<StoredProductMatch> {
    return this.matchRpc("change_product_match", {
      target_canonical_product_id: input.canonicalProductId,
      target_retailer_product_id: input.retailerProductId,
      target_match_type: input.matchType,
      target_method: input.method,
      target_score: input.score,
      target_confidence: input.confidence,
      target_reasons: input.reasons,
    });
  }

  async findEquivalentProducts(
    canonicalProductId: string,
  ): Promise<readonly RetailerProduct[]> {
    const path = `/rest/v1/retailer_products?select=external_id,name,brand,gtin,package_size,package_unit,package_count,total_amount,variable_weight,category,subcategory,image_url,product_url,market_id,observed_at,raw_data,retailers!inner(code),product_matches!inner(canonical_product_id,status)&product_matches.canonical_product_id=eq.${encodeURIComponent(canonicalProductId)}&product_matches.status=eq.ACCEPTED`;
    const rows = await this.request<Array<Record<string, unknown>>>(path);
    return rows.map(mapRetailerProduct);
  }

  private async matchRpc(
    name: string,
    body: Record<string, unknown>,
  ): Promise<StoredProductMatch> {
    const rows = await this.request<MatchRow[]>(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return mapOne(rows, mapMatch, `${name} returned no row`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Supabase request failed (${response.status}): ${detail}`,
      );
    }
    const text = await response.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }
}

function normalizeCanonicalInput(
  input: CanonicalProductInput,
): NormalizedProduct {
  const derived = normalizeProduct({
    retailer: "DIA",
    externalId: "canonical-preview",
    name: input.name,
    ...(input.brand === undefined ? {} : { brand: input.brand }),
    ...(input.gtin === undefined ? {} : { gtin: input.gtin }),
    ...(input.packageSize === undefined
      ? {}
      : { packageSize: input.packageSize }),
    ...(input.packageUnit === undefined
      ? {}
      : { packageUnit: input.packageUnit }),
    ...(input.packageCount === undefined
      ? {}
      : { packageCount: input.packageCount }),
    ...(input.totalAmount === undefined
      ? {}
      : { totalAmount: input.totalAmount }),
    ...(input.category === undefined ? {} : { category: input.category }),
    variableWeight: false,
    marketId: "canonical",
    observedAt: new Date(0),
  });
  return input.variant === undefined
    ? derived
    : { ...derived, variant: normalizeText(input.variant) };
}

function mapCanonical(row: CanonicalRow): CanonicalProduct {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    baseName: row.base_name,
    ...(row.category === null ? {} : { category: row.category }),
    ...(row.normalized_category === null
      ? {}
      : { normalizedCategory: row.normalized_category }),
    ...(row.brand === null ? {} : { brand: row.brand }),
    ...(row.normalized_brand === null
      ? {}
      : { normalizedBrand: row.normalized_brand }),
    ...(row.variant === null ? {} : { variant: row.variant }),
    ...(row.gtin === null ? {} : { gtin: row.gtin }),
    ...(row.package_size === null ? {} : { packageSize: row.package_size }),
    ...(row.package_unit === null ? {} : { packageUnit: row.package_unit }),
    ...(row.package_count === null ? {} : { packageCount: row.package_count }),
    ...(row.total_amount === null ? {} : { totalAmount: row.total_amount }),
  };
}

function mapMatch(row: MatchRow): StoredProductMatch {
  return {
    id: row.id,
    canonicalProductId: row.canonical_product_id,
    retailerProductId: row.retailer_product_id,
    matchType: row.match_type,
    method: row.method,
    score: row.score,
    confidence: row.confidence,
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    status: row.status,
    reviewed: row.reviewed,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRetailerProduct(row: Record<string, unknown>): RetailerProduct {
  const retailers = row.retailers as { code?: unknown } | undefined;
  const retailer = retailers?.code;
  if (typeof retailer !== "string")
    throw new TypeError("Equivalent product row has no retailer code");
  const brand = optionalString(row, "brand");
  const gtin = optionalString(row, "gtin");
  const packageSize = optionalNumber(row, "package_size");
  const packageUnit = optionalString(row, "package_unit") as
    ProductUnit | undefined;
  const packageCount = optionalNumber(row, "package_count");
  const totalAmount = optionalNumber(row, "total_amount");
  const category = optionalString(row, "category");
  const subcategory = optionalString(row, "subcategory");
  const imageUrl = optionalString(row, "image_url");
  const productUrl = optionalString(row, "product_url");
  return {
    retailer: retailer as Retailer,
    externalId: requiredString(row, "external_id"),
    name: requiredString(row, "name"),
    ...(brand === undefined ? {} : { brand }),
    ...(gtin === undefined ? {} : { gtin }),
    ...(packageSize === undefined ? {} : { packageSize }),
    ...(packageUnit === undefined ? {} : { packageUnit }),
    ...(packageCount === undefined ? {} : { packageCount }),
    ...(totalAmount === undefined ? {} : { totalAmount }),
    variableWeight: row.variable_weight === true,
    ...(category === undefined ? {} : { category }),
    ...(subcategory === undefined ? {} : { subcategory }),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    ...(productUrl === undefined ? {} : { productUrl }),
    marketId: requiredString(row, "market_id"),
    observedAt: new Date(requiredString(row, "observed_at")),
    ...(row.raw_data === null || row.raw_data === undefined
      ? {}
      : { rawData: row.raw_data }),
  };
}

function mapOne<T, U>(
  rows: readonly T[],
  mapper: (row: T) => U,
  message: string,
): U {
  const row = rows[0];
  if (row === undefined) throw new Error(message);
  return mapper(row);
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string")
    throw new TypeError(`Expected ${field} to be a string`);
  return value;
}

function optionalString(
  row: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = row[field];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(
  row: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = row[field];
  return typeof value === "number" ? value : undefined;
}
