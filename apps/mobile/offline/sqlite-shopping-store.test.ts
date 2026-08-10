import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDetail, ShoppingIntent } from "../features/groups/types";

const { database, intentIds } = vi.hoisted(() => {
  const ids = new Set<string>();
  const fakeDatabase = {
    execAsync: vi.fn(() => Promise.resolve()),
    getAllAsync: vi.fn(() => Promise.resolve([])),
    runAsync: vi.fn((sql: string, ...parameters: unknown[]) => {
      if (sql.startsWith("delete from cached_shopping_intents")) {
        ids.clear();
      }
      if (sql.startsWith("insert into cached_shopping_intents")) {
        const id = parameters[0];
        if (typeof id !== "string") {
          throw new Error("Expected a string intent id");
        }
        if (ids.has(id)) {
          throw new Error("UNIQUE constraint failed: cached_shopping_intents.id");
        }
        ids.add(id);
      }
      return Promise.resolve();
    }),
    withExclusiveTransactionAsync: vi.fn(
      (callback: (transaction: typeof fakeDatabase) => Promise<void>) =>
        callback(fakeDatabase),
    ),
  };
  return { database: fakeDatabase, intentIds: ids };
});

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(() => Promise.resolve(database)),
}));

import { SQLiteShoppingStore } from "./sqlite-shopping-store";

describe("SQLiteShoppingStore", () => {
  beforeEach(() => {
    intentIds.clear();
    vi.clearAllMocks();
  });

  it("can rewrite a cached group when an existing intent changes", async () => {
    const store = new SQLiteShoppingStore();
    const initial = detailFixture();

    await store.replaceWithServerSnapshot(initial);
    await expect(
      store.replaceWithServerSnapshot({
        ...initial,
        intents: [{ ...initial.intents[0]!, requested_quantity: 2 }],
      }),
    ).resolves.toBeUndefined();

    expect(intentIds).toEqual(new Set(["intent-1"]));
    expect(database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("delete from cached_shopping_intents"),
      "group-1",
    );
  });
});

const NOW = "2026-08-10T12:00:00.000Z";

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
    intents: [intentFixture()],
    members: [],
  };
}

function intentFixture(): ShoppingIntent {
  return {
    id: "intent-1",
    shopping_list_id: "list-1",
    raw_text: "Leche 1L",
    normalized_name: "leche",
    requested_quantity: 1,
    requested_unit: "l",
    package_count: null,
    package_size: null,
    package_unit: null,
    total_amount: 1,
    brand_preference: null,
    variant: null,
    canonical_product_id: null,
    checked: false,
    created_by: "user-1",
    created_at: NOW,
    updated_at: NOW,
  };
}
