import { describe, expect, it } from "vitest";

import type { GroupDetail, ShoppingIntent } from "../features/groups/types";
import { applyOperationLocally, remapIntentId } from "./operations";
import { ShoppingSyncEngine } from "./sync-engine";
import type {
  LocalShoppingStore,
  LocalSyncStatus,
  PendingOperationRecord,
  ShoppingOperation,
  ShoppingSyncBackend,
} from "./types";

describe("ShoppingSyncEngine", () => {
  it("persists the outbox across a simulated app restart", async () => {
    const store = new MemoryStore(detailFixture());
    await store.enqueue(toggle("op-1", true));

    const restartedEngine = new ShoppingSyncEngine(store, new Backend());
    await restartedEngine.sync();

    expect(store.operations).toHaveLength(0);
    expect(store.detail.intents[0]?.checked).toBe(true);
  });

  it("does not apply a duplicate operation twice", async () => {
    const store = new MemoryStore(detailFixture());
    const operation = quantity("same-id", "increment");
    await store.enqueue(operation);
    await store.enqueue(operation);
    const backend = new Backend();
    const engine = new ShoppingSyncEngine(store, backend);

    await engine.sync();
    await engine.sync();

    expect(backend.applied).toEqual(["same-id"]);
  });

  it("replays several offline operations in insertion order", async () => {
    const store = new MemoryStore(detailFixture());
    await store.enqueue(quantity("first", "increment"));
    await store.enqueue(toggle("second", true));
    await store.enqueue(quantity("third", "decrement"));
    const backend = new Backend();

    await new ShoppingSyncEngine(store, backend).sync();

    expect(backend.applied).toEqual(["first", "second", "third"]);
  });

  it("syncs persisted changes when reconnect is triggered", async () => {
    const store = new MemoryStore(detailFixture());
    await store.enqueue(toggle("offline", true));
    const backend = new Backend();

    expect(backend.applied).toHaveLength(0);
    await new ShoppingSyncEngine(store, backend).sync();

    expect(backend.applied).toEqual(["offline"]);
    expect((await store.getSyncStatus()).pendingCount).toBe(0);
  });

  it("continues a partial replay from the failed operation", async () => {
    const store = new MemoryStore(detailFixture());
    await store.enqueue(toggle("one", true));
    await store.enqueue(quantity("two", "increment"));
    await store.enqueue(quantity("three", "increment"));
    const backend = new Backend("two");

    const first = await new ShoppingSyncEngine(store, backend).sync();
    backend.failOnceAt = null;
    const second = await new ShoppingSyncEngine(store, backend).sync();

    expect(first.interrupted).toBe(true);
    expect(second.interrupted).toBe(false);
    expect(backend.applied).toEqual(["one", "two", "three"]);
  });

  it("retains an impossible edit as a conflict when the item was remotely deleted", async () => {
    const store = new MemoryStore(detailFixture());
    await store.enqueue(edit("edit-deleted", "Pan integral"));
    const backend = new Backend();
    backend.snapshot = { ...detailFixture(), intents: [] };
    backend.conflictAt = "edit-deleted";

    await new ShoppingSyncEngine(store, backend).sync();

    const status = await store.getSyncStatus();
    expect(status.conflictCount).toBe(1);
    expect(store.operations[0]?.operation).toMatchObject({
      operationId: "edit-deleted",
      rawText: "Pan integral",
    });
    expect(store.detail.intents).toHaveLength(0);
  });

  it("keeps the current operation pending when sync is interrupted", async () => {
    const store = new MemoryStore(detailFixture());
    await store.enqueue(toggle("network-failure", true));
    const backend = new Backend("network-failure");

    await new ShoppingSyncEngine(store, backend).sync();

    expect((await store.nextPending())?.operation.operationId).toBe(
      "network-failure",
    );
    expect(store.operations[0]?.attempts).toBe(1);
  });

  it("reconciles with the authoritative snapshot without losing unprocessed changes", async () => {
    const store = new MemoryStore(detailFixture());
    await store.enqueue(toggle("confirmed", true));
    await store.enqueue(edit("still-pending", "Leche sin lactosa"));
    const backend = new Backend("still-pending");
    backend.snapshot = detailFixture();

    await new ShoppingSyncEngine(store, backend).sync();

    expect(store.detail.intents[0]).toMatchObject({
      raw_text: "Leche sin lactosa",
    });
    expect((await store.nextPending())?.operation.operationId).toBe(
      "still-pending",
    );
  });

  it("remaps later offline operations after an offline add is confirmed", async () => {
    const store = new MemoryStore(detailFixture());
    const local = intentFixture("local:add");
    const add: ShoppingOperation = {
      kind: "add_intent",
      operationId: "add",
      groupId: "group-1",
      shoppingListId: "list-1",
      localIntent: local,
      createdAt: NOW,
    };
    await store.enqueue(add);
    const toggleLocal: ShoppingOperation = {
      kind: "set_checked",
      operationId: "toggle-local",
      groupId: "group-1",
      intentId: local.id,
      checked: true,
      createdAt: NOW,
    };
    await store.enqueue(toggleLocal);
    const backend = new Backend();
    backend.addResult = intentFixture("server-id");

    await new ShoppingSyncEngine(store, backend).sync();

    expect(backend.received[1]).toMatchObject({ intentId: "server-id" });
  });
});

class Backend implements ShoppingSyncBackend {
  applied: string[] = [];
  received: ShoppingOperation[] = [];
  snapshot = detailFixture();
  conflictAt: string | null = null;
  addResult: ShoppingIntent | undefined;

  constructor(public failOnceAt: string | null = null) {}

  apply(operation: ShoppingOperation): Promise<ShoppingIntent | undefined> {
    this.received.push(operation);
    if (this.failOnceAt === operation.operationId) {
      this.failOnceAt = null;
      throw new Error("network unavailable");
    }
    if (this.conflictAt === operation.operationId) {
      throw Object.assign(new Error("Shopping item not found"), {
        code: "P0002",
      });
    }
    this.applied.push(operation.operationId);
    if (operation.kind !== "add_intent") {
      this.snapshot = applyOperationLocally(this.snapshot, operation);
    }
    return Promise.resolve(
      operation.kind === "add_intent" ? this.addResult : undefined,
    );
  }

  getGroupDetail(): Promise<GroupDetail> {
    return Promise.resolve(this.snapshot);
  }
}

class MemoryStore implements LocalShoppingStore {
  operations: PendingOperationRecord[] = [];
  lastError: string | null = null;
  lastSyncedAt: string | null = null;
  private sequence = 0;

  constructor(public detail: GroupDetail) {}

  initialize() {
    return Promise.resolve();
  }
  getGroupDetail(groupId: string) {
    return Promise.resolve(
      this.detail.group.id === groupId ? this.detail : null,
    );
  }
  listCachedGroups() {
    return Promise.resolve([
      {
        id: this.detail.group.id,
        name: this.detail.group.name,
        createdAt: NOW,
      },
    ]);
  }
  replaceWithServerSnapshot(detail: GroupDetail) {
    this.detail = this.operations
      .filter((record) => record.status === "pending")
      .reduce(
        (projection, record) =>
          applyOperationLocally(projection, record.operation),
        detail,
      );
    this.lastSyncedAt = NOW;
    return Promise.resolve();
  }
  enqueue(operation: ShoppingOperation) {
    if (
      this.operations.some(
        (item) => item.operation.operationId === operation.operationId,
      )
    ) {
      return Promise.resolve();
    }
    this.detail = applyOperationLocally(this.detail, operation);
    this.operations.push({
      sequence: ++this.sequence,
      operation,
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    return Promise.resolve();
  }
  nextPending() {
    return Promise.resolve(
      this.operations.find((item) => item.status === "pending") ?? null,
    );
  }
  acknowledge(operation: ShoppingOperation, serverIntent?: ShoppingIntent) {
    if (operation.kind === "add_intent" && serverIntent) {
      this.detail = {
        ...this.detail,
        intents: this.detail.intents.map((intent) =>
          intent.id === operation.localIntent.id
            ? { ...intent, id: serverIntent.id }
            : intent,
        ),
      };
      this.operations = this.operations.map((record) => ({
        ...record,
        operation: remapIntentId(
          record.operation,
          operation.localIntent.id,
          serverIntent.id,
        ),
      }));
    }
    this.operations = this.operations.filter(
      (item) => item.operation.operationId !== operation.operationId,
    );
    return Promise.resolve();
  }
  markConflict(operationId: string, error: string) {
    this.operations = this.operations.map((record) =>
      record.operation.operationId === operationId
        ? {
            ...record,
            status: "conflict",
            attempts: record.attempts + 1,
            lastError: error,
          }
        : record,
    );
    this.lastError = error;
    return Promise.resolve();
  }
  recordSyncError(error: string) {
    const pending = this.operations.find(
      (record) => record.status === "pending",
    );
    if (pending) {
      pending.attempts += 1;
      pending.lastError = error;
    }
    this.lastError = error;
    return Promise.resolve();
  }
  getSyncStatus(): Promise<LocalSyncStatus> {
    return Promise.resolve({
      pendingCount: this.operations.filter((item) => item.status === "pending")
        .length,
      conflictCount: this.operations.filter(
        (item) => item.status === "conflict",
      ).length,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    });
  }
}

const NOW = "2026-08-09T12:00:00.000Z";

function detailFixture(): GroupDetail {
  return {
    group: {
      id: "group-1",
      name: "Casa",
      created_by: "user-1",
      created_at: NOW,
      updated_at: NOW,
    },
    lists: [
      {
        id: "list-1",
        group_id: "group-1",
        name: "Compra",
        postal_code: "28001",
        created_by: "user-1",
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    intents: [intentFixture("intent-1")],
    members: [],
  };
}

function intentFixture(id: string): ShoppingIntent {
  return {
    id,
    shopping_list_id: "list-1",
    raw_text: "Leche",
    normalized_name: "leche",
    requested_quantity: 1,
    requested_unit: null,
    package_count: null,
    package_size: null,
    package_unit: null,
    total_amount: null,
    brand_preference: null,
    variant: null,
    canonical_product_id: null,
    checked: false,
    created_by: "user-1",
    created_at: NOW,
    updated_at: NOW,
  };
}

function toggle(operationId: string, checked: boolean): ShoppingOperation {
  return {
    kind: "set_checked",
    operationId,
    groupId: "group-1",
    intentId: "intent-1",
    checked,
    createdAt: NOW,
  };
}

function quantity(
  operationId: string,
  direction: "increment" | "decrement",
): ShoppingOperation {
  return {
    kind: "change_quantity",
    operationId,
    groupId: "group-1",
    intentId: "intent-1",
    direction,
    createdAt: NOW,
  };
}

function edit(operationId: string, rawText: string): ShoppingOperation {
  return {
    kind: "edit_intent",
    operationId,
    groupId: "group-1",
    intentId: "intent-1",
    rawText,
    normalizedName: rawText.toLowerCase(),
    createdAt: NOW,
  };
}
