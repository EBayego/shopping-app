import { randomUUID } from "node:crypto";

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
  type SearchRetailerProvider,
  type PriceRefreshRetailerProvider,
  type RetailerSearchResult,
} from "@shopping-app/retailer-contracts";

import {
  parseDiaCatalogPage,
  parseDiaMenu,
  parseDiaProductAnalytics,
  parseDiaSearchPage,
  type DiaSearchItemDto,
} from "./dia-dtos.js";
import {
  DiaHttpClient,
  DiaHttpError,
  type DiaHttpClientOptions,
} from "./dia-http-client.js";
import { DiaMapper } from "./dia-mapper.js";
import { DiaSessionContext } from "./dia-session-context.js";

export interface DiaProviderOptions extends DiaHttpClientOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface DiaSearchPagination {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
}

export interface DiaSearchPage extends RetailerSearchResult {
  pagination: DiaSearchPagination;
}

interface DiaCatalogCategory {
  id: string;
  name: string;
  link: string;
  rootName: string;
  parentId?: string;
}

export class DiaProvider
  implements
    SearchRetailerProvider,
    CatalogRetailerProvider,
    PriceRefreshRetailerProvider
{
  private readonly client: DiaHttpClient;
  private readonly mapper = new DiaMapper();
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly contexts = new WeakMap<Market, DiaSessionContext>();
  private readonly catalogCategories = new Map<string, DiaCatalogCategory>();

  constructor(options: DiaProviderOptions = {}) {
    this.client = new DiaHttpClient(options);
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async resolveMarket(postalCode: string): Promise<Market> {
    const normalizedPostalCode = postalCode.trim();
    if (normalizedPostalCode === "") {
      throw new MarketResolutionError("DIA", postalCode);
    }

    const cartId = this.createId();
    const initialSessionId = this.createId();
    try {
      const response = await this.client.saveShippingAddress(
        normalizedPostalCode,
        cartId,
        initialSessionId,
      );
      const context = new DiaSessionContext({
        postalCode: normalizedPostalCode,
        ...(response.shopId === undefined ? {} : { shopId: response.shopId }),
        cartId,
        sessionId: response.sessionId,
      });
      const market = this.mapper.toMarket(context);
      this.contexts.set(market, context);
      return market;
    } catch (error) {
      throw this.marketError(normalizedPostalCode, error);
    }
  }

  async searchProducts(
    query: string,
    market: Market,
  ): Promise<RetailerSearchResult> {
    const { products, offers } = await this.searchProductsPage(
      query,
      market,
      1,
    );
    return { products, offers };
  }

  async searchProductsPage(
    query: string,
    market: Market,
    page: number,
  ): Promise<DiaSearchPage> {
    const normalizedQuery = query.trim();
    if (normalizedQuery === "") {
      throw new RangeError("DIA search query cannot be empty");
    }
    if (!Number.isInteger(page) || page < 1) {
      throw new RangeError("DIA search page must be a positive integer");
    }

    const context = this.contextFor(market);
    try {
      const payload = await this.client.searchProducts(
        normalizedQuery,
        page,
        context,
      );
      const dto = parseDiaSearchPage(payload);
      if (
        dto === undefined ||
        dto.pageNumber !== page ||
        (dto.postalCode !== undefined && dto.postalCode !== context.postalCode)
      ) {
        throw new ProviderContractChangedError("DIA", {
          message:
            "DIA search response is incompatible with the expected contract",
        });
      }

      const observedAt = this.now();
      const products = dto.items.map((item) =>
        this.mapper.searchItemToProduct(item, market, observedAt),
      );
      const offers = dto.items.flatMap((item) => {
        const offer = this.mapper.searchItemToOffer(item, market, observedAt);
        return offer === undefined ? [] : [offer];
      });
      return {
        products,
        offers,
        pagination: {
          pageNumber: dto.pageNumber,
          pageSize: dto.pageSize,
          totalPages: dto.totalPages,
          totalItems: dto.totalItems,
        },
      };
    } catch (error) {
      throw this.searchError(error);
    }
  }

  async getCategories(market: Market): Promise<RetailerCategory[]> {
    const context = this.contextFor(market);
    try {
      const roots = parseDiaMenu(await this.client.getMenuData(context));
      if (roots === undefined) {
        throw new ProviderContractChangedError("DIA", {
          message:
            "DIA category menu is incompatible with the expected contract",
        });
      }
      this.catalogCategories.clear();
      const categories: RetailerCategory[] = [];
      const walk = (
        nodes: typeof roots,
        level: number,
        parent: DiaCatalogCategory | undefined,
        rootName: string | undefined,
      ): void => {
        nodes.forEach((node, order) => {
          if (parent?.id === node.id || this.catalogCategories.has(node.id))
            return;
          const category: DiaCatalogCategory = {
            id: node.id,
            name: node.name,
            link: node.link,
            rootName: rootName ?? node.name,
            ...(parent === undefined ? {} : { parentId: parent.id }),
          };
          this.catalogCategories.set(category.id, category);
          categories.push({
            externalId: category.id,
            name: category.name,
            level,
            order,
            ...(category.parentId === undefined
              ? {}
              : { parentExternalId: category.parentId }),
          });
          walk(node.children, level + 1, category, category.rootName);
        });
      };
      walk(roots, 0, undefined, undefined);
      return categories;
    } catch (error) {
      throw this.catalogError(error);
    }
  }

  async getProductsByCategory(
    categoryId: string,
    market: Market,
  ): Promise<RetailerSearchResult> {
    const normalized = categoryId.trim();
    if (!/^L\d+$/.test(normalized))
      throw new RangeError("DIA category id is invalid");
    const context = this.contextFor(market);
    try {
      if (!this.catalogCategories.has(normalized))
        await this.getCategories(market);
      const category = this.catalogCategories.get(normalized);
      if (category === undefined) {
        throw new ProviderContractChangedError("DIA", {
          message: `DIA category ${normalized} is absent from the current menu`,
        });
      }
      const firstPage = await this.loadCatalogPage(category, 1, context);
      const pages = [firstPage];
      for (let page = 2; page <= firstPage.totalPages; page += 1) {
        const nextPage = await this.loadCatalogPage(category, page, context);
        if (
          nextPage.totalPages !== firstPage.totalPages ||
          nextPage.totalItems !== firstPage.totalItems
        ) {
          throw new ProviderContractChangedError("DIA", {
            message: "DIA category pagination changed during traversal",
          });
        }
        pages.push(nextPage);
      }
      const itemsBySku = new Map<string, DiaSearchItemDto>();
      for (const item of pages.flatMap((page) => page.items))
        itemsBySku.set(item.skuId, item);
      if (itemsBySku.size !== firstPage.totalItems) {
        throw new ProviderContractChangedError("DIA", {
          message: "DIA category product count differs from total_items",
        });
      }
      const items = [...itemsBySku.values()].map((item) => ({
        ...item,
        category: item.category ?? category.rootName,
        ...(category.parentId === undefined
          ? {}
          : { subcategory: item.subcategory ?? category.name }),
      }));
      const observedAt = this.now();
      return {
        products: items.map((item) =>
          this.mapper.searchItemToProduct(item, market, observedAt),
        ),
        offers: items.flatMap((item) => {
          const offer = this.mapper.searchItemToOffer(item, market, observedAt);
          return offer === undefined ? [] : [offer];
        }),
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
      retailer: "DIA",
      status: "degraded",
      checkedAt: this.now(),
      message: "getProduct uses DIA's provisional analytics endpoint",
    });
  }

  private async loadProduct(externalId: string, market: Market) {
    const context = this.contextFor(market);

    try {
      const payload = await this.client.getProductAnalytics(
        externalId,
        context,
      );
      const dto = parseDiaProductAnalytics(payload, externalId);
      if (
        dto === undefined ||
        dto.externalId !== externalId ||
        (context.shopId !== undefined && dto.shopId !== context.shopId)
      ) {
        throw new ProviderContractChangedError("DIA", {
          message:
            "DIA product analytics response is incompatible with the expected contract",
        });
      }
      context.resolveShopId(dto.shopId);
      return dto;
    } catch (error) {
      throw this.productError(externalId, error);
    }
  }

  private async loadCatalogPage(
    category: DiaCatalogCategory,
    page: number,
    context: DiaSessionContext,
  ) {
    const dto = parseDiaCatalogPage(
      await this.client.getCategoryProducts(category.link, page, context),
    );
    if (
      dto === undefined ||
      dto.categoryId !== category.id ||
      dto.pageNumber !== page
    ) {
      throw new ProviderContractChangedError("DIA", {
        message:
          "DIA category response is incompatible with the expected contract",
      });
    }
    return dto;
  }

  private contextFor(market: Market): DiaSessionContext {
    if (market.retailer !== "DIA") {
      throw new MarketResolutionError("DIA", market.postalCode, {
        message: `Market belongs to ${market.retailer}, not DIA`,
      });
    }
    const context = this.contexts.get(market);
    if (context === undefined) {
      throw new MarketResolutionError("DIA", market.postalCode, {
        message:
          "DIA market context is not available in this provider instance",
      });
    }
    return context;
  }

  private marketError(postalCode: string, error: unknown): Error {
    if (error instanceof MarketResolutionError) {
      return error;
    }
    if (error instanceof DiaHttpError && error.kind === "invalid-response") {
      return new ProviderContractChangedError("DIA", { cause: error });
    }
    const mapped = this.commonHttpError(error);
    return (
      mapped ?? new MarketResolutionError("DIA", postalCode, { cause: error })
    );
  }

  private productError(externalId: string, error: unknown): Error {
    if (
      error instanceof ProviderContractChangedError ||
      error instanceof MarketResolutionError
    ) {
      return error;
    }
    if (error instanceof DiaHttpError && error.status === 404) {
      return new ProductNotFoundError("DIA", externalId, { cause: error });
    }
    if (error instanceof DiaHttpError && error.kind === "invalid-response") {
      return new ProviderContractChangedError("DIA", { cause: error });
    }
    return (
      this.commonHttpError(error) ??
      new ProviderUnavailableError("DIA", { cause: error })
    );
  }

  private searchError(error: unknown): Error {
    if (
      error instanceof ProviderContractChangedError ||
      error instanceof MarketResolutionError
    ) {
      return error;
    }
    if (error instanceof DiaHttpError && error.kind === "invalid-response") {
      return new ProviderContractChangedError("DIA", { cause: error });
    }
    return (
      this.commonHttpError(error) ??
      new ProviderUnavailableError("DIA", { cause: error })
    );
  }

  private catalogError(error: unknown): Error {
    if (
      error instanceof ProviderContractChangedError ||
      error instanceof MarketResolutionError ||
      error instanceof ProviderUnavailableError ||
      error instanceof RateLimitedError ||
      error instanceof RangeError
    ) {
      return error;
    }
    if (error instanceof DiaHttpError && error.kind === "invalid-response") {
      return new ProviderContractChangedError("DIA", { cause: error });
    }
    return (
      this.commonHttpError(error) ??
      new ProviderUnavailableError("DIA", { cause: error })
    );
  }

  private commonHttpError(error: unknown): Error | undefined {
    if (!(error instanceof DiaHttpError)) {
      return undefined;
    }
    if (error.status === 429) {
      return new RateLimitedError("DIA", {
        ...(error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs }),
        cause: error,
      });
    }
    return new ProviderUnavailableError("DIA", { cause: error });
  }
}
