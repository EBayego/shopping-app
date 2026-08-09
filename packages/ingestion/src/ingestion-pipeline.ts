import type { ProviderHealth } from "@shopping-app/domain";

import { silentLogger } from "./logger.js";
import { IngestionPersistenceCore } from "./persistence-core.js";
import { createProviderExecutor, type ProviderExecutor } from "./resilience.js";
import type {
  IngestionOptions,
  IngestionRequest,
  IngestionResult,
  IngestionStore,
  IngestionStrategy,
} from "./types.js";

export class RetailerIngestionPipeline<TRequest extends IngestionRequest> {
  private readonly logger;
  private readonly now;
  private readonly executor: ProviderExecutor;
  private readonly persistence: IngestionPersistenceCore;

  constructor(
    private readonly strategy: IngestionStrategy<TRequest>,
    store: IngestionStore,
    options: IngestionOptions = {},
  ) {
    const batchSize = positiveInteger(options.batchSize ?? 100, "batchSize");
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
      return result(market, observations, true);
    }

    const session = await this.persistence.open(
      market,
      this.strategy.kind,
      this.strategy.metadata(request),
    );
    let counts = { products: 0, offers: 0 };
    try {
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
      const health = await this.readHealth(market.retailer);
      await this.persistence.persist(session, observations, health);
      this.logger.info("ingestion.succeeded", {
        strategy: this.strategy.kind,
        retailer: market.retailer,
        runId: session.runId,
        productsSeen: counts.products,
        offersSeen: counts.offers,
      });
      return {
        ...result(market, observations, false),
        syncRunId: session.runId,
      };
    } catch (error) {
      await this.persistence.fail(session, error, counts);
      throw error;
    }
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

function result(
  market: { retailer: IngestionResult["retailer"]; externalId: string },
  observations: { products: readonly unknown[]; offers: readonly unknown[] },
  dryRun: boolean,
): IngestionResult {
  return {
    retailer: market.retailer,
    marketExternalId: market.externalId,
    productsSeen: observations.products.length,
    offersSeen: observations.offers.length,
    dryRun,
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
