import type {
  CanonicalProduct,
  ProductMatchCandidate,
  ProductMatchConfidence,
  ProductMatchReason,
  RetailerProduct,
} from "@shopping-app/domain";

import { isValidGtin } from "./gtin.ts";
import { normalizeProduct, normalizeText } from "./normalization.ts";
import type { MatchThresholds, NormalizedProduct } from "./types.ts";
import { normalizeQuantity, quantitiesCompatible } from "./units.ts";

export const DEFAULT_MATCH_THRESHOLDS: Readonly<MatchThresholds> =
  Object.freeze({
    high: 0.85,
    medium: 0.65,
    minimumCandidate: 0.42,
    automaticAcceptance: 0.92,
    textSimilarityFloor: 0.35,
    formatRelativeTolerance: 0.02,
  });

export function generateMatchCandidates(
  retailerProduct: RetailerProduct,
  canonicalProducts: readonly CanonicalProduct[],
  thresholds: MatchThresholds = DEFAULT_MATCH_THRESHOLDS,
): ProductMatchCandidate[] {
  return canonicalProducts
    .map((canonical) =>
      scoreProductMatch(retailerProduct, canonical, thresholds),
    )
    .filter(
      (candidate): candidate is ProductMatchCandidate =>
        candidate !== undefined,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.canonicalProductId.localeCompare(right.canonicalProductId),
    );
}

export function scoreProductMatch(
  retailerProduct: RetailerProduct,
  canonical: CanonicalProduct,
  thresholds: MatchThresholds = DEFAULT_MATCH_THRESHOLDS,
): ProductMatchCandidate | undefined {
  const source = normalizeProduct(retailerProduct);
  const target = normalizeCanonical(canonical);
  const retailerProductId = retailerProduct.externalId;

  if (
    source.gtin !== undefined &&
    target.gtin !== undefined &&
    source.gtin === target.gtin
  ) {
    return {
      canonicalProductId: canonical.id,
      retailerProductId,
      matchType: "EXACT_MATCH",
      method: "GTIN_EXACT",
      score: 1,
      confidence: "HIGH",
      reasons: [
        {
          feature: "gtin",
          matched: true,
          weight: 1,
          detail: `GTIN válido idéntico: ${source.gtin}`,
        },
      ],
      autoAccept: true,
    };
  }

  const reasons: ProductMatchReason[] = [];
  const nameSimilarity = textSimilarity(
    source.normalizedName,
    target.normalizedName,
  );
  const baseSimilarity = textSimilarity(source.baseName, target.baseName);
  addReason(
    reasons,
    "normalized_name",
    nameSimilarity >= thresholds.textSimilarityFloor,
    0.35 * nameSimilarity,
    `similitud=${round(nameSimilarity)}`,
  );
  addReason(
    reasons,
    "base_name",
    baseSimilarity >= thresholds.textSimilarityFloor,
    0.15 * baseSimilarity,
    `similitud=${round(baseSimilarity)}`,
  );

  const brand = equality(source.normalizedBrand, target.normalizedBrand);
  if (brand !== undefined)
    addReason(
      reasons,
      "brand",
      brand,
      brand ? 0.18 : -0.12,
      brand ? "marca idéntica" : "marca distinta",
    );
  const variant = equality(source.variant, target.variant);
  if (variant !== undefined)
    addReason(
      reasons,
      "variant",
      variant,
      variant ? 0.12 : -0.18,
      variant ? "variante idéntica" : "variante incompatible",
    );
  const category = equality(
    source.normalizedCategory,
    target.normalizedCategory,
  );
  if (category !== undefined)
    addReason(
      reasons,
      "category",
      category,
      category ? 0.08 : -0.22,
      category ? "categoría idéntica" : "categoría distinta",
    );

  const format = quantitiesCompatible(
    source.packaging.totalAmount,
    target.packaging.totalAmount,
    thresholds.formatRelativeTolerance,
  );
  if (format !== undefined)
    addReason(
      reasons,
      "format",
      format,
      format ? 0.2 : -0.38,
      format
        ? "cantidad total compatible"
        : "dimensión o cantidad incompatible",
    );
  const count = equality(
    source.packaging.packageCount,
    target.packaging.packageCount,
  );
  if (count !== undefined)
    addReason(
      reasons,
      "package_count",
      count,
      count ? 0.05 : -0.04,
      count ? "mismo número de envases" : "número de envases distinto",
    );

  const score = round(
    clamp(reasons.reduce((sum, reason) => sum + reason.weight, 0)),
  );
  if (
    score < thresholds.minimumCandidate ||
    format === false ||
    category === false ||
    variant === false
  )
    return undefined;

  const demonstratedCommercialIdentity =
    brand === true &&
    nameSimilarity >= 0.9 &&
    format === true &&
    (variant === true || variant === undefined);
  const matchType = demonstratedCommercialIdentity
    ? "EXACT_MATCH"
    : "SUBSTITUTE";
  const method = demonstratedCommercialIdentity
    ? "BRAND_VARIANT_FORMAT"
    : category === true && nameSimilarity >= 0.75
      ? "CATEGORY_NAME_FORMAT"
      : "TEXT_SIMILARITY";
  const confidence = confidenceFor(score, thresholds);
  return {
    canonicalProductId: canonical.id,
    retailerProductId,
    matchType,
    method,
    score,
    confidence,
    reasons,
    autoAccept: confidence !== "LOW" && score >= thresholds.automaticAcceptance,
  };
}

function normalizeCanonical(product: CanonicalProduct): NormalizedProduct {
  const packageSize =
    product.packageSize === undefined || product.packageUnit === undefined
      ? undefined
      : normalizeQuantity(product.packageSize, product.packageUnit);
  const totalAmount =
    product.totalAmount === undefined || product.packageUnit === undefined
      ? packageSize === undefined
        ? undefined
        : normalizeQuantity(
            packageSize.baseAmount * (product.packageCount ?? 1),
            packageSize.baseUnit,
          )
      : normalizeQuantity(product.totalAmount, product.packageUnit);
  const gtin = isValidGtin(product.gtin) ? product.gtin : undefined;
  const normalizedName = normalizeText(product.normalizedName || product.name);
  const variant =
    product.variant === undefined ? undefined : normalizeText(product.variant);
  const baseName = normalizeText(product.baseName || normalizedName)
    .replace(
      variant === undefined
        ? /$^/
        : new RegExp(`\\b${escapeRegExp(variant)}\\b`, "g"),
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  const normalizedBrand =
    product.normalizedBrand ??
    (product.brand === undefined ? undefined : normalizeText(product.brand));
  const normalizedCategory =
    product.normalizedCategory ??
    (product.category === undefined
      ? undefined
      : normalizeText(product.category));
  return {
    originalName: product.name,
    normalizedName,
    baseName,
    ...(normalizedBrand === undefined ? {} : { normalizedBrand }),
    ...(variant === undefined ? {} : { variant }),
    ...(normalizedCategory === undefined ? {} : { normalizedCategory }),
    ...(gtin === undefined ? {} : { gtin }),
    packaging: {
      ...(product.packageCount === undefined
        ? {}
        : { packageCount: product.packageCount }),
      ...(packageSize === undefined ? {} : { packageSize }),
      ...(totalAmount === undefined ? {} : { totalAmount }),
      source: packageSize === undefined ? "UNKNOWN" : "STRUCTURED",
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textSimilarity(left: string, right: string): number {
  if (left === right) return left === "" ? 0 : 1;
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection++;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function equality<T>(
  left: T | undefined,
  right: T | undefined,
): boolean | undefined {
  return left === undefined || right === undefined ? undefined : left === right;
}

function addReason(
  reasons: ProductMatchReason[],
  feature: string,
  matched: boolean,
  weight: number,
  detail: string,
): void {
  reasons.push({ feature, matched, weight: round(weight), detail });
}

function confidenceFor(
  score: number,
  thresholds: MatchThresholds,
): ProductMatchConfidence {
  if (score >= thresholds.high) return "HIGH";
  if (score >= thresholds.medium) return "MEDIUM";
  return "LOW";
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
