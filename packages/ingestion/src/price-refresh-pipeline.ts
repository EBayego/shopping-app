import type { ProviderHealth } from "@shopping-app/domain";

import { silentLogger } from "./logger.js";
import { ObservedIngestionError } from "./observed-ingestion-error.js";
import { IngestionPersistenceCore } from "./persistence-core.js";
import {
  DEFAULT_RECENT_USAGE_WINDOW_MS,
  PriceRefreshSelectionPolicy,
} from "./price-refresh-policy.js";
import { PriceRefreshIngestionStrategy } from "./price-refresh-strategy.js";
import {
  createProviderExecutor,
  isTransientProviderError,
  safeError,
  type ProviderExecutor,
} from "./resilience.js";
import type {
  IngestionOptions,
  PriceRefreshFailure,
  PriceRefreshRequest,
  PriceRefreshResult,
  PriceRefreshStore,
} from "./types.js";

export type PriceRefreshPipelineOptions = IngestionOptions;

export class PriceRefreshPipeline {
  private readonly logger;
  private readonly now;
  private readonly executor: ProviderExecutor;
  private readonly persistence: IngestionPersistenceCore;

  constructor(
    private readonly strategy: PriceRefreshIngestionStrategy,
    private readonly store: PriceRefreshStore,
    options: PriceRefreshPipelineOptions = {},
  ) {
    const batchSize = options.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError("batchSize must be a positive integer");
    }
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? (() => new Date());
    this.executor = createProviderExecutor(
      "price_refresh",
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

  async refresh(request: PriceRefreshRequest): Promise<PriceRefreshResult> {
    const market = await this.executor.run("resolve_market", () =>
      this.strategy.provider.resolveMarket(request.postalCode),
    );
    const retailerId = await this.store.resolveRetailer(market.retailer);
    const databaseFreshness = await this.store.getOfferFreshnessConfig();
    const selection = new PriceRefreshSelectionPolicy(
      {
        ...databaseFreshness,
        recentUsageWindowMs: DEFAULT_RECENT_USAGE_WINDOW_MS,
      },
      this.now,
    );

    if (request.dryRun === true) {
      const marketId = await this.store.findMarketId(retailerId, market);
      const candidates =
        marketId === undefined
          ? []
          : await this.store.listPriceRefreshCandidates({
              retailerId,
              marketId,
            });
      const selected = selection.select(candidates, request.productIds);
      return {
        retailer: market.retailer,
        marketExternalId: market.externalId,
        productsSeen: 0,
        offersSeen: 0,
        dryRun: true,
        attempted: selected.length,
        failures: [],
        status: "succeeded",
      };
    }

    const session = await this.persistence.open(market, this.strategy.kind, {
      postalCode: request.postalCode,
      ...(request.productIds === undefined
        ? {}
        : { manualProductIds: [...request.productIds] }),
    });
    try {
      const candidates = await this.store.listPriceRefreshCandidates(session);
      const selected = selection.select(candidates, request.productIds);
      const outcomes = await Promise.all(
        selected.map(async (candidate) => {
          try {
            const offers = await this.strategy.refreshProduct(
              candidate.retailerProductExternalId,
              market,
              this.executor,
            );
            if (offers.length === 0) {
              throw new Error(
                `Price refresh returned no offer for ${candidate.retailerProductExternalId}`,
              );
            }
            if (
              offers.some(
                (offer) =>
                  offer.retailerProductId !==
                    candidate.retailerProductExternalId ||
                  offer.marketId !== market.externalId,
              )
            ) {
              throw new Error(
                `Price refresh returned an offer for a different product or market`,
              );
            }
            return { offers, candidate } as const;
          } catch (error) {
            return {
              failure: {
                retailerProductExternalId: candidate.retailerProductExternalId,
                error: safeError(error),
              } satisfies PriceRefreshFailure,
              transient: isTransientProviderError(error),
            } as const;
          }
        }),
      );
      const offers = outcomes.flatMap((outcome) =>
        "offers" in outcome ? outcome.offers : [],
      );
      const failures = outcomes.flatMap((outcome) =>
        "failure" in outcome ? [outcome.failure] : [],
      );
      const status =
        failures.length === 0
          ? "succeeded"
          : offers.length === 0
            ? "failed"
            : "partial";
      const health = await this.completionHealth(
        market.retailer,
        status,
        outcomes.some((outcome) => "transient" in outcome && outcome.transient),
        failures.length,
      );
      const prepared = this.persistence.prepare(market, {
        products: [],
        offers,
      });
      await this.persistence.persistOffers(
        session,
        prepared.offers,
        health,
        status,
        {
          attempted: selected.length,
          failed: failures.length,
          failureProductIds: failures.map(
            (failure) => failure.retailerProductExternalId,
          ),
        },
        failures.length === 0
          ? undefined
          : `${failures.length} product price refreshes failed`,
      );
      this.logger.info("price_refresh.completed", {
        retailer: market.retailer,
        runId: session.runId,
        status,
        attempted: selected.length,
        succeeded: offers.length,
        failed: failures.length,
        ...(failures.length === 0 ? {} : { failures }),
      });
      return {
        retailer: market.retailer,
        marketExternalId: market.externalId,
        productsSeen: 0,
        offersSeen: prepared.offers.length,
        dryRun: false,
        syncRunId: session.runId,
        attempted: selected.length,
        failures,
        status,
      };
    } catch (error) {
      await this.persistence.fail(session, error, { products: 0, offers: 0 });
      throw new ObservedIngestionError(error);
    }
  }

  private async completionHealth(
    retailer: ProviderHealth["retailer"],
    status: PriceRefreshResult["status"],
    hasTransientFailure: boolean,
    failureCount: number,
  ): Promise<ProviderHealth> {
    if (status !== "succeeded") {
      return {
        retailer,
        status:
          status === "failed" && hasTransientFailure
            ? "unavailable"
            : "degraded",
        checkedAt: this.now(),
        message: `${failureCount} product price refreshes failed`,
      };
    }
    try {
      return await this.executor.run("health_check", () =>
        this.strategy.provider.healthCheck(),
      );
    } catch (error) {
      const errorInfo = safeError(error);
      return {
        retailer,
        status: "degraded",
        checkedAt: this.now(),
        message:
          typeof errorInfo.message === "string"
            ? errorInfo.message
            : "Health check failed",
      };
    }
  }
}
