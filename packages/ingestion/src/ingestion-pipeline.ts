import type {
  ProductOffer,
  ProviderHealth,
  RetailerProduct,
} from "@shopping-app/domain";

import { silentLogger } from "./logger.js";
import { ObservedIngestionError } from "./observed-ingestion-error.js";
import { IngestionPersistenceCore } from "./persistence-core.js";
import { createProviderExecutor, type ProviderExecutor } from "./resilience.js";
import type {
  IngestionOptions,
  IngestionRequest,
  IngestionResult,
  IngestionStore,
  IngestionStrategy,
  PreparedObservationSet,
} from "./types.js";

export class RetailerIngestionPipeline<TRequest extends IngestionRequest> {
  private readonly logger;
  private readonly now;
  private readonly executor: ProviderExecutor;
  private readonly persistence: IngestionPersistenceCore;
  private readonly batchSize: number;

  constructor(
    private readonly strategy: IngestionStrategy<TRequest>,
    store: IngestionStore,
    options: IngestionOptions = {},
  ) {
    const batchSize = positiveInteger(options.batchSize ?? 100, "batchSize");
    this.batchSize = batchSize;
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
    this.executor = createProviderExecutor(
      "retailer",
      options,
      this.logger,
      this.now,
    );
    this.persistence = new IngestionPersistenceCore(
      store,
      batchSize,
      this.logger,
      this.now,
    );
  }

  async ingest(request: TRequest): Promise<IngestionResult> {
    const market = await this.executor.run("resolve_market", () =>
      this.strategy.provider.resolveMarket(request.postalCode),
    );

    if (request.dryRun === true) {
      const collected = await this.strategy.collect(
        request,
        market,
        this.executor,
      );
      const observations = this.persistence.prepare(market, collected);
      this.logger.info("ingestion.dry_run", {
        strategy: this.strategy.kind,
        retailer: market.retailer,
        marketExternalId: market.externalId,
        productsSeen: observations.products.length,
        offersSeen: observations.offers.length,
      });
      return result(market, observations, true, collected.status);
    }

    const session = await this.persistence.open(
      market,
      this.strategy.kind,
      this.strategy.metadata(request),
    );
    let counts = { products: 0, offers: 0 };
    try {
      if (this.strategy.collectIncrementally !== undefined) {
        const seenProducts = new Set<string>();
        const seenOffers = new Set<string>();
        const productBuffer = new Map<string, RetailerProduct>();
        const offerBuffer = new Map<string, ProductOffer>();
        let pendingWrite = Promise.resolve();
        const flush = async (): Promise<void> => {
          if (productBuffer.size === 0 && offerBuffer.size === 0) return;
          const buffered: PreparedObservationSet = {
            products: [...productBuffer.values()],
            offers: [...offerBuffer.values()],
          };
          await this.persistence.persistBatch(session, buffered);
          productBuffer.clear();
          offerBuffer.clear();
        };
        const collected = await this.strategy.collectIncrementally(
          request,
          market,
          this.executor,
          (batch) => {
            const write = pendingWrite.then(async () => {
              const prepared = this.persistence.prepare(market, batch);
              for (const product of prepared.products) {
                seenProducts.add(product.externalId);
                productBuffer.set(product.externalId, product);
              }
              for (const offer of prepared.offers) {
                const key = offerKey(offer);
                seenOffers.add(key);
                offerBuffer.set(key, offer);
              }
              counts = {
                products: seenProducts.size,
                offers: seenOffers.size,
              };
              if (
                productBuffer.size >= this.batchSize ||
                offerBuffer.size >= this.batchSize
              ) {
                await flush();
              }
            });
            pendingWrite = write;
            return write;
          },
        );
        await pendingWrite;
        await flush();
        const health = await this.collectionHealth(market.retailer, collected);
        await this.persistence.complete(session, health, counts, {
          recordCatalogMisses:
            collected.status === "succeeded" &&
            isCompleteCatalogRequest(this.strategy.kind, request),
          seenProductExternalIds: [...seenProducts],
          status: collected.status,
          metadata: collectionMetadata(collected),
          ...(collected.status === "partial"
            ? {
                errorMessage: `${collected.failures.length} catalog categories failed`,
              }
            : {}),
        });
        this.logCompletion(market.retailer, session.runId, counts, collected);
        return {
          ...resultFromCounts(market, counts, false, collected.status),
          syncRunId: session.runId,
        };
      }
      const collected = await this.strategy.collect(
        request,
        market,
        this.executor,
      );
      const observations = this.persistence.prepare(market, collected);
      counts = {
        products: observations.products.length,
        offers: observations.offers.length,
      };
      const health = await this.collectionHealth(market.retailer, collected);
      await this.persistence.persist(session, observations, health, {
        recordCatalogMisses:
          collected.status === "succeeded" &&
          isCompleteCatalogRequest(this.strategy.kind, request),
        status: collected.status,
        metadata: collectionMetadata(collected),
        ...(collected.status === "partial"
          ? {
              errorMessage: `${collected.failures.length} catalog categories failed`,
            }
          : {}),
      });
      this.logCompletion(market.retailer, session.runId, counts, collected);
      return {
        ...result(market, observations, false, collected.status),
        syncRunId: session.runId,
      };
    } catch (error) {
      await this.persistence.fail(session, error, counts);
      throw new ObservedIngestionError(error);
    }
  }

  private collectionHealth(
    retailer: ProviderHealth["retailer"],
    collected: {
      status: "succeeded" | "partial";
      attemptedOperations: number;
      failures: readonly unknown[];
    },
  ): Promise<ProviderHealth> {
    return collected.status === "partial"
      ? Promise.resolve({
          retailer,
          status: "degraded" as const,
          checkedAt: this.now(),
          message: `${collected.failures.length} of ${collected.attemptedOperations} catalog operations failed`,
        })
      : this.readHealth(retailer);
  }

  private logCompletion(
    retailer: ProviderHealth["retailer"],
    runId: string,
    counts: { products: number; offers: number },
    collected: {
      status: "succeeded" | "partial";
      failures: readonly unknown[];
    },
  ): void {
    this.logger.info(
      collected.status === "succeeded"
        ? "ingestion.succeeded"
        : "ingestion.partial",
      {
        strategy: this.strategy.kind,
        retailer,
        runId,
        productsSeen: counts.products,
        offersSeen: counts.offers,
        failedOperations: collected.failures.length,
      },
    );
  }

  private async readHealth(
    retailer: ProviderHealth["retailer"],
  ): Promise<ProviderHealth> {
    try {
      return await this.executor.run("health_check", () =>
        this.strategy.provider.healthCheck(),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Health check failed";
      return {
        retailer,
        status: "degraded",
        checkedAt: this.now(),
        message,
      };
    }
  }
}

function isCompleteCatalogRequest<TRequest extends IngestionRequest>(
  strategy: IngestionStrategy<TRequest>["kind"],
  request: TRequest,
): boolean {
  return strategy === "CATALOG_SYNC" && !("categoryIds" in request);
}

function result(
  market: { retailer: IngestionResult["retailer"]; externalId: string },
  observations: { products: readonly unknown[]; offers: readonly unknown[] },
  dryRun: boolean,
  status: IngestionResult["status"],
): IngestionResult {
  return {
    retailer: market.retailer,
    marketExternalId: market.externalId,
    productsSeen: observations.products.length,
    offersSeen: observations.offers.length,
    dryRun,
    status,
  };
}

function resultFromCounts(
  market: { retailer: IngestionResult["retailer"]; externalId: string },
  counts: { products: number; offers: number },
  dryRun: boolean,
  status: IngestionResult["status"],
): IngestionResult {
  return {
    retailer: market.retailer,
    marketExternalId: market.externalId,
    productsSeen: counts.products,
    offersSeen: counts.offers,
    dryRun,
    status,
  };
}

function collectionMetadata(collected: {
  attemptedOperations: number;
  failures: readonly unknown[];
}): Readonly<Record<string, unknown>> {
  return {
    attemptedOperations: collected.attemptedOperations,
    failedOperations: collected.failures.length,
    ...(collected.failures.length === 0
      ? {}
      : { failures: collected.failures }),
  };
}

function offerKey(offer: ProductOffer): string {
  return `${offer.retailerProductId}\u0000${offer.marketId}`;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
