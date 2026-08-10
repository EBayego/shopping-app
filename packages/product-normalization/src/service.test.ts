import type {
  CanonicalProduct,
  ProductMatchCandidate,
  RetailerProduct,
} from "@shopping-app/domain";
import { describe, expect, it, vi } from "vitest";

import { ProductMatchingService } from "./service.ts";
import type { ProductMatchingRepository, StoredProductMatch } from "./types.ts";

describe("ProductMatchingService", () => {
  it("normalizes a retailer product and asks the repository for a bounded candidate pool", async () => {
    const { repository, spies } = fakeRepository();
    spies.findCanonicalCandidates.mockResolvedValue([
      canonical("Leche semidesnatada", {
        category: "Leche",
        normalizedCategory: "leche",
      }),
    ]);
    const service = new ProductMatchingService(repository);
    const candidates = await service.generateCandidates(
      "retailer-db-uuid",
      retailer(),
    );
    expect(spies.findCanonicalCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: "Leche semidesnatada DIA Láctea 1 L",
        normalizedName: "leche semidesnatada",
        normalizedBrand: "dia lactea",
      }),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.retailerProductId).toBe("retailer-db-uuid");
  });

  it("supports proposal, acceptance and rejection without UI dependencies", async () => {
    const { repository, spies } = fakeRepository();
    const service = new ProductMatchingService(repository);
    const candidate = matchCandidate();
    await service.proposeMatch(candidate);
    await service.acceptMatch("match-id");
    await service.rejectMatch("match-id");
    expect(spies.saveProposal).toHaveBeenCalledWith(candidate);
    expect(spies.acceptMatch).toHaveBeenCalledWith("match-id");
    expect(spies.rejectMatch).toHaveBeenCalledWith("match-id");
  });

  it("changes an association and queries accepted equivalent products", async () => {
    const { repository, spies } = fakeRepository();
    const service = new ProductMatchingService(repository);
    const input = {
      canonicalProductId: "new-canonical",
      retailerProductId: "retailer-id",
      matchType: "SUBSTITUTE" as const,
      method: "MANUAL",
      score: 0.8,
      confidence: "MEDIUM" as const,
      reasons: [{ feature: "review", matched: true }],
    };
    await service.changeMatch(input);
    await service.equivalentProducts("new-canonical");
    expect(spies.changeMatch).toHaveBeenCalledWith(input);
    expect(spies.findEquivalentProducts).toHaveBeenCalledWith("new-canonical");
  });
});

function fakeRepository() {
  const stored = storedMatch();
  const spies = {
    findCanonicalCandidates: vi.fn().mockResolvedValue([]),
    createCanonicalProduct: vi.fn().mockResolvedValue(canonical("Leche")),
    saveProposal: vi.fn().mockResolvedValue(stored),
    acceptMatch: vi
      .fn()
      .mockResolvedValue({ ...stored, status: "ACCEPTED", reviewed: true }),
    rejectMatch: vi
      .fn()
      .mockResolvedValue({ ...stored, status: "REJECTED", reviewed: true }),
    changeMatch: vi
      .fn()
      .mockResolvedValue({ ...stored, status: "ACCEPTED", reviewed: true }),
    findEquivalentProducts: vi.fn().mockResolvedValue([retailer()]),
  };
  const repository: ProductMatchingRepository = { ...spies };
  return { repository, spies };
}

function retailer(): RetailerProduct {
  return {
    retailer: "DIA",
    externalId: "retailer-id",
    name: "Leche semidesnatada DIA Láctea 1 L",
    brand: "DIA Láctea",
    packageSize: 1,
    packageUnit: "l",
    category: "Leche",
    variableWeight: false,
    marketId: "market",
    observedAt: new Date(0),
  };
}

function canonical(
  name: string,
  overrides: Partial<CanonicalProduct> = {},
): CanonicalProduct {
  return {
    id: "canonical-id",
    name,
    normalizedName: name.toLowerCase(),
    baseName: "leche",
    ...overrides,
  };
}

function matchCandidate(): ProductMatchCandidate {
  return {
    canonicalProductId: "canonical-id",
    retailerProductId: "retailer-id",
    matchType: "SUBSTITUTE",
    method: "CATEGORY_NAME_FORMAT",
    score: 0.8,
    confidence: "MEDIUM",
    reasons: [],
    autoAccept: false,
  };
}

function storedMatch(): StoredProductMatch {
  return {
    id: "match-id",
    canonicalProductId: "canonical-id",
    retailerProductId: "retailer-id",
    matchType: "SUBSTITUTE",
    method: "CATEGORY_NAME_FORMAT",
    score: 0.8,
    confidence: "MEDIUM",
    reasons: [],
    status: "PROPOSED",
    reviewed: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
