import { describe, expect, it } from "vitest";

import { detectAnomalies } from "./anomalies.js";
import type { OfferRow, ProductRow, SyncRunRow } from "./models.js";

const product: ProductRow = {
  id: "product-1",
  retailer_id: "retailer-1",
  external_id: "sku-1",
  name: "Leche 1L",
  brand: null,
  active: true,
  last_seen_at: "2026-08-09T12:00:00.000Z",
  package_size: 1,
  package_unit: "l",
  package_count: 1,
  total_amount: 1,
};
const offer: OfferRow = {
  id: "offer-1",
  retailer_product_id: product.id,
  normal_price: 0,
  promo_price: null,
  price_per_unit: 9,
  reference_unit: "l",
  available: true,
  observed_at: "2026-08-09T12:00:00.000Z",
};

function failedRun(index: number, errorMessage = "network error"): SyncRunRow {
  return {
    id: `run-${index}`,
    retailer_id: "retailer-1",
    sync_type: "catalog_sync",
    started_at: `2026-08-09T0${index}:00:00.000Z`,
    finished_at: `2026-08-09T0${index}:01:00.000Z`,
    status: "failed",
    products_seen: 0,
    offers_seen: 0,
    error_message: errorMessage,
    metadata: {},
  };
}

describe("anomaly detection", () => {
  it("detects non-positive prices, extreme changes, contract errors and repeated failures", () => {
    const anomalies = detectAnomalies({
      retailers: [
        {
          id: "retailer-1",
          code: "DIA",
          name: "DIA",
          active: true,
          operational_status: "ACTIVE",
          capabilities: ["SEARCH", "PRICE_REFRESH"],
        },
      ],
      products: [product],
      offers: [offer],
      history: [
        {
          id: 2,
          product_offer_id: offer.id,
          normal_price: 3,
          promo_price: null,
          price_per_unit: null,
          reference_unit: "l",
          observed_at: offer.observed_at,
        },
        {
          id: 1,
          product_offer_id: offer.id,
          normal_price: 1,
          promo_price: null,
          price_per_unit: null,
          reference_unit: "l",
          observed_at: "2026-08-08T12:00:00.000Z",
        },
      ],
      runs: [
        failedRun(3, "ProviderContractChangedError: field missing"),
        failedRun(2),
        failedRun(1),
      ],
    });
    expect(anomalies.map((row) => row.kind)).toEqual(
      expect.arrayContaining([
        "PRICE_NON_POSITIVE",
        "EXTREME_PRICE_CHANGE",
        "PROVIDER_CONTRACT_CHANGED",
        "REPEATED_PROVIDER_FAILURES",
      ]),
    );
  });

  it("detects inconsistent unit prices and parsing failures", () => {
    const anomalies = detectAnomalies({
      retailers: [
        {
          id: "retailer-1",
          code: "DIA",
          name: "DIA",
          active: true,
          operational_status: "ACTIVE",
          capabilities: ["SEARCH", "PRICE_REFRESH"],
        },
      ],
      products: [product],
      offers: [{ ...offer, normal_price: 2, price_per_unit: 9 }],
      history: [],
      runs: [failedRun(1, "JSON parsing failed")],
    });
    expect(anomalies.map((row) => row.kind)).toEqual(
      expect.arrayContaining([
        "INCONSISTENT_PRICE_PER_UNIT",
        "PARSING_FAILURE",
      ]),
    );
  });
});
