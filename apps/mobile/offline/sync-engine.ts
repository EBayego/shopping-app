import { getErrorMessage } from "../lib/errors";
import type {
  LocalShoppingStore,
  ShoppingOperation,
  ShoppingSyncBackend,
} from "./types";

export interface SyncResult {
  applied: number;
  conflicts: number;
  interrupted: boolean;
  affectedGroupIds: readonly string[];
}

export class ShoppingSyncEngine {
  constructor(
    private readonly store: LocalShoppingStore,
    private readonly backend: ShoppingSyncBackend,
    private readonly isConflict: (
      error: unknown,
    ) => boolean = isPermanentConflict,
  ) {}

  async sync(): Promise<SyncResult> {
    const affected = new Set<string>();
    let applied = 0;
    let conflicts = 0;
    let interrupted = false;

    while (true) {
      const pending = await this.store.nextPending();
      if (!pending) break;
      const { operation } = pending;
      affected.add(operation.groupId);
      try {
        const result = await this.backend.apply(operation);
        await this.store.acknowledge(operation, result);
        applied += 1;
      } catch (error) {
        const message = getErrorMessage(error);
        if (this.isConflict(error)) {
          await this.store.markConflict(operation.operationId, message);
          conflicts += 1;
          continue;
        }
        await this.store.recordSyncError(message);
        interrupted = true;
        break;
      }
    }

    for (const groupId of affected) {
      try {
        const snapshot = await this.backend.getGroupDetail(groupId);
        await this.store.replaceWithServerSnapshot(snapshot);
      } catch (error) {
        await this.store.recordSyncError(getErrorMessage(error));
        interrupted = true;
        break;
      }
    }

    return {
      applied,
      conflicts,
      interrupted,
      affectedGroupIds: [...affected],
    };
  }
}

function isPermanentConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "P0002" || code === "42501" || code === "22023";
}

export function operationTargetsIntent(
  operation: ShoppingOperation,
): operation is Exclude<
  ShoppingOperation,
  { kind: "add_intent" } | { kind: "update_postal_code" }
> {
  return "intentId" in operation;
}
