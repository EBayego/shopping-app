import type { GroupDetail, ShoppingIntent } from "../features/groups/types";

export type PendingOperationStatus = "pending" | "conflict";

type OperationBase = {
  operationId: string;
  groupId: string;
  createdAt: string;
};

export type ShoppingOperation =
  | (OperationBase & {
      kind: "add_intent";
      shoppingListId: string;
      localIntent: ShoppingIntent;
    })
  | (OperationBase & {
      kind: "edit_intent";
      intentId: string;
      rawText: string;
      normalizedName: string;
    })
  | (OperationBase & {
      kind: "set_checked";
      intentId: string;
      checked: boolean;
    })
  | (OperationBase & {
      kind: "change_quantity";
      intentId: string;
      direction: "increment" | "decrement";
    })
  | (OperationBase & { kind: "delete_intent"; intentId: string })
  | (OperationBase & {
      kind: "update_postal_code";
      shoppingListId: string;
      postalCode: string;
    });

export interface PendingOperationRecord {
  sequence: number;
  operation: ShoppingOperation;
  status: PendingOperationStatus;
  attempts: number;
  lastError: string | null;
}

export interface LocalSyncStatus {
  pendingCount: number;
  conflictCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface LocalShoppingStore {
  initialize(): Promise<void>;
  getGroupDetail(groupId: string): Promise<GroupDetail | null>;
  listCachedGroups(): Promise<
    readonly { id: string; name: string; createdAt: string }[]
  >;
  replaceWithServerSnapshot(detail: GroupDetail): Promise<void>;
  enqueue(operation: ShoppingOperation): Promise<void>;
  nextPending(): Promise<PendingOperationRecord | null>;
  acknowledge(
    operation: ShoppingOperation,
    serverIntent?: ShoppingIntent,
  ): Promise<void>;
  markConflict(operationId: string, error: string): Promise<void>;
  recordSyncError(error: string): Promise<void>;
  getSyncStatus(): Promise<LocalSyncStatus>;
}

export interface ShoppingSyncBackend {
  apply(operation: ShoppingOperation): Promise<ShoppingIntent | undefined>;
  getGroupDetail(groupId: string): Promise<GroupDetail>;
}
