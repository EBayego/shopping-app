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
  ProviderContractChangedError,
  ProviderUnavailableError,
  RateLimitedError,
  type CatalogRetailerProvider,
  type PriceRefreshRetailerProvider,
  type RetailerSearchResult,
  type SearchRetailerProvider,
} from "@shopping-app/retailer-contracts";

import {
  EroskiCatalogParser,
  EroskiCatalogStructureError,
} from "./eroski-catalog-parser.js";
import type { EroskiCategoryDto, EroskiProductDto } from "./eroski-dtos.js";
import {
  EroskiHtmlParser,
  EroskiHtmlStructureError,
} from "./eroski-html-parser.js";
import {
  EroskiHttpClient,
  EroskiHttpError,
  type EroskiHttpClientOptions,
} from "./eroski-http-client.js";
import { EroskiMapper } from "./eroski-mapper.js";
import type { EroskiSessionContext } from "./eroski-session-context.js";

const DEFAULT_MAX_CATALOG_PAGES = 100;
const DEFAULT_CONCURRENCY = 4;

export interface EroskiProviderOptions extends EroskiHttpClientOptions {
  now?: () => Date;
  maxCatalogPages?: number;
  concurrency?: number;
}

export class EroskiProvider
  implements
    SearchRetailerProvider,
    CatalogRetailerProvider,
    PriceRefreshRetailerProvider
{
  private readonly client: EroskiHttpClient;
  private readonly catalogParser = new EroskiCatalogParser();
  private readonly productParser = new EroskiHtmlParser();
  private readonly mapper = new EroskiMapper();
  private readonly now: () => Date;
  private readonly maxCatalogPages: number;
  private readonly concurrency: number;
  private readonly contexts = new WeakMap<Market, EroskiSessionContext>();
  private readonly categories = new Map<string, EroskiCategoryDto>();
  private catalogOperations = 0;
  private readonly catalogWaiters: Array<() => void> = [];
  private activeContext: EroskiSessionContext | undefined;

  constructor(options: EroskiProviderOptions = {}) {
    this.client = new EroskiHttpClient(options);
    this.now = options.now ?? (() => new Date());
    this.maxCatalogPages = options.maxCatalogPages ?? DEFAULT_MAX_CATALOG_PAGES;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    if (!Number.isInteger(this.maxCatalogPages) || this.maxCatalogPages < 1)
      throw new RangeError("Eroski maxCatalogPages must be a positive integer");
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1)
      throw new RangeError("Eroski concurrency must be a positive integer");
  }

  async resolveMarket(postalCode: string): Promise<Market> {
    const normalized = postalCode.trim();
    if (normalized === "")
      throw new MarketResolutionError("EROSKI", postalCode);
    try {
      const context = await this.client.bootstrap();
      this.activeContext = context;
      const market: Market = {
        retailer: "EROSKI",
        externalId: `shop-ref:${context.shopRef}`,
        postalCode: normalized,
        name: `Eroski ${context.shopName}`,
        metadata: {
          shopRef: context.shopRef,
          shopName: context.shopName,
          marketResolution: "public-default",
          pricesMayVaryByLocation: true,
        },
      };
      this.contexts.set(market, context);
      return market;
    } catch (error) {
      if (error instanceof MarketResolutionError) throw error;
      const mapped = this.providerError(error, "public market bootstrap");
      throw mapped instanceof RateLimitedError
        ? mapped
        : new MarketResolutionError("EROSKI", normalized, {
            message: "Eroski public default market could not be resolved",
            cause: mapped,
          });
    }
  }

  getCategories(market: Market): Promise<RetailerCategory[]> {
    const context = this.contextFor(market);
    try {
      const parsed = this.catalogParser.parseCategories(
        context.homeHtml,
        context.homeUrl,
      );
      this.categories.clear();
      for (const category of parsed)
        this.categories.set(category.externalId, category);
      return Promise.resolve(
        parsed.map((category) => ({
          externalId: category.externalId,
          name: category.name,
          level: 2,
          order: category.order,
        })),
      );
    } catch (error) {
      return Promise.reject(this.providerError(error, "category navigation"));
    }
  }

  async getProductsByCategory(
    categoryId: string,
    market: Market,
  ): Promise<RetailerSearchResult> {
    const normalized = categoryId.trim();
    if (!/^\d+$/.test(normalized))
      throw new RangeError("Eroski category id must be numeric");
    const context = this.contextFor(market);
    return this.withCatalogSlot(async () => {
      try {
        const categoryContext = context.fork();
        if (!this.categories.has(normalized)) await this.getCategories(market);
        const category = this.categories.get(normalized);
        if (category === undefined)
          throw new ProviderContractChangedError("EROSKI", {
            message: `Eroski category ${normalized} is absent from the public navigation`,
          });
        const document = await this.client.getCategoryPage(
          category.path,
          categoryContext,
        );
        const products = new Map<string, EroskiProductDto>();
        for (const dto of this.catalogParser.parseProducts(
          document.html,
          document.url,
          categoryContext.shopRef,
          category,
        ))
          products.set(dto.externalId, dto);

        let terminated = false;
        for (
          let pageNumber = 1;
          pageNumber <= this.maxCatalogPages;
          pageNumber += 1
        ) {
          const fragment = await this.client.getCategoryProductsPage(
            category.path,
            pageNumber,
            document.url,
            categoryContext,
          );
          const pageProducts = this.catalogParser.parseProducts(
            fragment,
            document.url,
            categoryContext.shopRef,
            category,
          );
          if (pageProducts.length === 0) {
            terminated = true;
            break;
          }
          for (const dto of pageProducts) products.set(dto.externalId, dto);
        }
        if (!terminated)
          throw new ProviderContractChangedError("EROSKI", {
            message: `Eroski category pagination exceeded ${this.maxCatalogPages} pages`,
          });
        return this.observations([...products.values()], market);
      } catch (error) {
        throw this.providerError(error, "category products");
      }
    });
  }

  async searchProducts(
    query: string,
    market: Market,
  ): Promise<RetailerSearchResult> {
    const normalized = query.trim();
    if (normalized === "")
      throw new RangeError("Eroski search query cannot be empty");
    const context = this.contextFor(market);
    try {
      const document = await this.client.getSearchPage(normalized, context);
      return this.observations(
        this.catalogParser.parseProducts(
          document.html,
          document.url,
          context.shopRef,
        ),
        market,
      );
    } catch (error) {
      throw this.providerError(error, "search");
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
    const unique = [
      ...new Set(productIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (unique.length === 0) return [];
    const outcomes = await this.settledMap(unique, (id) =>
      this.loadProduct(id, market),
    );
    const successes = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value] : [],
    );
    if (successes.length === 0)
      throw (outcomes[0] as PromiseRejectedResult).reason;
    const observedAt = this.now();
    return successes.map((dto) => this.mapper.toOffer(dto, market, observedAt));
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      retailer: "EROSKI",
      status: "degraded",
      checkedAt: this.now(),
      message:
        this.activeContext === undefined
          ? "Eroski uses a public default grocery shop; prices may vary by location"
          : `Eroski public shop ${this.activeContext.shopName} is active; prices may vary by location`,
    });
  }

  private async loadProduct(
    externalId: string,
    market: Market,
  ): Promise<EroskiProductDto> {
    const normalized = externalId.trim();
    if (!/^\d+$/.test(normalized))
      throw new ProductNotFoundError("EROSKI", externalId);
    const context = this.contextFor(market);
    try {
      const page = await this.client.getProductPage(normalized, context);
      const dto = this.productParser.parse(
        page.html,
        page.url,
        context.shopRef,
      );
      if (dto.externalId !== normalized)
        throw new ProviderContractChangedError("EROSKI", {
          message: "Eroski product page returned a different product id",
        });
      return dto;
    } catch (error) {
      if (error instanceof EroskiHttpError && error.status === 404)
        throw new ProductNotFoundError("EROSKI", normalized, { cause: error });
      throw this.providerError(error, "product detail");
    }
  }

  private observations(
    dtos: readonly EroskiProductDto[],
    market: Market,
  ): RetailerSearchResult {
    const observedAt = this.now();
    return {
      products: dtos.map((dto) =>
        this.mapper.toProduct(dto, market, observedAt),
      ),
      offers: dtos.map((dto) => this.mapper.toOffer(dto, market, observedAt)),
    };
  }

  private contextFor(market: Market): EroskiSessionContext {
    if (market.retailer !== "EROSKI")
      throw new MarketResolutionError("EROSKI", market.postalCode, {
        message: `Market belongs to ${market.retailer}, not EROSKI`,
      });
    const context = this.contexts.get(market);
    if (
      context === undefined ||
      market.externalId !== `shop-ref:${context.shopRef}` ||
      market.metadata?.shopRef !== context.shopRef
    )
      throw new MarketResolutionError("EROSKI", market.postalCode, {
        message:
          "Eroski public market context is unavailable or does not match this provider instance",
      });
    return context;
  }

  private providerError(error: unknown, resource: string): Error {
    if (
      error instanceof ProviderContractChangedError ||
      error instanceof MarketResolutionError ||
      error instanceof ProductNotFoundError ||
      error instanceof RateLimitedError ||
      error instanceof ProviderUnavailableError ||
      error instanceof RangeError
    )
      return error;
    if (
      error instanceof EroskiCatalogStructureError ||
      error instanceof EroskiHtmlStructureError ||
      (error instanceof EroskiHttpError && error.kind === "invalid-response")
    )
      return new ProviderContractChangedError("EROSKI", {
        message: `Eroski ${resource} is incompatible with the confirmed public contract`,
        cause: error,
      });
    if (error instanceof EroskiHttpError && error.status === 429)
      return new RateLimitedError("EROSKI", {
        ...(error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs }),
        cause: error,
      });
    return new ProviderUnavailableError("EROSKI", {
      message: `Eroski ${resource} is unavailable`,
      cause: error,
    });
  }

  private async settledMap<T, R>(
    values: readonly T[],
    operation: (value: T) => Promise<R>,
  ): Promise<PromiseSettledResult<R>[]> {
    const results: Array<PromiseSettledResult<R> | undefined> = Array.from(
      { length: values.length },
      () => undefined,
    );
    let next = 0;
    const workers = Array.from(
      { length: Math.min(this.concurrency, values.length) },
      async () => {
        while (next < values.length) {
          const index = next;
          next += 1;
          results[index] = await Promise.resolve(
            operation(values[index] as T),
          ).then(
            (value) => ({ status: "fulfilled", value }) as const,
            (reason: unknown) => ({ status: "rejected", reason }) as const,
          );
        }
      },
    );
    await Promise.all(workers);
    return results.map((result) => {
      if (result === undefined)
        throw new Error("Eroski concurrency worker did not produce a result");
      return result;
    });
  }

  private async withCatalogSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.catalogOperations >= this.concurrency)
      await new Promise<void>((resolve) => this.catalogWaiters.push(resolve));
    this.catalogOperations += 1;
    try {
      return await operation();
    } finally {
      this.catalogOperations -= 1;
      this.catalogWaiters.shift()?.();
    }
  }
}
