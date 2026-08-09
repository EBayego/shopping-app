import type {
  GroupDetail,
  GroupSummary,
  ShoppingIntent,
} from "../features/groups/types";
import {
  getGroupDetail,
  listGroups,
  shoppingSyncBackend,
} from "../repositories/groups-repository";
import { isNetworkOnline } from "./network-state";
import { sqliteShoppingStore } from "./sqlite-shopping-store";
import { ShoppingSyncEngine } from "./sync-engine";
import type { ShoppingOperation } from "./types";

export const shoppingSyncEngine = new ShoppingSyncEngine(
  sqliteShoppingStore,
  shoppingSyncBackend,
);

export async function getOfflineGroupDetail(
  groupId: string,
): Promise<GroupDetail> {
  await sqliteShoppingStore.initialize();
  if (isNetworkOnline()) {
    try {
      const remote = await getGroupDetail(groupId);
      await sqliteShoppingStore.replaceWithServerSnapshot(remote);
      return (await sqliteShoppingStore.getGroupDetail(groupId)) ?? remote;
    } catch (error) {
      const cached = await sqliteShoppingStore.getGroupDetail(groupId);
      if (cached) return cached;
      throw error;
    }
  }
  const cached = await sqliteShoppingStore.getGroupDetail(groupId);
  if (!cached)
    throw new Error("Esta lista todavía no está disponible sin conexión.");
  return cached;
}

export async function listOfflineGroups(): Promise<readonly GroupSummary[]> {
  await sqliteShoppingStore.initialize();
  if (isNetworkOnline()) {
    try {
      return await listGroups();
    } catch {
      // A cached group is more useful here than replacing the screen with a network error.
    }
  }
  return sqliteShoppingStore.listCachedGroups();
}

export async function enqueueShoppingOperation(
  operation: ShoppingOperation,
): Promise<GroupDetail> {
  await sqliteShoppingStore.initialize();
  await sqliteShoppingStore.enqueue(operation);
  const detail = await sqliteShoppingStore.getGroupDetail(operation.groupId);
  if (!detail) throw new Error("No se ha podido actualizar la caché local.");
  return detail;
}

export function createLocalIntent(input: {
  operationId: string;
  shoppingListId: string;
  rawText: string;
  normalizedName: string;
  canonicalProductId?: string | null;
  requestedQuantity?: number;
  requestedUnit?: string;
  packageCount?: number;
  packageSize?: number;
  packageUnit?: string;
  totalAmount?: number;
  brandPreference?: string;
  variant?: string;
}): ShoppingIntent {
  const now = new Date().toISOString();
  return {
    id: `local:${input.operationId}`,
    shopping_list_id: input.shoppingListId,
    raw_text: input.rawText,
    normalized_name: input.normalizedName,
    requested_quantity: input.requestedQuantity ?? 1,
    requested_unit: input.requestedUnit ?? null,
    package_count: input.packageCount ?? null,
    package_size: input.packageSize ?? null,
    package_unit: input.packageUnit ?? null,
    total_amount: input.totalAmount ?? null,
    brand_preference: input.brandPreference ?? null,
    variant: input.variant ?? null,
    canonical_product_id: input.canonicalProductId ?? null,
    checked: false,
    created_by: null,
    created_at: now,
    updated_at: now,
  };
}
