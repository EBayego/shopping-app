export { isValidGtin } from "./gtin.ts";
export { normalizeProduct, normalizeText } from "./normalization.ts";
export {
  normalizeQuantity,
  parsePackagingFromName,
  quantitiesCompatible,
} from "./units.ts";
export type {
  NormalizedPackaging,
  NormalizedProduct,
  NormalizedQuantity,
} from "./types.ts";
