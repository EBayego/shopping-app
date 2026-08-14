import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerProduct,
} from "@shopping-app/domain";
import type { RetailerObservationSet } from "@shopping-app/retailer-contracts";

import { safeError } from "./resilience.js";
import type {
  IngestionSession,
  IngestionScope,
  IngestionStore,
  IngestionStrategyKind,
  PreparedObservationSet,
  StructuredLogger,
} from "./types.js";

export class IngestionPersistenceCore {
  constructor(
    private readonly store: IngestionStore,
    private readonly batchSize: number,
    private readonly logger: StructuredLogger,
    private readonly now: () => Date,
  ) {}

  async open(
    market: Market,
    strategy: IngestionStrategyKind,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<IngestionSession> {
    const retailerId = await this.store.resolveRetailer(market.retailer);
    const marketId = await this.store.upsertMarket(retailerId, market);
    const runId = await this.store.startSyncRun({
      retailerId,
      marketId,
      syncType: strategy.toLowerCase(),
      startedAt: this.now(),
      metadata,
    });
    return { retailerId, marketId, runId, market };
  }

  prepare(
    market: Market,
    observations: RetailerObservationSet,
  ): PreparedObservationSet {
    validateResult(
      market.retailer,
      market.externalId,
      observations.products,
      observations.offers,
    );
    return {
      products: deduplicateProducts(observations.products),
      offers: deduplicateOffers(observations.offers),
    };
  }

  async persist(
    session: IngestionSession,
    observations: PreparedObservationSet,
    health: ProviderHealth,
    options: {
      recordCatalogMisses?: boolean;
      status?: "succeeded" | "partial";
      metadata?: Readonly<Record<string, unknown>>;
      errorMessage?: string;
    } = {},
  ): Promise<void> {
    await this.persistBatch(session, observations);
    await this.complete(
      session,
      health,
      {
        products: observations.products.length,
        offers: observations.offers.length,
      },
      {
        ...options,
        seenProductExternalIds: observations.products.map(
          (product) => product.externalId,
        ),
      },
    );
  }

  async persistBatch(
    session: IngestionSession,
    observations: PreparedObservationSet,
  ): Promise<void> {
    const scope = this.scope(session);
    for (const batch of batches(observations.products, this.batchSize)) {
      await this.store.upsertProducts(scope, batch);
    }
    for (const batch of batches(observations.offers, this.batchSize)) {
      await this.store.upsertOffers(scope, batch);
    }
  }

  async complete(
    session: IngestionSession,
    health: ProviderHealth,
    counts: { products: number; offers: number },
    options: {
      recordCatalogMisses?: boolean;
      seenProductExternalIds?: readonly string[];
      status?: "succeeded" | "partial";
      metadata?: Readonly<Record<string, unknown>>;
      errorMessage?: string;
    } = {},
  ): Promise<void> {
    if (options.recordCatalogMisses === true) {
      await this.store.recordCatalogProductMisses(
        this.scope(session),
        session.runId,
        options.seenProductExternalIds ?? [],
      );
    }
    await this.finish(
      session,
      health,
      options.status ?? "succeeded",
      counts,
      {
        batchSize: this.batchSize,
        productsSeen: counts.products,
        ...options.metadata,
      },
      options.errorMessage,
    );
  }

  async persistOffers(
    session: IngestionSession,
    offers: readonly ProductOffer[],
    health: ProviderHealth,
    status: "succeeded" | "partial" | "failed" = "succeeded",
    metadata: Readonly<Record<string, unknown>> = {},
    errorMessage?: string,
  ): Promise<void> {
    const scope = this.scope(session);
    for (const batch of batches(offers, this.batchSize)) {
      await this.store.upsertOffers(scope, batch);
    }
    await this.finish(
      session,
      health,
      status,
      {
        products: Number(metadata.productsSeen ?? 0),
        offers: offers.length,
      },
      { batchSize: this.batchSize, ...metadata },
      errorMessage,
    );
  }

  private async finish(
    session: IngestionSession,
    health: ProviderHealth,
    status: "succeeded" | "partial" | "failed",
    counts: { products: number; offers: number },
    metadata: Readonly<Record<string, unknown>>,
    errorMessage?: string,
  ): Promise<void> {
    const failedCount =
      typeof metadata.failed === "number" ? metadata.failed : "Some";
    const scope = this.scope(session);
    await this.store.updateProviderHealth(scope, health, {
      syncRunId: session.runId,
    });
    await this.store.finishSyncRun({
      runId: session.runId,
      status,
      finishedAt: this.now(),
      productsSeen: counts.products,
      offersSeen: counts.offers,
      ...(status === "succeeded"
        ? {}
        : {
            errorMessage:
              errorMessage ?? `${failedCount} ingestion operations failed`,
          }),
      metadata,
    });
  }

  async fail(
    session: IngestionSession,
    error: unknown,
    counts: { products: number; offers: number },
  ): Promise<void> {
    const errorInfo = safeError(error);
    const message = String(errorInfo.message ?? errorInfo.name);
    const finalization = await Promise.allSettled([
      this.store.finishSyncRun({
        runId: session.runId,
        status: "failed",
        finishedAt: this.now(),
        productsSeen: counts.products,
        offersSeen: counts.offers,
        errorMessage: message,
        metadata: { error: errorInfo },
      }),
      this.store.updateProviderHealth(
        { retailerId: session.retailerId, marketId: session.marketId },
        {
          retailer: session.market.retailer,
          status: "unavailable",
          checkedAt: this.now(),
          message,
        },
        { syncRunId: session.runId },
      ),
    ]);
    const finalizationErrors = finalization.flatMap((result) =>
      result.status === "rejected" ? [safeError(result.reason)] : [],
    );
    this.logger.error("ingestion.failed", {
      retailer: session.market.retailer,
      runId: session.runId,
      error: errorInfo,
      ...(finalizationErrors.length === 0 ? {} : { finalizationErrors }),
    });
  }

  private scope(session: IngestionSession): IngestionScope {
    return {
      retailerId: session.retailerId,
      marketId: session.marketId,
    };
  }
}

function validateResult(
  retailer: RetailerProduct["retailer"],
  marketExternalId: string,
  products: readonly RetailerProduct[],
  offers: readonly ProductOffer[],
): void {
  for (const product of products) {
    if (
      product.retailer !== retailer ||
      product.marketId !== marketExternalId
    ) {
      throw new Error(
        `Provider returned product ${product.externalId} for a different retailer or market`,
      );
    }
  }
  for (const offer of offers) {
    if (offer.marketId !== marketExternalId) {
      throw new Error(
        `Provider returned offer ${offer.retailerProductId} for a different market`,
      );
    }
  }
}

function deduplicateProducts(
  products: readonly RetailerProduct[],
): RetailerProduct[] {
  const unique = new Map<string, RetailerProduct>();
  for (const product of products) unique.set(product.externalId, product);
  return [...unique.values()];
}

function deduplicateOffers(offers: readonly ProductOffer[]): ProductOffer[] {
  const unique = new Map<string, ProductOffer>();
  for (const offer of offers) {
    unique.set(`${offer.retailerProductId}\u0000${offer.marketId}`, offer);
  }
  return [...unique.values()];
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
