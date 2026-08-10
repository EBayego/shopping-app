import type { Json } from "@shopping-app/database";

import type { ProductSearchResult } from "../features/search/types";
import { getSupabaseClient } from "../services/supabase";

export async function searchProductsForList(
  shoppingListId: string,
  query: string,
  limit = 20,
): Promise<readonly ProductSearchResult[]> {
  const { data, error } = await getSupabaseClient().rpc(
    "search_products_for_list",
    {
      shopping_list_id: shoppingListId,
      query: query.trim(),
      result_limit: limit,
    },
  );
  if (error) throw error;
  return decodeSearchResults(data);
}

function decodeSearchResults(value: Json): readonly ProductSearchResult[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "La búsqueda de productos devolvió una respuesta inválida.",
    );
  }
  return value as unknown as readonly ProductSearchResult[];
}
