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
} from "@shopping-app/retailer-contracts";

import {
  AlcampoCategoryHtmlError,
  AlcampoCategoryParser,
} from "./alcampo-category-parser.js";
import {
  parseActiveSession,
  parseAlcampoProduct,
  parseAlcampoProductsBatch,
  parseArea,
  parseAreaSearch,
  parseCategories,
  parseDeliveryAddress,
  parseTemporaryDestination,
  type AlcampoCategoryDto,
  type AlcampoProductDto,
} from "./alcampo-dtos.js";
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
  concurrency?: number;
}

export class AlcampoProvider
  implements CatalogRetailerProvider, PriceRefreshRetailerProvider
{
  private readonly client: AlcampoHttpClient;
  private readonly mapper = new AlcampoMapper();
  private readonly categoryParser = new AlcampoCategoryParser();
  private context: AlcampoSessionContext | undefined;
  private readonly now: () => Date;
  private readonly concurrency: number;
  private readonly contexts = new WeakMap<Market, AlcampoSessionContext>();
  private readonly categoryPaths = new Map<string, string>();

  constructor(options: AlcampoProviderOptions = {}) {
    this.client = new AlcampoHttpClient(options);
    this.context =
      options.sessionContext ??
      AlcampoSessionContext.fromEnvironment(options.environment ?? process.env);
    this.now = options.now ?? (() => new Date());
    this.concurrency = options.concurrency ?? 6;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1)
      throw new RangeError("Alcampo concurrency must be a positive integer");
  }

  async resolveMarket(postalCode: string): Promise<Market> {
    const normalized = postalCode.trim();
    if (!/^\d{5}$/.test(normalized))
      throw new MarketResolutionError("ALCAMPO", postalCode);
    if (this.context?.postalCode === normalized)
      return this.remember(this.context);
    try {
      const bootstrap = await this.client.bootstrap(this.context);
      const areaSearch = parseAreaSearch(
        await this.client.searchAreas(normalized, bootstrap),
      );
      if (areaSearch === undefined || areaSearch.length === 0)
        throw this.contract("area search");
      const area = parseArea(
        await this.client.getArea(areaSearch[0]!.areaId, bootstrap),
        areaSearch[0]!.areaId,
      );
      if (area === undefined) throw this.contract("area detail");
      if (area.postalCode !== normalized)
        throw new MarketResolutionError("ALCAMPO", normalized, {
          message: "Alcampo resolved a different postal code",
        });
      const temporary = parseTemporaryDestination(
        await this.client.createTemporaryDestination(area, bootstrap),
      );
      if (temporary === undefined)
        throw this.contract("temporary delivery destination");
      const delivery = parseDeliveryAddress(
        await this.client.getDeliveryAddress(
          temporary.deliveryDestinationId,
          bootstrap,
        ),
      );
      if (delivery === undefined) throw this.contract("delivery address");
      if (
        delivery.postalCode !== normalized ||
        delivery.deliverability !== "DELIVERABLE" ||
        delivery.deliveryMethod !== "HOME_DELIVERY"
      )
        throw new MarketResolutionError("ALCAMPO", normalized, {
          message:
            "Alcampo does not provide home delivery for this postal code",
        });
      const active = parseActiveSession(
        await this.client.activateSession(
          temporary.deliveryDestinationId,
          delivery.resolvedRegionId,
          bootstrap,
        ),
      );
      if (
        active === undefined ||
        active.regionId !== delivery.resolvedRegionId ||
        active.deliveryDestinationId !== temporary.deliveryDestinationId
      )
        throw this.contract("active session");
      this.context = new AlcampoSessionContext({
        postalCode: normalized,
        regionId: delivery.resolvedRegionId,
        deliveryDestinationId: temporary.deliveryDestinationId,
        visitorId: bootstrap.visitorId,
        ...(active.cartId === undefined ? {} : { cartId: active.cartId }),
        csrfToken: bootstrap.csrfToken,
        assetVersion: bootstrap.assetVersion,
      });
      return this.remember(this.context);
    } catch (error) {
      throw this.marketError(normalized, error);
    }
  }

  configuredMarket(): Market {
    return this.remember(this.requireContext());
  }

  async getCategories(market: Market): Promise<RetailerCategory[]> {
    const context = this.contextFor(market);
    try {
      const roots = parseCategories(await this.client.getCategories(context));
      if (roots === undefined) throw this.contract("categories");
      this.categoryPaths.clear();
      const leaves: RetailerCategory[] = [];
      const walk = (
        nodes: readonly AlcampoCategoryDto[],
        names: readonly string[],
        level: number,
      ): void => {
        for (const [order, node] of nodes.entries()) {
          const pathNames = [...names, node.name];
          // Some confirmed SSR listings (including OC1603) are ingestible
          // category pages even though the API also exposes finer children.
          this.categoryPaths.set(
            node.retailerCategoryId,
            this.categoryPath(pathNames, node.retailerCategoryId),
          );
          if (node.children.length === 0) {
            leaves.push({
              externalId: node.retailerCategoryId,
              name: node.name,
              level,
              order,
            });
          } else walk(node.children, pathNames, level + 1);
        }
      };
      walk(roots, [], 0);
      return leaves;
    } catch (error) {
      throw this.providerError(error, "categories");
    }
  }

  async getProductsByCategory(
    categoryId: string,
    market: Market,
  ): Promise<RetailerSearchResult> {
    const normalized = categoryId.trim();
    if (normalized === "")
      throw new RangeError("Alcampo category id cannot be empty");
    const context = this.contextFor(market);
    if (!this.categoryPaths.has(normalized)) await this.getCategories(market);
    const path = this.categoryPaths.get(normalized);
    if (path === undefined)
      throw new ProviderContractChangedError("ALCAMPO", {
        message: `Alcampo category ${normalized} has no reproducible SSR path`,
      });
    try {
      const page = await this.client.getCategoryHtml(path, context);
      const listing = this.categoryParser.parse(page.html, page.url);
      const dtos = await this.loadCatalogProducts(listing, market);
      const observedAt = this.now();
      return {
        products: dtos.map((dto) => {
          const productUrl =
            listing.productUrls.get(dto.retailerProductId) ?? dto.productUrl;
          return this.mapper.toProduct(
            { ...dto, ...(productUrl === undefined ? {} : { productUrl }) },
            market,
            observedAt,
          );
        }),
        offers: dtos.map((dto) => this.mapper.toOffer(dto, market, observedAt)),
      };
    } catch (error) {
      throw this.providerError(error, "category");
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
      retailer: "ALCAMPO",
      status: this.context === undefined ? "degraded" : "healthy",
      checkedAt: this.now(),
      message:
        this.context === undefined
          ? "Alcampo has not resolved a market in this provider instance"
          : "Alcampo market, catalog and price refresh are operational",
    });
  }

  private async loadCatalogProducts(
    listing: {
      retailerProductIds: readonly string[];
      internalProductIds: ReadonlyMap<string, string>;
    },
    market: Market,
  ): Promise<AlcampoProductDto[]> {
    if (
      !listing.retailerProductIds.every((id) =>
        listing.internalProductIds.has(id),
      )
    ) {
      return this.loadMany(listing.retailerProductIds, market);
    }
    const context = this.contextFor(market);
    const requested = listing.retailerProductIds.map((retailerProductId) => ({
      retailerProductId,
      productId: listing.internalProductIds.get(retailerProductId) as string,
    }));
    const batches: Array<typeof requested> = [];
    for (let index = 0; index < requested.length; index += 24) {
      batches.push(requested.slice(index, index + 24));
    }
    const payloads = await this.settledMap(batches, (batch) =>
      this.client.getProducts(
        batch.map((item) => item.productId),
        context,
      ),
    );
    const failed = payloads.find((outcome) => outcome.status === "rejected");
    if (failed !== undefined) throw failed.reason;
    const products = payloads.flatMap((outcome) => {
      const parsed = parseAlcampoProductsBatch(
        (outcome as PromiseFulfilledResult<unknown>).value,
      );
      if (parsed === undefined) throw this.contract("products batch");
      return parsed;
    });
    const byRetailerId = new Map(
      products.map((product) => [product.retailerProductId, product]),
    );
    return requested.map(({ retailerProductId, productId }) => {
      const product = byRetailerId.get(retailerProductId);
      if (product === undefined || product.productId !== productId) {
        throw this.contract("products batch identity");
      }
      return product;
    });
  }

  private async loadMany(
    ids: readonly string[],
    market: Market,
  ): Promise<AlcampoProductDto[]> {
    const outcomes = await this.settledMap(ids, (id) =>
      this.loadProduct(id, market),
    );
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed !== undefined) throw failed.reason;
    return outcomes.map(
      (outcome) => (outcome as PromiseFulfilledResult<AlcampoProductDto>).value,
    );
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
        throw new Error("Alcampo concurrency worker did not produce a result");
      return result;
    });
  }
  private async loadProduct(
    externalId: string,
    market: Market,
  ): Promise<AlcampoProductDto> {
    const normalized = externalId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(normalized))
      throw new ProductNotFoundError("ALCAMPO", externalId);
    try {
      const dto = parseAlcampoProduct(
        await this.client.getProduct(normalized, this.contextFor(market)),
      );
      if (dto === undefined || dto.retailerProductId !== normalized)
        throw this.contract("product");
      return dto;
    } catch (error) {
      if (error instanceof AlcampoHttpError && error.status === 404)
        throw new ProductNotFoundError("ALCAMPO", normalized, { cause: error });
      throw this.providerError(error, "product");
    }
  }
  private remember(context: AlcampoSessionContext): Market {
    const market = this.mapper.toMarket(context);
    this.contexts.set(market, context);
    return market;
  }
  private requireContext(): AlcampoSessionContext {
    if (this.context === undefined)
      throw new MarketResolutionError("ALCAMPO", "unknown", {
        message: "Alcampo session context has not been resolved",
      });
    return this.context;
  }
  private contextFor(market: Market): AlcampoSessionContext {
    if (market.retailer !== "ALCAMPO")
      throw new MarketResolutionError("ALCAMPO", market.postalCode, {
        message: `Market belongs to ${market.retailer}, not ALCAMPO`,
      });
    const context = this.contexts.get(market);
    if (
      context === undefined ||
      market.externalId !== context.regionId ||
      market.postalCode !== context.postalCode
    )
      throw new MarketResolutionError("ALCAMPO", market.postalCode, {
        message:
          "Alcampo market context is unavailable or does not match this provider instance",
      });
    return context;
  }
  private categoryPath(names: readonly string[], id: string): string {
    const parts = names
      .slice(-2)
      .map((name) => encodeURIComponent(this.slug(name)));
    return `categories/${parts.join("/")}/${encodeURIComponent(id)}`;
  }
  private slug(value: string): string {
    return value
      .normalize("NFC")
      .toLocaleLowerCase("es-ES")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");
  }
  private contract(resource: string): ProviderContractChangedError {
    return new ProviderContractChangedError("ALCAMPO", {
      message: `Alcampo ${resource} response is incompatible with the confirmed contract`,
    });
  }
  private marketError(postalCode: string, error: unknown): Error {
    if (
      error instanceof MarketResolutionError ||
      error instanceof ProviderContractChangedError
    )
      return error;
    const mapped = this.providerError(error, "market");
    return mapped instanceof RateLimitedError
      ? mapped
      : new MarketResolutionError("ALCAMPO", postalCode, {
          message:
            error instanceof AlcampoHttpError && error.status === 403
              ? "Alcampo area lookup returned HTTP 403 because a reproducible CSRF/WAF context was not available"
              : "Alcampo market resolution failed",
          cause: error,
        });
  }
  private providerError(error: unknown, resource: string): Error {
    if (
      error instanceof ProviderContractChangedError ||
      error instanceof MarketResolutionError ||
      error instanceof ProductNotFoundError ||
      error instanceof RateLimitedError ||
      error instanceof ProviderUnavailableError
    )
      return error;
    if (
      error instanceof AlcampoCategoryHtmlError ||
      (error instanceof AlcampoHttpError && error.kind === "invalid-response")
    )
      return this.contract(resource);
    if (error instanceof AlcampoHttpError && error.status === 429)
      return new RateLimitedError("ALCAMPO", {
        ...(error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs }),
        cause: error,
      });
    return new ProviderUnavailableError("ALCAMPO", {
      message:
        error instanceof AlcampoHttpError && error.status === 403
          ? `Alcampo rejected ${resource} with HTTP 403`
          : `Alcampo ${resource} is unavailable`,
      cause: error,
    });
  }
}
