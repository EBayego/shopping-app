import type { PriceRefreshCandidate } from "./types.js";

export type OfferFreshness = "FRESH" | "STALE" | "VERY_STALE";

export interface OfferFreshnessConfig {
  staleAfterMs: number;
  veryStaleAfterMs: number;
}

export interface PriceRefreshSelectionConfig extends OfferFreshnessConfig {
  recentUsageWindowMs: number;
}

export const DEFAULT_PRICE_REFRESH_CONFIG: PriceRefreshSelectionConfig = {
  staleAfterMs: 6 * 60 * 60 * 1_000,
  veryStaleAfterMs: 24 * 60 * 60 * 1_000,
  recentUsageWindowMs: 30 * 24 * 60 * 60 * 1_000,
};

export type PriceRefreshReason =
  "MANUAL" | "ACTIVE_LIST" | "RECENT_USAGE" | "STALE" | "VERY_STALE";

export interface SelectedPriceRefreshProduct extends PriceRefreshCandidate {
  freshness: OfferFreshness;
  reasons: readonly PriceRefreshReason[];
}

export function getOfferFreshness(
  observedAt: Date | undefined,
  now: Date,
  config: OfferFreshnessConfig = DEFAULT_PRICE_REFRESH_CONFIG,
): OfferFreshness {
  validateFreshnessConfig(config);
  if (observedAt === undefined) return "VERY_STALE";
  const ageMs = Math.max(0, now.getTime() - observedAt.getTime());
  if (ageMs < config.staleAfterMs) return "FRESH";
  if (ageMs < config.veryStaleAfterMs) return "STALE";
  return "VERY_STALE";
}

export class PriceRefreshSelectionPolicy {
  private readonly config: PriceRefreshSelectionConfig;

  constructor(
    config: Partial<PriceRefreshSelectionConfig> = {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.config = { ...DEFAULT_PRICE_REFRESH_CONFIG, ...config };
    validateFreshnessConfig(this.config);
    if (this.config.recentUsageWindowMs < 0) {
      throw new RangeError("recentUsageWindowMs must be non-negative");
    }
  }

  select(
    candidates: readonly PriceRefreshCandidate[],
    manualProductIds: readonly string[] = [],
  ): SelectedPriceRefreshProduct[] {
    const currentTime = this.now();
    const manual = new Set(manualProductIds);
    return candidates.flatMap((candidate) => {
      if (manual.size > 0 && !manual.has(candidate.retailerProductExternalId)) {
        return [];
      }
      const freshness = getOfferFreshness(
        candidate.offerObservedAt,
        currentTime,
        this.config,
      );
      const reasons: PriceRefreshReason[] = [];
      if (manual.has(candidate.retailerProductExternalId))
        reasons.push("MANUAL");
      if (candidate.inActiveList) reasons.push("ACTIVE_LIST");
      if (
        candidate.lastUsedAt !== undefined &&
        currentTime.getTime() - candidate.lastUsedAt.getTime() <=
          this.config.recentUsageWindowMs
      ) {
        reasons.push("RECENT_USAGE");
      }
      if (freshness === "STALE") reasons.push("STALE");
      if (freshness === "VERY_STALE") reasons.push("VERY_STALE");
      return reasons.length === 0 ? [] : [{ ...candidate, freshness, reasons }];
    });
  }
}

function validateFreshnessConfig(config: OfferFreshnessConfig): void {
  if (config.staleAfterMs < 0) {
    throw new RangeError("staleAfterMs must be non-negative");
  }
  if (config.veryStaleAfterMs <= config.staleAfterMs) {
    throw new RangeError("veryStaleAfterMs must be greater than staleAfterMs");
  }
}
