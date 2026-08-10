import type {
  Market,
  ProductOffer,
  ProviderHealth,
  Retailer,
  RetailerProduct,
} from "@shopping-app/domain";

import type {
  FinishSyncRunInput,
  IngestionScope,
  PreflightFailureInput,
  PriceRefreshCandidate,
  PriceRefreshStore,
  StartSyncRunInput,
} from "./types.js";

export interface SupabaseIngestionStoreOptions {
  url: string;
  secretKey: string;
  fetch?: typeof globalThis.fetch;
}

interface IdRow {
  id: string;
}

export class SupabaseIngestionStore implements PriceRefreshStore {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: SupabaseIngestionStoreOptions) {
    this.baseUrl = options.url.replace(/\/$/, "");
    this.secretKey = options.secretKey;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async resolveRetailer(retailer: Retailer): Promise<string> {
    const rows = await this.request<IdRow[]>(
      `/rest/v1/retailers?code=eq.${encodeURIComponent(retailer)}&select=id&limit=1`,
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Retailer ${retailer} is not seeded in the database`);
    }
    return row.id;
  }

  async upsertMarket(retailerId: string, market: Market): Promise<string> {
    const rows = await this.request<IdRow[]>(
      "/rest/v1/retailer_markets?on_conflict=retailer_id%2Cexternal_id&select=id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          retailer_id: retailerId,
          external_id: market.externalId,
          name: market.name ?? null,
          metadata: toJsonValue(market.metadata ?? {}),
        }),
      },
    );
    const row = rows[0];
    if (row === undefined) throw new Error("Market upsert returned no row");
    await this.request(
      "/rest/v1/retailer_market_postal_codes?on_conflict=market_id%2Cpostal_code",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          retailer_id: retailerId,
          market_id: row.id,
          postal_code: market.postalCode,
        }),
      },
    );
    return row.id;
  }

  async findMarketId(
    retailerId: string,
    market: Market,
  ): Promise<string | undefined> {
    const rows = await this.request<IdRow[]>(
      `/rest/v1/retailer_markets?retailer_id=eq.${encodeURIComponent(retailerId)}&external_id=eq.${encodeURIComponent(market.externalId)}&select=id&limit=1`,
    );
    return rows[0]?.id;
  }

  async listPriceRefreshCandidates(
    scope: IngestionScope,
  ): Promise<readonly PriceRefreshCandidate[]> {
    const rows = await this.request<
      Array<{
        retailer_product_external_id: string;
        offer_observed_at: string | null;
        in_active_list: boolean;
        last_used_at: string | null;
      }>
    >("/rest/v1/rpc/list_price_refresh_candidates", {
      method: "POST",
      body: JSON.stringify({
        target_retailer_id: scope.retailerId,
        target_market_id: scope.marketId,
      }),
    });
    return rows.map((row) => ({
      retailerProductExternalId: row.retailer_product_external_id,
      ...(row.offer_observed_at === null
        ? {}
        : { offerObservedAt: new Date(row.offer_observed_at) }),
      inActiveList: row.in_active_list,
      ...(row.last_used_at === null
        ? {}
        : { lastUsedAt: new Date(row.last_used_at) }),
    }));
  }

  async getOfferFreshnessConfig(): Promise<{
    staleAfterMs: number;
    veryStaleAfterMs: number;
  }> {
    const rows = await this.request<
      Array<{ stale_after_ms: number; very_stale_after_ms: number }>
    >("/rest/v1/rpc/get_offer_freshness_policy", {
      method: "POST",
      body: "{}",
    });
    const policy = rows[0];
    if (policy === undefined) {
      throw new Error("Offer freshness policy is not configured");
    }
    return {
      staleAfterMs: policy.stale_after_ms,
      veryStaleAfterMs: policy.very_stale_after_ms,
    };
  }

  async startSyncRun(input: StartSyncRunInput): Promise<string> {
    const rows = await this.request<IdRow[]>(
      "/rest/v1/provider_sync_runs?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          retailer_id: input.retailerId,
          market_id: input.marketId,
          status: "running",
          sync_type: input.syncType,
          started_at: input.startedAt.toISOString(),
          metadata: toJsonValue(input.metadata),
        }),
      },
    );
    const row = rows[0];
    if (row === undefined) throw new Error("Sync run insert returned no row");
    return row.id;
  }

  async upsertProducts(
    scope: IngestionScope,
    products: readonly RetailerProduct[],
  ): Promise<void> {
    await this.request("/rest/v1/rpc/ingest_retailer_products_batch", {
      method: "POST",
      body: JSON.stringify({
        target_retailer_id: scope.retailerId,
        target_market_id: scope.marketId,
        payload: products.map(productPayload),
      }),
    });
  }

  async upsertOffers(
    scope: IngestionScope,
    offers: readonly ProductOffer[],
  ): Promise<void> {
    await this.request("/rest/v1/rpc/ingest_product_offers_batch", {
      method: "POST",
      body: JSON.stringify({
        target_retailer_id: scope.retailerId,
        target_market_id: scope.marketId,
        payload: offers.map(offerPayload),
      }),
    });
  }

  async finishSyncRun(input: FinishSyncRunInput): Promise<void> {
    await this.request(
      `/rest/v1/provider_sync_runs?id=eq.${encodeURIComponent(input.runId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: input.status,
          finished_at: input.finishedAt.toISOString(),
          products_seen: input.productsSeen,
          offers_seen: input.offersSeen,
          error_message: input.errorMessage ?? null,
          metadata: toJsonValue(input.metadata),
        }),
      },
    );
  }

  async updateProviderHealth(
    scope: IngestionScope,
    health: ProviderHealth,
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.request(
      "/rest/v1/provider_health?on_conflict=retailer_id%2Cmarket_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          retailer_id: scope.retailerId,
          market_id: scope.marketId,
          status: health.status,
          checked_at: health.checkedAt.toISOString(),
          latency_ms: health.latencyMs ?? null,
          message: health.message ?? null,
          metadata: toJsonValue(metadata),
        }),
      },
    );
  }

  async recordPreflightFailure(input: PreflightFailureInput): Promise<void> {
    const retailerId = await this.resolveRetailer(input.retailer);
    const rows = await this.request<IdRow[]>(
      "/rest/v1/provider_sync_runs?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          retailer_id: retailerId,
          market_id: null,
          status: "failed",
          sync_type: input.syncType.toLowerCase(),
          started_at: input.startedAt.toISOString(),
          finished_at: input.finishedAt.toISOString(),
          error_message: input.errorMessage,
          metadata: { phase: "preflight" },
        }),
      },
    );
    const run = rows[0];
    if (run === undefined) {
      throw new Error("Preflight sync run insert returned no row");
    }
    await this.request(
      "/rest/v1/provider_health?on_conflict=retailer_id%2Cmarket_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          retailer_id: retailerId,
          market_id: null,
          status: "unavailable",
          checked_at: input.finishedAt.toISOString(),
          message: input.errorMessage,
          metadata: { phase: "preflight", syncRunId: run.id },
        }),
      },
    );
  }

  private async request<T = undefined>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.secretKey,
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

function productPayload(product: RetailerProduct): Record<string, unknown> {
  return {
    external_id: product.externalId,
    name: product.name,
    brand: product.brand ?? null,
    gtin: product.gtin ?? product.ean ?? null,
    package_size: product.packageSize ?? null,
    package_unit: product.packageUnit ?? null,
    package_count: product.packageCount ?? null,
    total_amount: product.totalAmount ?? null,
    variable_weight: product.variableWeight,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    image_url: product.imageUrl ?? null,
    product_url: product.productUrl ?? null,
    raw_data: toJsonValue(product.rawData ?? null),
    observed_at: product.observedAt.toISOString(),
  };
}

function offerPayload(offer: ProductOffer): Record<string, unknown> {
  return {
    retailer_product_external_id: offer.retailerProductId,
    normal_price: offer.normalPrice,
    promo_price: offer.promoPrice ?? null,
    price_per_unit: offer.pricePerUnit ?? null,
    reference_unit: offer.referenceUnit ?? null,
    promotion_type: offer.promotionType?.replaceAll("-", "_") ?? null,
    promotion_text: offer.promotionText ?? null,
    requires_membership: offer.requiresMembership,
    available: offer.available,
    observed_at: offer.observedAt.toISOString(),
  };
}

function toJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
