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
  type RetailerSearchResult,
} from "@shopping-app/retailer-contracts";

import type { EroskiProductDto } from "./eroski-dtos.js";
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

const CONFIRMED_PRODUCT_URLS: Readonly<Record<string, string>> = Object.freeze({
  "18631259":
    "https://supermercado.eroski.es/es/productdetail/18631259-solomillo-de-pavo-al-vacio-eroski-bipack-sobre-al-peso-aprox-750-g/",
});

export interface EroskiProviderOptions extends EroskiHttpClientOptions {
  productUrls?: Readonly<Record<string, string>>;
  now?: () => Date;
}

export class EroskiProvider implements RetailerProvider {
  private readonly client: EroskiHttpClient;
  private readonly parser = new EroskiHtmlParser();
  private readonly mapper = new EroskiMapper();
  private readonly productUrls: Readonly<Record<string, string>>;
  private readonly now: () => Date;

  constructor(options: EroskiProviderOptions = {}) {
    this.client = new EroskiHttpClient(options);
    this.productUrls = Object.freeze({
      ...CONFIRMED_PRODUCT_URLS,
      ...options.productUrls,
    });
    this.now = options.now ?? (() => new Date());
  }

  resolveMarket(postalCode: string): Promise<Market> {
    void postalCode;
    return Promise.reject(
      new ProviderCapabilityUnavailableError("EROSKI", "resolveMarket", {
        message:
          "Eroski market/store selection by postal code is not confirmed",
      }),
    );
  }

  searchProducts(query: string, market: Market): Promise<RetailerSearchResult> {
    void query;
    void market;
    return Promise.reject(
      new ProviderCapabilityUnavailableError("EROSKI", "searchProducts", {
        message: "No Eroski public search contract is confirmed",
      }),
    );
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
      retailer: "EROSKI",
      status: "degraded",
      checkedAt: this.now(),
      message:
        "Public SSR product detail is available only for known canonical URLs; market resolution and search are unavailable",
    });
  }

  private async loadProduct(
    externalId: string,
    market: Market,
  ): Promise<EroskiProductDto> {
    const normalizedExternalId = externalId.trim();
    if (normalizedExternalId === "") {
      throw new ProductNotFoundError("EROSKI", externalId);
    }
    if (market.retailer !== "EROSKI") {
      throw new MarketResolutionError("EROSKI", market.postalCode, {
        message: `Market belongs to ${market.retailer}, not EROSKI`,
      });
    }
    const productUrl = this.productUrls[normalizedExternalId];
    if (productUrl === undefined) {
      throw new ProviderCapabilityUnavailableError(
        "EROSKI",
        "productUrlResolution",
        {
          message: `No confirmed canonical Eroski product URL is configured for ${normalizedExternalId}`,
        },
      );
    }
    try {
      const page = await this.client.getProductPage(productUrl);
      const dto = this.parser.parse(page.html, page.url);
      if (dto.externalId !== normalizedExternalId) {
        throw new ProviderContractChangedError("EROSKI", {
          message: "Eroski product page returned a different product id",
        });
      }
      return dto;
    } catch (error) {
      if (
        error instanceof ProviderContractChangedError ||
        error instanceof MarketResolutionError
      ) {
        throw error;
      }
      if (error instanceof EroskiHtmlStructureError) {
        throw new ProviderContractChangedError("EROSKI", {
          message:
            "Eroski product HTML is incompatible with the expected structure",
          cause: error,
        });
      }
      if (error instanceof EroskiHttpError && error.status === 404) {
        throw new ProductNotFoundError("EROSKI", normalizedExternalId, {
          cause: error,
        });
      }
      if (
        error instanceof EroskiHttpError &&
        error.kind === "invalid-response"
      ) {
        throw new ProviderContractChangedError("EROSKI", { cause: error });
      }
      if (error instanceof EroskiHttpError && error.status === 429) {
        throw new RateLimitedError("EROSKI", {
          ...(error.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: error.retryAfterMs }),
          cause: error,
        });
      }
      throw new ProviderUnavailableError("EROSKI", {
        message: "Eroski public product detail is unavailable",
        cause: error,
      });
    }
  }
}
