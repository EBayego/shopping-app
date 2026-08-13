import type { Json } from "@shopping-app/database";

import type { ProductSearchResult } from "../features/search/types";
import { getSupabaseClient } from "../services/supabase";
import { listSupermarketsForShoppingList } from "./supermarket-preferences-repository";

export async function searchProductsForList(
  shoppingListId: string,
  query: string,
  limit = 20,
): Promise<readonly ProductSearchResult[]> {
  const [{ data, error }, supermarkets] = await Promise.all([
    getSupabaseClient().rpc("search_products_for_list", {
      shopping_list_id: shoppingListId,
      query: query.trim(),
      result_limit: limit,
    }),
    listSupermarketsForShoppingList(shoppingListId),
  ]);
  if (error) throw error;
  const enabledRetailerIds = new Set(
    supermarkets
      .filter((supermarket) => supermarket.enabled)
      .map((supermarket) => supermarket.retailerId),
  );
  return decodeSearchResults(data)
    .map((result) => ({
      ...result,
      retailerProducts: result.retailerProducts.filter((product) =>
        enabledRetailerIds.has(product.retailerId),
      ),
      offers: result.offers.filter((offer) =>
        enabledRetailerIds.has(offer.retailer.id),
      ),
    }))
    .filter(
      (result) =>
        result.canonicalProduct !== null ||
        result.retailerProducts.length > 0 ||
        result.offers.length > 0,
    );
}

function decodeSearchResults(value: Json): readonly ProductSearchResult[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "La búsqueda de productos devolvió una respuesta inválida.",
    );
  }
  return value as unknown as readonly ProductSearchResult[];
}
