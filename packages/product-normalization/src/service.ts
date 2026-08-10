import type {
  ProductMatchCandidate,
  RetailerProduct,
} from "@shopping-app/domain";

import { generateMatchCandidates } from "./matching.ts";
import { normalizeProduct } from "./normalization.ts";
import type {
  CanonicalProductInput,
  MatchDecisionInput,
  ProductMatchingRepository,
  StoredProductMatch,
} from "./types.ts";

export class ProductMatchingService {
  constructor(private readonly repository: ProductMatchingRepository) {}

  async generateCandidates(
    retailerProductId: string,
    product: RetailerProduct,
  ): Promise<ProductMatchCandidate[]> {
    const candidates = await this.repository.findCanonicalCandidates(
      normalizeProduct(product),
    );
    return generateMatchCandidates(product, candidates).map((candidate) => ({
      ...candidate,
      retailerProductId,
    }));
  }

  createCanonicalProduct(input: CanonicalProductInput) {
    return this.repository.createCanonicalProduct(input);
  }

  async proposeMatch(
    candidate: ProductMatchCandidate,
  ): Promise<StoredProductMatch> {
    return this.repository.saveProposal(candidate);
  }

  async associateProduct(
    input: MatchDecisionInput,
  ): Promise<StoredProductMatch> {
    return this.repository.changeMatch(input);
  }

  acceptMatch(matchId: string): Promise<StoredProductMatch> {
    return this.repository.acceptMatch(matchId);
  }

  rejectMatch(matchId: string): Promise<StoredProductMatch> {
    return this.repository.rejectMatch(matchId);
  }

  changeMatch(input: MatchDecisionInput): Promise<StoredProductMatch> {
    return this.repository.changeMatch(input);
  }

  equivalentProducts(
    canonicalProductId: string,
  ): Promise<readonly RetailerProduct[]> {
    return this.repository.findEquivalentProducts(canonicalProductId);
  }
}
