export { isValidGtin } from "./gtin.ts";
export {
  DEFAULT_MATCH_THRESHOLDS,
  generateMatchCandidates,
  scoreProductMatch,
} from "./matching.ts";
export { normalizeProduct, normalizeText } from "./normalization.ts";
export { ProductMatchingService } from "./service.ts";
export { SupabaseProductMatchingRepository } from "./supabase-repository.ts";
export {
  normalizeQuantity,
  parsePackagingFromName,
  quantitiesCompatible,
} from "./units.ts";
export type {
  CanonicalProductInput,
  MatchDecisionInput,
  MatchThresholds,
  NormalizedPackaging,
  NormalizedProduct,
  NormalizedQuantity,
  ProductMatchingRepository,
  StoredProductMatch,
} from "./types.ts";
