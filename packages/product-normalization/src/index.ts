export { isValidGtin } from "./gtin.js";
export {
  DEFAULT_MATCH_THRESHOLDS,
  generateMatchCandidates,
  scoreProductMatch,
} from "./matching.js";
export { normalizeProduct, normalizeText } from "./normalization.js";
export { ProductMatchingService } from "./service.js";
export { SupabaseProductMatchingRepository } from "./supabase-repository.js";
export {
  normalizeQuantity,
  parsePackagingFromName,
  quantitiesCompatible,
} from "./units.js";
export type {
  CanonicalProductInput,
  MatchDecisionInput,
  MatchThresholds,
  NormalizedPackaging,
  NormalizedProduct,
  NormalizedQuantity,
  ProductMatchingRepository,
  StoredProductMatch,
} from "./types.js";
