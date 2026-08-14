import type { OfferFreshness, ProductSearchResult } from "./types";

export function resultName(result: ProductSearchResult): string {
  return (
    result.concept?.name ??
    result.retailerProducts[0]?.name ??
    "Producto"
  );
}

export function resultBrand(result: ProductSearchResult): string | null {
  return (
    result.retailerProducts.find((product) => product.brand)?.brand ??
    null
  );
}

export function resultFormat(result: ProductSearchResult): string | null {
  const source = result.retailerProducts[0];
  if (!source?.packageSize || !source.packageUnit) return null;
  const amount = formatNumber(source.packageSize);
  const unit = formatUnit(source.packageUnit);
  return source.packageCount && source.packageCount > 1
    ? `${source.packageCount} × ${amount} ${unit}`
    : `${amount} ${unit}`;
}

export function formatPrice(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function formatPricePerUnit(
  value: number | null,
  referenceUnit: string | null,
): string | null {
  if (value === null || referenceUnit === null) return null;
  return `${formatPrice(value)}/${formatUnit(referenceUnit)}`;
}

export function formatObservedAge(
  observedAt: string,
  nowMs = Date.now(),
): string {
  const observedMs = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs)) return "Actualización desconocida";
  const minutes = Math.max(0, Math.floor((nowMs - observedMs) / 60_000));
  if (minutes < 1) return "Actualizado hace menos de 1 min";
  if (minutes < 60) return `Actualizado hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Actualizado hace ${hours} h`;
  return `Actualizado hace ${Math.floor(hours / 24)} d`;
}

export function freshnessLabel(freshness: OfferFreshness): string | null {
  if (freshness === "STALE") return "Dato algo antiguo";
  if (freshness === "VERY_STALE") return "Dato antiguo";
  return null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUnit(unit: string): string {
  if (unit === "unit") return "ud.";
  return unit === "l" ? "L" : unit;
}
