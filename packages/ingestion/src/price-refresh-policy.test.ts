import { describe, expect, it } from "vitest";

import {
  PriceRefreshSelectionPolicy,
  getOfferFreshness,
} from "./price-refresh-policy.js";

const now = new Date("2026-08-09T12:00:00Z");
const config = { staleAfterMs: 1_000, veryStaleAfterMs: 5_000 };

describe("getOfferFreshness", () => {
  it.each([
    ["FRESH", new Date(now.getTime() - 999)],
    ["STALE", new Date(now.getTime() - 1_000)],
    ["VERY_STALE", new Date(now.getTime() - 5_000)],
  ] as const)("classifies %s from observedAt", (expected, observedAt) => {
    expect(getOfferFreshness(observedAt, now, config)).toBe(expected);
  });
});

describe("PriceRefreshSelectionPolicy", () => {
  it("selects active-list, stale, very-stale, recent-use and manual candidates", () => {
    const policy = new PriceRefreshSelectionPolicy(
      { ...config, recentUsageWindowMs: 10_000 },
      () => now,
    );
    const candidates = [
      {
        retailerProductExternalId: "active",
        offerObservedAt: now,
        inActiveList: true,
      },
      {
        retailerProductExternalId: "stale",
        offerObservedAt: new Date(now.getTime() - 2_000),
        inActiveList: false,
      },
      { retailerProductExternalId: "very", inActiveList: false },
      {
        retailerProductExternalId: "recent",
        offerObservedAt: now,
        inActiveList: false,
        lastUsedAt: new Date(now.getTime() - 5_000),
      },
      {
        retailerProductExternalId: "manual",
        offerObservedAt: now,
        inActiveList: false,
      },
      {
        retailerProductExternalId: "fresh",
        offerObservedAt: now,
        inActiveList: false,
      },
    ];
    const selected = policy.select(candidates);

    expect(
      selected.map((candidate) => candidate.retailerProductExternalId),
    ).toEqual(["active", "stale", "very", "recent"]);
    expect(
      policy
        .select(candidates, ["manual"])
        .map((candidate) => candidate.retailerProductExternalId),
    ).toEqual(["manual"]);
  });
});
