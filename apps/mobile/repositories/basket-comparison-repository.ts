import type { Json } from "@shopping-app/database";
import {
  compareBaskets,
  isRetailer,
  type BasketComparison,
  type BasketIntent,
  type BasketOfferCandidate,
  type ProductUnit,
} from "@shopping-app/domain";

import { getSupabaseClient } from "../services/supabase";
import { listSupermarketsForShoppingList } from "./supermarket-preferences-repository";

interface ComparisonInputs {
  retailers: readonly string[];
  intents: readonly BasketIntent[];
  candidates: readonly BasketOfferCandidate[];
}

export async function getBasketComparisons(
  shoppingListId: string,
): Promise<readonly BasketComparison[]> {
  const [{ data, error }, supermarkets] = await Promise.all([
    getSupabaseClient().rpc("get_basket_comparison_inputs", {
      shopping_list_id: shoppingListId,
    }),
    listSupermarketsForShoppingList(shoppingListId),
  ]);
  if (error) throw error;
  const inputs = decodeInputs(data);
  const enabledRetailers = new Set(
    supermarkets
      .filter((supermarket) => supermarket.enabled)
      .map((supermarket) => supermarket.code),
  );
  const retailers = inputs.retailers
    .filter(isRetailer)
    .filter((retailer) => enabledRetailers.has(retailer));
  return compareBaskets(
    inputs.intents,
    inputs.candidates.filter((candidate) =>
      enabledRetailers.has(candidate.retailer),
    ),
    retailers,
  );
}

function decodeInputs(value: Json): ComparisonInputs {
  if (!isRecord(value)) throw invalidResponse();
  const retailers = value.retailers;
  const intents = value.intents;
  const candidates = value.candidates;
  if (
    !Array.isArray(retailers) ||
    !retailers.every((item) => typeof item === "string") ||
    !Array.isArray(intents) ||
    !Array.isArray(candidates)
  ) {
    throw invalidResponse();
  }
  return {
    retailers,
    intents: intents.map(decodeIntent),
    candidates: candidates.map(decodeCandidate),
  };
}

function decodeIntent(value: Json): BasketIntent {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) {
    throw invalidResponse();
  }
  return {
    id: value.id,
    name: value.name,
    ...(isString(value.productConceptId)
      ? { productConceptId: value.productConceptId }
      : {}),
    ...optionalNumber(value, "requestedQuantity"),
    ...optionalUnit(value, "requestedUnit"),
    ...optionalNumber(value, "packageCount"),
    ...optionalNumber(value, "packageSize"),
    ...optionalUnit(value, "packageUnit"),
    ...optionalNumber(value, "totalAmount"),
    ...(isString(value.brandPreference)
      ? { brandPreference: value.brandPreference }
      : {}),
    ...(isString(value.variant) ? { variant: value.variant } : {}),
    ...optionalNumber(value, "defaultAmount"),
    ...optionalUnit(value, "defaultUnit"),
    ...(isSelectionPolicy(value.selectionPolicy)
      ? { selectionPolicy: value.selectionPolicy }
      : {}),
  };
}

function decodeCandidate(value: Json): BasketOfferCandidate {
  if (
    !isRecord(value) ||
    !isString(value.intentId) ||
    !isString(value.retailer) ||
    !isRetailer(value.retailer) ||
    !isString(value.productId) ||
    !isString(value.productName) ||
    !isClassificationConfidence(value.classificationConfidence) ||
    typeof value.classificationAccepted !== "boolean" ||
    typeof value.standard !== "boolean" ||
    typeof value.variableWeight !== "boolean" ||
    !isNumber(value.normalPrice) ||
    typeof value.requiresMembership !== "boolean" ||
    typeof value.available !== "boolean" ||
    !isFreshness(value.freshness)
  ) {
    throw invalidResponse();
  }
  return {
    intentId: value.intentId,
    retailer: value.retailer,
    productId: value.productId,
    productName: value.productName,
    ...(isString(value.brand) ? { brand: value.brand } : {}),
    classificationConfidence: value.classificationConfidence,
    classificationAccepted: value.classificationAccepted,
    standard: value.standard,
    variableWeight: value.variableWeight,
    normalPrice: value.normalPrice,
    requiresMembership: value.requiresMembership,
    available: value.available,
    freshness: value.freshness,
    ...optionalNumber(value, "packageCount"),
    ...optionalNumber(value, "packageSize"),
    ...optionalUnit(value, "packageUnit"),
    ...optionalNumber(value, "totalAmount"),
    ...optionalNumber(value, "promoPrice"),
    ...optionalNumber(value, "pricePerUnit"),
    ...optionalUnit(value, "referenceUnit"),
    ...(isString(value.promotionText)
      ? { promotionText: value.promotionText }
      : {}),
  };
}

function optionalNumber<K extends string>(
  value: Record<string, Json | undefined>,
  key: K,
): Partial<Record<K, number>> {
  const item = value[key];
  return isNumber(item) ? ({ [key]: item } as Record<K, number>) : {};
}

function optionalUnit<K extends string>(
  value: Record<string, Json | undefined>,
  key: K,
): Partial<Record<K, ProductUnit>> {
  const item = value[key];
  return isProductUnit(item) ? ({ [key]: item } as Record<K, ProductUnit>) : {};
}

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: Json | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProductUnit(value: Json | undefined): value is ProductUnit {
  return (
    value === "unit" ||
    value === "g" ||
    value === "kg" ||
    value === "ml" ||
    value === "l"
  );
}

function isClassificationConfidence(
  value: Json | undefined,
): value is "HIGH" | "MEDIUM" | "LOW" {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW";
}

function isSelectionPolicy(
  value: Json | undefined,
): value is "CHEAPEST_COVERING" | "CLOSEST_AMOUNT" {
  return value === "CHEAPEST_COVERING" || value === "CLOSEST_AMOUNT";
}

function isFreshness(
  value: Json | undefined,
): value is "FRESH" | "STALE" | "VERY_STALE" {
  return value === "FRESH" || value === "STALE" || value === "VERY_STALE";
}

function invalidResponse(): Error {
  return new Error("La comparación devolvió una respuesta inválida.");
}
