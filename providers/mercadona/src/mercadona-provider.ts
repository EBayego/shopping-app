import type {
  Market,
  ProductOffer,
  ProviderHealth,
  RetailerCategory,
  RetailerProduct,
} from "@shopping-app/domain";
import {
  MarketResolutionError,
  ProductNotFoundError,
  ProviderCapabilityUnavailableError,
  ProviderContractChangedError,
  ProviderUnavailableError,
  RateLimitedError,
  type CatalogRetailerProvider,
  type RetailerSearchResult,
} from "@shopping-app/retailer-contracts";

import {
  parseMercadonaCategories,
  parseMercadonaCategoryDetail,
  parseMercadonaProduct,
  type MercadonaProductDto,
} from "./mercadona-dtos.js";
import {
  MercadonaHttpClient,
  MercadonaHttpError,
  type MercadonaHttpClientOptions,
} from "./mercadona-http-client.js";
import { MercadonaMapper } from "./mercadona-mapper.js";
import { MercadonaMarketContext } from "./mercadona-market-context.js";

export interface MercadonaProviderOptions extends MercadonaHttpClientOptions {
  now?: () => Date;
}

export class MercadonaProvider implements CatalogRetailerProvider {
  private readonly client: MercadonaHttpClient;
  private readonly mapper = new MercadonaMapper();
  private readonly now: () => Date;
  private readonly contexts = new WeakMap<Market, MercadonaMarketContext>();

  constructor(options: MercadonaProviderOptions = {}) {
    this.client = new MercadonaHttpClient(options);
    this.now = options.now ?? (() => new Date());
  }

  async resolveMarket(postalCode: string): Promise<Market> {
    const normalizedPostalCode = postalCode.trim();
    if (normalizedPostalCode === "") {
      throw new MarketResolutionError("MERCADONA", postalCode);
    }
    try {
      const dto = await this.client.changePostalCode(normalizedPostalCode);
      if (dto.postalCode !== normalizedPostalCode) {
        throw new ProviderContractChangedError("MERCADONA", {
          message: "Mercadona resolved a different postal code",
        });
      }
      const context = new MercadonaMarketContext({
        postalCode: dto.postalCode,
        warehouse: dto.warehouse,
      });
      const market = this.mapper.toMarket(context);
      this.contexts.set(market, context);
      return market;
    } catch (error) {
      throw this.marketError(normalizedPostalCode, error);
    }
  }

  searchProducts(query: string, market: Market): Promise<RetailerSearchResult> {
    void query;
    void market;
    return Promise.reject(
      new ProviderCapabilityUnavailableError("MERCADONA", "searchProducts", {
        message:
          "Mercadona has no confirmed remote text-search endpoint; ingest categories and products instead",
      }),
    );
  }

  async getCategories(market: Market): Promise<RetailerCategory[]> {
    const context = this.contextFor(market);
    try {
      const payload = await this.client.getCategories(context);
      const dtos = parseMercadonaCategories(payload);
      if (dtos === undefined) throw this.contractError("categories");
      return dtos.flatMap((dto) => this.mapper.toCategories(dto));
    } catch (error) {
      throw this.catalogError(error);
    }
  }

  async getProductsByCategory(
    categoryId: string,
    market: Market,
  ): Promise<RetailerSearchResult> {
    const normalizedCategoryId = categoryId.trim();
    if (normalizedCategoryId === "") {
      throw new RangeError("Mercadona category id cannot be empty");
    }
    const context = this.contextFor(market);
    try {
      const payload = await this.client.getCategory(
        normalizedCategoryId,
        context,
      );
      const dto = parseMercadonaCategoryDetail(payload);
      if (dto === undefined || dto.id !== normalizedCategoryId) {
        throw this.contractError("category");
      }
      const observedAt = this.now();
      const productDtos = dto.groups.flatMap((group) => group.products);
      return {
        products: productDtos.map((product) =>
          this.mapper.toProduct(product, market, observedAt, dto.name),
        ),
        offers: productDtos.map((product) =>
          this.mapper.toOffer(product, market, observedAt),
        ),
      };
    } catch (error) {
      throw this.catalogError(error);
    }
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
    return Promise.resolve({
      retailer: "MERCADONA",
      status: "degraded",
      checkedAt: this.now(),
      message:
        "Catalog ingestion is available; remote text search is not confirmed",
    });
  }

  private async loadProduct(
    externalId: string,
    market: Market,
  ): Promise<MercadonaProductDto> {
    const normalizedExternalId = externalId.trim();
    if (normalizedExternalId === "") {
      throw new ProductNotFoundError("MERCADONA", externalId);
    }
    const context = this.contextFor(market);
    try {
      const payload = await this.client.getProduct(
        normalizedExternalId,
        context,
      );
      const dto = parseMercadonaProduct(payload);
      if (dto === undefined || dto.id !== normalizedExternalId) {
        throw this.contractError("product");
      }
      return dto;
    } catch (error) {
      if (error instanceof MercadonaHttpError && error.status === 404) {
        throw new ProductNotFoundError("MERCADONA", normalizedExternalId, {
          cause: error,
        });
      }
      throw this.catalogError(error);
    }
  }

  private contextFor(market: Market): MercadonaMarketContext {
    if (market.retailer !== "MERCADONA") {
      throw new MarketResolutionError("MERCADONA", market.postalCode, {
        message: `Market belongs to ${market.retailer}, not MERCADONA`,
      });
    }
    const context = this.contexts.get(market);
    if (context === undefined) {
      throw new MarketResolutionError("MERCADONA", market.postalCode, {
        message:
          "Mercadona market context is not available in this provider instance",
      });
    }
    return context;
  }

  private contractError(resource: string): ProviderContractChangedError {
    return new ProviderContractChangedError("MERCADONA", {
      message: `Mercadona ${resource} response is incompatible with the expected contract`,
    });
  }

  private marketError(postalCode: string, error: unknown): Error {
    if (
      error instanceof ProviderContractChangedError ||
      error instanceof MarketResolutionError
    ) {
      return error;
    }
    if (
      error instanceof MercadonaHttpError &&
      error.kind === "invalid-response"
    ) {
      return this.contractError("market");
    }
    return (
      this.commonHttpError(error) ??
      new MarketResolutionError("MERCADONA", postalCode, { cause: error })
    );
  }

  private catalogError(error: unknown): Error {
    if (
      error instanceof ProviderContractChangedError ||
      error instanceof MarketResolutionError ||
      error instanceof ProductNotFoundError
    ) {
      return error;
    }
    if (
      error instanceof MercadonaHttpError &&
      error.kind === "invalid-response"
    ) {
      return this.contractError("catalog");
    }
    return (
      this.commonHttpError(error) ??
      new ProviderUnavailableError("MERCADONA", { cause: error })
    );
  }

  private commonHttpError(error: unknown): Error | undefined {
    if (!(error instanceof MercadonaHttpError)) return undefined;
    if (error.status === 429) {
      return new RateLimitedError("MERCADONA", {
        ...(error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs }),
        cause: error,
      });
    }
    return new ProviderUnavailableError("MERCADONA", { cause: error });
  }
}
