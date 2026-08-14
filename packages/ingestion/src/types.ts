import type {
  Market,
  ProductOffer,
  ProviderHealth,
  Retailer,
  RetailerProduct,
} from "@shopping-app/domain";
import type {
  RetailerObservationSet,
  RetailerProvider,
} from "@shopping-app/retailer-contracts";
import type { OfferFreshnessConfig } from "./price-refresh-policy.js";

export interface IngestionScope {
  retailerId: string;
  marketId: string;
}

export interface StartSyncRunInput extends IngestionScope {
  syncType: string;
  metadata: Readonly<Record<string, unknown>>;
  startedAt: Date;
}

export interface FinishSyncRunInput {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  finishedAt: Date;
  productsSeen: number;
  offersSeen: number;
  errorMessage?: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface IngestionStore {
  resolveRetailer(retailer: Retailer): Promise<string>;
  upsertMarket(retailerId: string, market: Market): Promise<string>;
  startSyncRun(input: StartSyncRunInput): Promise<string>;
  upsertProducts(
    scope: IngestionScope,
    products: readonly RetailerProduct[],
  ): Promise<void>;
  upsertOffers(
    scope: IngestionScope,
    offers: readonly ProductOffer[],
  ): Promise<void>;
  recordCatalogProductMisses(
    scope: IngestionScope,
    syncRunId: string,
    seenExternalIds: readonly string[],
  ): Promise<void>;
  finishSyncRun(input: FinishSyncRunInput): Promise<void>;
  updateProviderHealth(
    scope: IngestionScope,
    health: ProviderHealth,
    metadata?: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  recordPreflightFailure?(input: PreflightFailureInput): Promise<void>;
}

export interface PreflightFailureInput {
  retailer: Retailer;
  syncType: IngestionStrategyKind;
  startedAt: Date;
  finishedAt: Date;
  errorMessage: string;
}

export interface StructuredLogger {
  debug(event: string, context?: Readonly<Record<string, unknown>>): void;
  info(event: string, context?: Readonly<Record<string, unknown>>): void;
  warn(event: string, context?: Readonly<Record<string, unknown>>): void;
  error(event: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetAfterMs: number;
}

export interface IngestionOptions {
  batchSize?: number;
  providerConcurrency?: number;
  retry?: Partial<RetryOptions>;
  circuitBreaker?: Partial<CircuitBreakerOptions>;
  logger?: StructuredLogger;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export interface IngestionRequest {
  postalCode: string;
  dryRun?: boolean;
}

export interface SearchIngestionRequest extends IngestionRequest {
  query: string;
}

export interface CatalogIngestionRequest extends IngestionRequest {
  categoryIds?: readonly string[];
}

export type IngestionStrategyKind =
  "SEARCH_INGESTION" | "CATALOG_SYNC" | "PRICE_REFRESH";

export interface ProviderOperationRunner {
  run<T>(operation: string, action: () => Promise<T>): Promise<T>;
}

export interface IngestionStrategy<TRequest extends IngestionRequest> {
  readonly kind: IngestionStrategyKind;
  readonly provider: RetailerProvider;
  collect(
    request: TRequest,
    market: Market,
    runner: ProviderOperationRunner,
  ): Promise<IngestionCollectionResult>;
  collectIncrementally?(
    request: TRequest,
    market: Market,
    runner: ProviderOperationRunner,
    consume: IngestionObservationConsumer,
  ): Promise<IncrementalIngestionCollectionResult>;
  metadata(request: TRequest): Readonly<Record<string, unknown>>;
}

export interface IngestionCollectionFailure {
  subject: string;
  error: Readonly<Record<string, unknown>>;
}

export interface IngestionCollectionResult extends RetailerObservationSet {
  status: "succeeded" | "partial";
  attemptedOperations: number;
  failures: readonly IngestionCollectionFailure[];
}

export interface IncrementalIngestionCollectionResult {
  status: "succeeded" | "partial";
  attemptedOperations: number;
  failures: readonly IngestionCollectionFailure[];
}

export type IngestionObservationConsumer = (
  observations: RetailerObservationSet,
) => Promise<void>;

export interface PreparedObservationSet {
  products: RetailerProduct[];
  offers: ProductOffer[];
}

export interface IngestionSession extends IngestionScope {
  runId: string;
  market: Market;
}

export interface PriceRefreshCandidate {
  retailerProductExternalId: string;
  offerObservedAt?: Date;
  inActiveList: boolean;
  lastUsedAt?: Date;
}

export interface PriceRefreshCandidateSource {
  getOfferFreshnessConfig(): Promise<OfferFreshnessConfig>;
  findMarketId(retailerId: string, market: Market): Promise<string | undefined>;
  listPriceRefreshCandidates(
    scope: IngestionScope,
  ): Promise<readonly PriceRefreshCandidate[]>;
  deactivateProducts(
    scope: IngestionScope,
    externalIds: readonly string[],
  ): Promise<void>;
}

export type PriceRefreshStore = IngestionStore & PriceRefreshCandidateSource;

export interface PriceRefreshRequest extends IngestionRequest {
  productIds?: readonly string[];
}

export interface PriceRefreshFailure {
  retailerProductExternalId: string;
  error: Readonly<Record<string, unknown>>;
}

export interface PriceRefreshResult extends IngestionResult {
  attempted: number;
  failures: readonly PriceRefreshFailure[];
  retiredProductIds: readonly string[];
  status: "succeeded" | "partial" | "failed";
}

export interface IngestionResult {
  retailer: Retailer;
  marketExternalId: string;
  productsSeen: number;
  offersSeen: number;
  dryRun: boolean;
  status: "succeeded" | "partial" | "failed";
  syncRunId?: string;
}
