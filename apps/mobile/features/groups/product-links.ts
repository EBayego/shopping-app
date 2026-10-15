import type { Json } from "@shopping-app/database";
import type { ShoppingIntent } from "./types";

export interface ProductLink {
  offerId: string;
  productId: string;
  marketId: string;
  productName: string;
  retailerId: string;
  retailerCode: string;
  retailerName: string;
  price: number;
  observedAt: string;
  source: "manual" | "automatic";
  approximate: boolean;
  imageUrl: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  packageCount: number | null;
  referenceAmount: number | null;
  referenceUnit: string | null;
}

export function readProductLink(value: Json | undefined): ProductLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    typeof value.offerId !== "string" ||
    typeof value.productId !== "string" ||
    typeof value.marketId !== "string" ||
    typeof value.productName !== "string" ||
    typeof value.retailerId !== "string" ||
    typeof value.retailerCode !== "string" ||
    typeof value.retailerName !== "string" ||
    typeof value.observedAt !== "string" ||
    typeof value.price !== "number" ||
    !Number.isFinite(value.price) ||
    (value.source !== "manual" && value.source !== "automatic")
  )
    return null;
  return {
    offerId: value.offerId,
    productId: value.productId,
    marketId: value.marketId,
    productName: value.productName,
    retailerId: value.retailerId,
    retailerCode: value.retailerCode,
    retailerName: value.retailerName,
    price: value.price,
    observedAt: value.observedAt,
    source: value.source,
    approximate: value.approximate === true,
    imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : null,
    packageSize:
      typeof value.packageSize === "number" ? value.packageSize : null,
    packageUnit:
      typeof value.packageUnit === "string" ? value.packageUnit : null,
    packageCount:
      typeof value.packageCount === "number" ? value.packageCount : null,
    referenceAmount:
      typeof value.referenceAmount === "number" ? value.referenceAmount : null,
    referenceUnit:
      typeof value.referenceUnit === "string" ? value.referenceUnit : null,
  };
}

/** Matches private.shopping_link_input; independent of local/server timestamps. */
export function productLinkInput(intent: ShoppingIntent): Json {
  return {
    name: intent.normalized_name,
    quantity: intent.requested_quantity,
    unit: intent.requested_unit,
    count: intent.package_count,
    size: intent.package_size,
    packageUnit: intent.package_unit,
    packageType: intent.package_type ?? null,
    total: intent.total_amount,
    brand: intent.brand_preference,
    variant: intent.variant,
  };
}
