export interface RetailerRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
  operational_status: "ACTIVE" | "DEGRADED" | "DISABLED";
  capabilities: string[];
}

export interface HealthRow {
  retailer_id: string;
  status: "healthy" | "degraded" | "unavailable";
  checked_at: string;
  latency_ms: number | null;
  message: string | null;
  metadata: unknown;
}

export interface SyncRunRow {
  id: string;
  retailer_id: string;
  sync_type: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "succeeded" | "partial" | "failed";
  products_seen: number;
  offers_seen: number;
  error_message: string | null;
  metadata: unknown;
}

export interface ProductRow {
  id: string;
  retailer_id: string;
  external_id: string;
  name: string;
  brand: string | null;
  active: boolean;
  last_seen_at: string;
  package_size: number | null;
  package_unit: string | null;
  package_count: number | null;
  total_amount: number | null;
}

export interface OfferRow {
  id: string;
  retailer_product_id: string;
  normal_price: number;
  promo_price: number | null;
  price_per_unit: number | null;
  reference_unit: string | null;
  available: boolean;
  observed_at: string;
}

export interface ProductClassificationRow {
  id: string;
  retailer_product_id: string;
  product_concept_id: string;
  method: string;
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  status: "PROPOSED" | "ACCEPTED" | "REJECTED";
  reviewed: boolean;
  updated_at: string;
}

export interface ProductConceptRow {
  id: string;
  name: string;
  base_name: string;
  category: string | null;
  aliases: string[];
  default_dimension: "COUNT" | "MASS" | "VOLUME";
  default_amount: number | null;
  default_unit: string | null;
  selection_policy: "CHEAPEST_COVERING" | "CLOSEST_AMOUNT";
}

export interface RefreshRequestRow {
  id: string;
  retailer_id: string;
  request_type: "PRICE_REFRESH" | "CATALOG_SYNC";
  postal_code: string;
  product_ids: string[];
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  requested_by: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  attempt_count: number;
  error_message: string | null;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
}

export interface PriceHistoryRow {
  id: number;
  product_offer_id: string;
  normal_price: number;
  promo_price: number | null;
  price_per_unit: number | null;
  reference_unit: string | null;
  observed_at: string;
}
