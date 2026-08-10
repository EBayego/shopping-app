import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerProduct,
} from "@shopping-app/domain";
import {
  MarketResolutionError,
  ProductNotFoundError,
  ProviderCapabilityUnavailableError,
  ProviderContractChangedError,
  ProviderUnavailableError,
  RateLimitedError,
  type RetailerProvider,
  type PriceRefreshRetailerProvider,
} from "@shopping-app/retailer-contracts";

import { parseAlcampoProduct, type AlcampoProductDto } from "./alcampo-dtos.js";
import {
  AlcampoHttpClient,
  AlcampoHttpError,
  type AlcampoHttpClientOptions,
} from "./alcampo-http-client.js";
import { AlcampoMapper } from "./alcampo-mapper.js";
import { AlcampoSessionContext } from "./alcampo-session-context.js";

export interface AlcampoProviderOptions extends AlcampoHttpClientOptions {
  sessionContext?: AlcampoSessionContext;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export class AlcampoProvider
  implements RetailerProvider, PriceRefreshRetailerProvider
{
  private readonly client: AlcampoHttpClient;
  private readonly mapper = new AlcampoMapper();
  private readonly context: AlcampoSessionContext | undefined;
  private readonly now: () => Date;

  constructor(options: AlcampoProviderOptions = {}) {
    this.client = new AlcampoHttpClient(options);
    this.context =
      options.sessionContext ??
      AlcampoSessionContext.fromEnvironment(options.environment ?? process.env);
    this.now = options.now ?? (() => new Date());
  }

  resolveMarket(postalCode: string): Promise<Market> {
    void postalCode;
    return Promise.reject(
      new ProviderCapabilityUnavailableError("ALCAMPO", "resolveMarket", {
        message:
          "Alcampo store and session selection endpoints are not confirmed",
      }),
    );
  }

  configuredMarket(): Market {
    return this.mapper.toMarket(this.requireContext());
  }

  async getProduct(
    externalId: string,
    market: Market,
  ): Promise<RetailerProduct> {
    const dto = await this.loadProduct(externalId, market);
    return this.mapper.toProduct(dto, market, this.now());
  }

  async refreshPrices(
    productIds: string[],
    market: Market,
  ): Promise<ProductOffer[]> {
    return Promise.all(
      productIds.map(async (productId) => {
        const dto = await this.loadProduct(productId, market);
        return this.mapper.toOffer(dto, market, this.now());
      }),
    );
  }

  healthCheck(): Promise<ProviderHealth> {
    const enabled = this.context !== undefined;
    return Promise.resolve({
      retailer: "ALCAMPO",
      status: enabled ? "degraded" : "unavailable",
      checkedAt: this.now(),
      message: enabled
        ? "Experimental product detail is configured with caller-supplied browser session context"
        : "Live capabilities are disabled: no legitimate Alcampo browser session context is configured",
    });
  }

  private async loadProduct(
    externalId: string,
    market: Market,
  ): Promise<AlcampoProductDto> {
    const normalizedExternalId = externalId.trim();
    if (normalizedExternalId === "")
      throw new ProductNotFoundError("ALCAMPO", externalId);
    const context = this.contextFor(market);
    try {
      const payload = await this.client.getProduct(
        normalizedExternalId,
        context,
      );
      const dto = parseAlcampoProduct(payload);
      if (dto === undefined || dto.retailerProductId !== normalizedExternalId) {
        throw new ProviderContractChangedError("ALCAMPO", {
          message:
            "Alcampo product response is incompatible with the confirmed contract",
        });
      }
      return dto;
    } catch (error) {
      if (error instanceof ProviderContractChangedError) throw error;
      if (error instanceof AlcampoHttpError && error.status === 404) {
        throw new ProductNotFoundError("ALCAMPO", normalizedExternalId, {
          cause: error,
        });
      }
      if (
        error instanceof AlcampoHttpError &&
        error.kind === "invalid-response"
      ) {
        throw new ProviderContractChangedError("ALCAMPO", { cause: error });
      }
      if (error instanceof AlcampoHttpError && error.status === 429) {
        throw new RateLimitedError("ALCAMPO", {
          ...(error.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: error.retryAfterMs }),
          cause: error,
        });
      }
      throw new ProviderUnavailableError("ALCAMPO", {
        message:
          error instanceof AlcampoHttpError && error.status === 403
            ? "Alcampo rejected the supplied session context with HTTP 403"
            : "Alcampo product detail is unavailable",
        cause: error,
      });
    }
  }

  private requireContext(): AlcampoSessionContext {
    if (this.context === undefined) {
      throw new ProviderCapabilityUnavailableError("ALCAMPO", "liveRequests", {
        message:
          "Live Alcampo requests require explicit legitimate session context",
      });
    }
    return this.context;
  }

  private contextFor(market: Market): AlcampoSessionContext {
    const context = this.requireContext();
    if (
      market.retailer !== "ALCAMPO" ||
      market.externalId !== context.marketExternalId ||
      market.postalCode !== context.postalCode
    ) {
      throw new MarketResolutionError("ALCAMPO", market.postalCode, {
        message:
          "Market does not match the configured Alcampo browser session context",
      });
    }
    return context;
  }
}
