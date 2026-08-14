import type {
  AuditRow,
  ProductConceptRow,
  HealthRow,
  ProductClassificationRow,
  OfferRow,
  PriceHistoryRow,
  ProductRow,
  RetailerRow,
  RefreshRequestRow,
  SyncRunRow,
} from "./models.js";
import type { SupabaseRestClient } from "./supabase.js";

const ROW_LIMIT = "200";

export interface ProviderSummary {
  retailerId: string;
  provider: string;
  state: "ACTIVE" | "DEGRADED" | "DISABLED";
  successRate: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  durationMs: number | null;
  metrics: unknown;
  capabilities: string[];
}

export interface SyncRunView extends SyncRunRow {
  provider: string;
  failures: number;
}

export interface CatalogView extends ProductRow {
  provider: string;
  offers: OfferRow[];
  freshness: "FRESH" | "STALE" | "VERY_STALE" | "NO_OFFER";
}

export type MatchingFilter =
  "unmatched" | "low" | "pending" | "accepted" | "rejected";

export interface ClassificationView {
  id: string;
  retailerProductId: string;
  provider: string;
  retailerProduct: string;
  productConcept: string | null;
  concept: ProductConceptRow | null;
  method: string | null;
  score: number | null;
  confidence: string | null;
  status: string;
  updatedAt: string;
}

export interface RefreshRequestView extends RefreshRequestRow {
  provider: string;
}

export class AdminQueries {
  constructor(private readonly client: SupabaseRestClient) {}

  async providers(): Promise<ProviderSummary[]> {
    const [retailers, health, runs] = await Promise.all([
      this.retailers(),
      this.client.select<HealthRow>("provider_health", {
        select: "retailer_id,status,checked_at,latency_ms,message,metadata",
        order: "checked_at.desc",
        limit: "500",
      }),
      this.runs(500),
    ]);
    return retailers.map((retailer) => {
      const providerRuns = runs.filter(
        (run) => run.retailer_id === retailer.id,
      );
      const completed = providerRuns.filter((run) => run.status !== "running");
      const succeeded = completed.filter((run) => run.status === "succeeded");
      const lastRun = providerRuns[0] ?? null;
      const latestHealth = health.find(
        (row) => row.retailer_id === retailer.id,
      );
      return {
        retailerId: retailer.id,
        provider: retailer.code,
        state: retailer.operational_status,
        successRate:
          completed.length === 0
            ? null
            : (succeeded.length / completed.length) * 100,
        lastSuccessAt:
          succeeded.find((run) => run.finished_at !== null)?.finished_at ??
          null,
        lastFailureAt:
          completed.find(
            (run) => run.status === "failed" || run.status === "partial",
          )?.finished_at ?? null,
        lastError:
          completed.find((run) => run.error_message !== null)?.error_message ??
          latestHealth?.message ??
          null,
        lastSyncAt: lastRun?.started_at ?? null,
        durationMs: duration(lastRun),
        metrics: {
          latencyMs: latestHealth?.latency_ms ?? null,
          health: latestHealth?.metadata ?? {},
          sync: lastRun?.metadata ?? {},
        },
        capabilities: retailer.capabilities,
      };
    });
  }

  async syncRuns(): Promise<SyncRunView[]> {
    const [retailers, runs] = await Promise.all([
      this.retailers(),
      this.runs(200),
    ]);
    const names = new Map(retailers.map((row) => [row.id, row.code]));
    return runs.map((run) => ({
      ...run,
      provider: names.get(run.retailer_id) ?? run.retailer_id,
      failures: failureCount(run),
    }));
  }

  async catalog(filters: {
    query?: string;
    active?: boolean;
  }): Promise<CatalogView[]> {
    const parameters: Record<string, string> = {
      select:
        "id,retailer_id,external_id,name,brand,active,last_seen_at,package_size,package_unit,package_count,total_amount",
      order: "last_seen_at.desc",
      limit: ROW_LIMIT,
    };
    if (filters.active !== undefined)
      parameters.active = `eq.${filters.active}`;
    if (filters.query !== undefined && filters.query.trim() !== "") {
      parameters.name = `ilike.*${sanitizeSearch(filters.query)}*`;
    }
    const [retailers, products, freshnessPolicy] = await Promise.all([
      this.retailers(),
      this.client.select<ProductRow>("retailer_products", parameters),
      this.client.rpc<
        Array<{ stale_after_ms: number; very_stale_after_ms: number }>
      >("get_offer_freshness_policy", {}),
    ]);
    const offers = await this.offersFor(products.map((product) => product.id));
    const byProduct = groupBy(offers, (offer) => offer.retailer_product_id);
    const names = new Map(retailers.map((row) => [row.id, row.code]));
    const policy = freshnessPolicy[0] ?? {
      stale_after_ms: 6 * 60 * 60 * 1000,
      very_stale_after_ms: 24 * 60 * 60 * 1000,
    };
    return products.map((product) => {
      const productOffers = byProduct.get(product.id) ?? [];
      const newest = [...productOffers].sort((a, b) =>
        b.observed_at.localeCompare(a.observed_at),
      )[0];
      return {
        ...product,
        provider: names.get(product.retailer_id) ?? product.retailer_id,
        offers: productOffers,
        freshness: offerFreshness(newest?.observed_at, policy, new Date()),
      };
    });
  }

  async matching(filter: MatchingFilter): Promise<ClassificationView[]> {
    const retailers = await this.retailers();
    const retailerNames = new Map(retailers.map((row) => [row.id, row.code]));
    if (filter === "unmatched") {
      const products = await this.client.select<
        ProductRow & { retailer_product_concepts: [] }
      >("retailer_products", {
        select:
          "id,retailer_id,external_id,name,brand,active,last_seen_at,package_size,package_unit,package_count,total_amount,retailer_product_concepts!left(id)",
        retailer_product_concepts: "is.null",
        order: "last_seen_at.desc",
        limit: ROW_LIMIT,
      });
      return products.map((product) => ({
        id: product.id,
        retailerProductId: product.id,
        provider: retailerNames.get(product.retailer_id) ?? product.retailer_id,
        retailerProduct: `${product.name} (${product.external_id})`,
        productConcept: null,
        concept: null,
        method: null,
        score: null,
        confidence: null,
        status: "UNMATCHED",
        updatedAt: product.last_seen_at,
      }));
    }

    const matchParameters: Record<string, string> = {
      select:
        "id,retailer_product_id,product_concept_id,method,score,confidence,status,reviewed,updated_at",
      order: "updated_at.desc",
      limit: ROW_LIMIT,
    };
    if (filter === "low") matchParameters.confidence = "eq.LOW";
    if (filter === "pending") matchParameters.status = "eq.PROPOSED";
    if (filter === "accepted") matchParameters.status = "eq.ACCEPTED";
    if (filter === "rejected") matchParameters.status = "eq.REJECTED";
    const matches = await this.client.select<ProductClassificationRow>(
      "retailer_product_concepts",
      matchParameters,
    );
    const [products, concepts] = await Promise.all([
      this.productsByIds(matches.map((match) => match.retailer_product_id)),
      this.conceptsByIds(matches.map((match) => match.product_concept_id)),
    ]);
    const productsById = new Map(products.map((row) => [row.id, row]));
    const conceptsById = new Map(concepts.map((row) => [row.id, row]));
    return matches.map((match) => {
      const product = productsById.get(match.retailer_product_id);
      return {
        id: match.id,
        retailerProductId: match.retailer_product_id,
        provider:
          product === undefined
            ? "—"
            : (retailerNames.get(product.retailer_id) ?? product.retailer_id),
        retailerProduct:
          product === undefined
            ? match.retailer_product_id
            : `${product.name} (${product.external_id})`,
        productConcept:
          conceptsById.get(match.product_concept_id)?.name ??
          match.product_concept_id,
        concept: conceptsById.get(match.product_concept_id) ?? null,
        method: match.method,
        score: match.score,
        confidence: match.confidence,
        status: match.status,
        updatedAt: match.updated_at,
      };
    });
  }

  async anomalyInputs(): Promise<{
    retailers: RetailerRow[];
    products: ProductRow[];
    offers: OfferRow[];
    history: PriceHistoryRow[];
    runs: SyncRunRow[];
  }> {
    const [retailers, products, offers, history, runs] = await Promise.all([
      this.retailers(),
      this.client.select<ProductRow>("retailer_products", {
        select:
          "id,retailer_id,external_id,name,brand,active,last_seen_at,package_size,package_unit,package_count,total_amount",
        order: "last_seen_at.desc",
        limit: "1000",
      }),
      this.client.select<OfferRow>("product_offers", {
        select:
          "id,retailer_product_id,normal_price,promo_price,price_per_unit,reference_unit,available,observed_at",
        order: "observed_at.desc",
        limit: "2000",
      }),
      this.client.select<PriceHistoryRow>("price_history", {
        select:
          "id,product_offer_id,normal_price,promo_price,price_per_unit,reference_unit,observed_at",
        order: "observed_at.desc",
        limit: "4000",
      }),
      this.runs(500),
    ]);
    return { retailers, products, offers, history, runs };
  }

  async refreshRequests(): Promise<RefreshRequestView[]> {
    const [retailers, requests] = await Promise.all([
      this.retailers(),
      this.client.select<RefreshRequestRow>("refresh_requests", {
        select:
          "id,retailer_id,request_type,postal_code,product_ids,status,requested_by,requested_at,started_at,finished_at,attempt_count,error_message",
        order: "requested_at.desc",
        limit: ROW_LIMIT,
      }),
    ]);
    const names = new Map(retailers.map((row) => [row.id, row.code]));
    return requests.map((request) => ({
      ...request,
      provider: names.get(request.retailer_id) ?? request.retailer_id,
    }));
  }

  audit(): Promise<AuditRow[]> {
    return this.client.select<AuditRow>("admin_audit_log", {
      select:
        "id,actor,action,entity_type,entity_id,before_data,after_data,created_at",
      order: "created_at.desc",
      limit: ROW_LIMIT,
    });
  }

  private retailers(): Promise<RetailerRow[]> {
    return this.client.select<RetailerRow>("retailers", {
      select: "id,code,name,active,operational_status,capabilities",
      order: "code.asc",
    });
  }

  private runs(limit: number): Promise<SyncRunRow[]> {
    return this.client.select<SyncRunRow>("provider_sync_runs", {
      select:
        "id,retailer_id,sync_type,started_at,finished_at,status,products_seen,offers_seen,error_message,metadata",
      order: "started_at.desc",
      limit: String(limit),
    });
  }

  private offersFor(ids: string[]): Promise<OfferRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.client.select<OfferRow>("product_offers", {
      select:
        "id,retailer_product_id,normal_price,promo_price,price_per_unit,reference_unit,available,observed_at",
      retailer_product_id: `in.(${ids.join(",")})`,
      order: "observed_at.desc",
    });
  }

  private productsByIds(ids: string[]): Promise<ProductRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.client.select<ProductRow>("retailer_products", {
      select:
        "id,retailer_id,external_id,name,brand,active,last_seen_at,package_size,package_unit,package_count,total_amount",
      id: `in.(${unique(ids).join(",")})`,
    });
  }

  private conceptsByIds(ids: string[]): Promise<ProductConceptRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.client.select<ProductConceptRow>("product_concepts", {
      select:
        "id,name,base_name,category,aliases,default_dimension,default_amount,default_unit,selection_policy",
      id: `in.(${unique(ids).join(",")})`,
    });
  }
}

export function offerFreshness(
  observedAt: string | undefined,
  policy: { stale_after_ms: number; very_stale_after_ms: number },
  now: Date,
): CatalogView["freshness"] {
  if (observedAt === undefined) return "NO_OFFER";
  const age = Math.max(0, now.getTime() - new Date(observedAt).getTime());
  if (age < policy.stale_after_ms) return "FRESH";
  if (age < policy.very_stale_after_ms) return "STALE";
  return "VERY_STALE";
}

function sanitizeSearch(value: string): string {
  return value
    .trim()
    .replaceAll(/[,*()]/g, " ")
    .slice(0, 100);
}

function duration(run: SyncRunRow | null): number | null {
  if (run?.finished_at === null || run === null) return null;
  return (
    new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
  );
}

function failureCount(run: SyncRunRow): number {
  if (isRecord(run.metadata) && typeof run.metadata.failed === "number") {
    return run.metadata.failed;
  }
  return run.status === "failed" ? 1 : 0;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  return groups;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
