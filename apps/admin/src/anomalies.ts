import type {
  OfferRow,
  PriceHistoryRow,
  ProductRow,
  RetailerRow,
  SyncRunRow,
} from "./models.js";

export type AnomalyKind =
  | "PRICE_NON_POSITIVE"
  | "EXTREME_PRICE_CHANGE"
  | "INCONSISTENT_PRICE_PER_UNIT"
  | "PARSING_FAILURE"
  | "PROVIDER_CONTRACT_CHANGED"
  | "REPEATED_PROVIDER_FAILURES";

export interface Anomaly {
  kind: AnomalyKind;
  provider: string;
  subject: string;
  detail: string;
  occurredAt: string;
}

export function detectAnomalies(input: {
  retailers: RetailerRow[];
  products: ProductRow[];
  offers: OfferRow[];
  history: PriceHistoryRow[];
  runs: SyncRunRow[];
}): Anomaly[] {
  const retailerNames = new Map(
    input.retailers.map((row) => [row.id, row.code]),
  );
  const products = new Map(input.products.map((row) => [row.id, row]));
  const offers = new Map(input.offers.map((row) => [row.id, row]));
  const result: Anomaly[] = [];

  for (const offer of input.offers) {
    const product = products.get(offer.retailer_product_id);
    const context = productContext(product, retailerNames);
    const effectivePrice = offer.promo_price ?? offer.normal_price;
    if (
      offer.normal_price <= 0 ||
      (offer.promo_price !== null && offer.promo_price <= 0)
    ) {
      result.push({
        kind: "PRICE_NON_POSITIVE",
        ...context,
        detail: `Precio normal ${offer.normal_price}; promo ${offer.promo_price ?? "—"}`,
        occurredAt: offer.observed_at,
      });
    }
    const expected = expectedUnitPrice(
      product,
      effectivePrice,
      offer.reference_unit,
    );
    if (
      expected !== null &&
      offer.price_per_unit !== null &&
      relativeDifference(expected, offer.price_per_unit) > 0.2
    ) {
      result.push({
        kind: "INCONSISTENT_PRICE_PER_UNIT",
        ...context,
        detail: `Declarado ${offer.price_per_unit.toFixed(2)}; esperado ~${expected.toFixed(2)} por ${offer.reference_unit ?? "unidad"}`,
        occurredAt: offer.observed_at,
      });
    }
  }

  const historyByOffer = groupBy(input.history, (row) => row.product_offer_id);
  for (const [offerId, rows] of historyByOffer) {
    const ordered = [...rows].sort((a, b) =>
      b.observed_at.localeCompare(a.observed_at),
    );
    const current = ordered[0];
    const previous = ordered[1];
    if (current === undefined || previous === undefined) continue;
    const currentPrice = current.promo_price ?? current.normal_price;
    const previousPrice = previous.promo_price ?? previous.normal_price;
    if (
      previousPrice > 0 &&
      Math.abs(currentPrice - previousPrice) / previousPrice >= 0.5
    ) {
      const offer = offers.get(offerId);
      const product =
        offer === undefined
          ? undefined
          : products.get(offer.retailer_product_id);
      result.push({
        kind: "EXTREME_PRICE_CHANGE",
        ...productContext(product, retailerNames),
        detail: `${previousPrice.toFixed(2)} → ${currentPrice.toFixed(2)} (${formatPercent((currentPrice - previousPrice) / previousPrice)})`,
        occurredAt: current.observed_at,
      });
    }
  }

  for (const run of input.runs) {
    const serialized = `${run.error_message ?? ""} ${JSON.stringify(run.metadata)}`;
    const base = {
      provider: retailerNames.get(run.retailer_id) ?? run.retailer_id,
      subject: run.sync_type,
      detail: run.error_message ?? "Error registrado en metadata",
      occurredAt: run.finished_at ?? run.started_at,
    };
    if (/ProviderContractChangedError|contract has changed/i.test(serialized)) {
      result.push({ kind: "PROVIDER_CONTRACT_CHANGED", ...base });
    } else if (
      /parse|parsing|syntax|invalid payload|invalid json/i.test(serialized)
    ) {
      result.push({ kind: "PARSING_FAILURE", ...base });
    }
  }

  const runsByRetailer = groupBy(input.runs, (run) => run.retailer_id);
  for (const [retailerId, runs] of runsByRetailer) {
    const consecutive = [...runs]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .findIndex((run) => run.status === "succeeded");
    const failureCount = consecutive === -1 ? runs.length : consecutive;
    const latest = runs[0];
    if (failureCount >= 3 && latest !== undefined) {
      result.push({
        kind: "REPEATED_PROVIDER_FAILURES",
        provider: retailerNames.get(retailerId) ?? retailerId,
        subject: "sync runs",
        detail: `${failureCount} ejecuciones consecutivas fallidas o parciales`,
        occurredAt: latest.finished_at ?? latest.started_at,
      });
    }
  }

  return result.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function expectedUnitPrice(
  product: ProductRow | undefined,
  price: number,
  referenceUnit: string | null,
): number | null {
  if (product === undefined || referenceUnit === null || price <= 0)
    return null;
  const amount =
    product.total_amount ??
    (product.package_size === null
      ? null
      : product.package_size * (product.package_count ?? 1));
  if (amount === null || amount <= 0 || product.package_unit === null)
    return null;
  const conversion = conversionFactor(product.package_unit, referenceUnit);
  return conversion === null ? null : (price / amount) * conversion;
}

function conversionFactor(source: string, reference: string): number | null {
  if (source === reference) return 1;
  if (source === "g" && reference === "kg") return 1000;
  if (source === "kg" && reference === "g") return 0.001;
  if (source === "ml" && reference === "l") return 1000;
  if (source === "l" && reference === "ml") return 0.001;
  return null;
}

function productContext(
  product: ProductRow | undefined,
  retailerNames: Map<string, string>,
): { provider: string; subject: string } {
  return product === undefined
    ? { provider: "—", subject: "Oferta desconocida" }
    : {
        provider: retailerNames.get(product.retailer_id) ?? product.retailer_id,
        subject: `${product.name} (${product.external_id})`,
      };
}

function relativeDifference(expected: number, actual: number): number {
  return Math.abs(expected - actual) / expected;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)}%`;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    result.set(value, [...(result.get(value) ?? []), item]);
  }
  return result;
}
