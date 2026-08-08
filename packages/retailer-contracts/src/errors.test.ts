import { describe, expect, it } from "vitest";

import {
  MarketResolutionError,
  ProductNotFoundError,
  ProviderCapabilityUnavailableError,
  ProviderContractChangedError,
  ProviderError,
  ProviderUnavailableError,
  RateLimitedError,
} from "./errors.js";

describe("errores de provider", () => {
  it("conserva provider, tipo, mensaje y causa", () => {
    const cause = new Error("network failure");
    const error = new ProviderUnavailableError("DIA", { cause });

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error.name).toBe("ProviderUnavailableError");
    expect(error.provider).toBe("DIA");
    expect(error.message).toContain("DIA");
    expect(error.cause).toBe(cause);
  });

  it("expone el tiempo recomendado tras un rate limit", () => {
    const error = new RateLimitedError("MERCADONA", {
      retryAfterMs: 2_000,
    });

    expect(error.retryAfterMs).toBe(2_000);
    expect(error.provider).toBe("MERCADONA");
  });

  it("conserva el contexto específico de cada error", () => {
    const market = new MarketResolutionError("ALCAMPO", "50009");
    const product = new ProductNotFoundError("EROSKI", "261354");
    const capability = new ProviderCapabilityUnavailableError(
      "DIA",
      "refreshPrices",
    );
    const contract = new ProviderContractChangedError("DIA", {
      message: "Unexpected payload",
    });

    expect(market.postalCode).toBe("50009");
    expect(product.externalId).toBe("261354");
    expect(capability.capability).toBe("refreshPrices");
    expect(contract.message).toBe("Unexpected payload");
  });
});
