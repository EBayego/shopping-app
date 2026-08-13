import type { SupermarketPreference } from "../features/supermarkets/types";
import { getSupabaseClient } from "../services/supabase";

export async function listSupermarketsForShoppingList(
  shoppingListId: string,
): Promise<readonly SupermarketPreference[]> {
  const client = getSupabaseClient();
  const [retailersResult, preferencesResult] = await Promise.all([
    client
      .from("retailers")
      .select("id,code,name")
      .eq("active", true)
      .order("name"),
    client
      .from("shopping_list_retailer_preferences")
      .select("retailer_id,enabled")
      .eq("shopping_list_id", shoppingListId),
  ]);
  if (retailersResult.error) throw retailersResult.error;
  if (preferencesResult.error) throw preferencesResult.error;

  const enabledByRetailer = new Map(
    preferencesResult.data.map((preference) => [
      preference.retailer_id,
      preference.enabled,
    ]),
  );
  return retailersResult.data.map((retailer) => ({
    retailerId: retailer.id,
    code: retailer.code,
    name: retailer.name,
    enabled: enabledByRetailer.get(retailer.id) ?? true,
  }));
}

export async function setSupermarketEnabledForShoppingList(input: {
  shoppingListId: string;
  retailerId: string;
  enabled: boolean;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc(
    "set_shopping_list_retailer_enabled",
    {
      target_shopping_list_id: input.shoppingListId,
      target_retailer_id: input.retailerId,
      target_enabled: input.enabled,
    },
  );
  if (error) throw error;
}
