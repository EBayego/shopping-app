import { planAutomaticProductLinks } from "@shopping-app/domain";
import { getSupabaseClient } from "../services/supabase";
import { isNetworkOnline } from "../offline/network-state";
import { sqliteShoppingStore } from "../offline/sqlite-shopping-store";
import { decodeInputs } from "./basket-comparison-repository";

export interface AutomaticLinkResult {
  batchId: string;
  applied: number;
  skipped: number;
  unresolved: number;
  preservedManual: number;
}

async function requireSyncedConnection(): Promise<void> {
  if (!isNetworkOnline())
    throw new Error("Conéctate para buscar precios y enlazar automáticamente.");
  await sqliteShoppingStore.initialize();
  const status = await sqliteShoppingStore.getSyncStatus();
  if (status.pendingCount > 0 || status.conflictCount > 0) {
    throw new Error(
      "Sincroniza o revisa los cambios pendientes antes de enlazar automáticamente.",
    );
  }
}

export async function automaticallyLinkProducts(
  shoppingListId: string,
  operationId: string,
): Promise<AutomaticLinkResult> {
  await requireSyncedConnection();
  const { data, error } = await getSupabaseClient().rpc(
    "get_product_link_inputs",
    { shopping_list_id: shoppingListId },
  );
  if (error) throw error;
  const inputs = decodeInputs(data);
  const plan = planAutomaticProductLinks(inputs.intents, inputs.candidates);
  if (plan.choices.length > 500)
    throw new Error(
      "El enlace automático admite hasta 500 artículos por lista.",
    );
  // The batch RPC rechecks membership, selection, input timestamps and observed prices.
  await requireSyncedConnection();
  const result = await getSupabaseClient().rpc("apply_shopping_product_links", {
    operation_id: operationId,
    shopping_list_id: shoppingListId,
    choices: plan.choices.map((choice) => ({ ...choice })),
  });
  if (result.error) throw result.error;
  const value = result.data;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.batchId !== "string" ||
    typeof value.applied !== "number" ||
    typeof value.skipped !== "number"
  ) {
    throw new Error("El enlace automático devolvió una respuesta inválida.");
  }
  return {
    batchId: value.batchId,
    applied: value.applied,
    skipped: value.skipped,
    unresolved: plan.unresolvedIds.length,
    preservedManual: plan.preservedManual,
  };
}

export async function undoAutomaticProductLinks(
  batchId: string,
  operationId: string,
): Promise<number> {
  await requireSyncedConnection();
  const { data, error } = await getSupabaseClient().rpc(
    "undo_shopping_product_links",
    {
      operation_id: operationId,
      batch_id: batchId,
    },
  );
  if (error) throw error;
  return data;
}
