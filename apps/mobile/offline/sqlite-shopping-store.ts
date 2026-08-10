import * as SQLite from "expo-sqlite";

import type { GroupDetail, ShoppingIntent } from "../features/groups/types";
import { applyOperationLocally, remapIntentId } from "./operations";
import type {
  LocalShoppingStore,
  LocalSyncStatus,
  PendingOperationRecord,
  ShoppingOperation,
} from "./types";

const DATABASE_NAME = "shopping-offline.db";

type Database = SQLite.SQLiteDatabase;
type JsonRow = { data: string };
type PendingRow = {
  sequence: number;
  payload: string;
  status: "pending" | "conflict";
  attempts: number;
  last_error: string | null;
};

export class SQLiteShoppingStore implements LocalShoppingStore {
  private databasePromise: Promise<Database> | null = null;

  async initialize(): Promise<void> {
    await this.database();
  }

  async getGroupDetail(groupId: string): Promise<GroupDetail | null> {
    return readGroupDetail(await this.database(), groupId);
  }

  async listCachedGroups() {
    const database = await this.database();
    const rows = await database.getAllAsync<JsonRow>(
      "select data from cached_groups order by created_at desc",
    );
    return rows.map(({ data }) => {
      const group = parseJson<GroupDetail["group"]>(data);
      return { id: group.id, name: group.name, createdAt: group.created_at };
    });
  }

  async replaceWithServerSnapshot(detail: GroupDetail): Promise<void> {
    const database = await this.database();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const pending = await transaction.getAllAsync<PendingRow>(
        "select sequence,payload,status,attempts,last_error from pending_operations where group_id = ? and status = 'pending' order by sequence",
        detail.group.id,
      );
      let projection = detail;
      for (const row of pending) {
        projection = applyOperationLocally(
          projection,
          parseJson<ShoppingOperation>(row.payload),
        );
      }
      await writeGroupDetail(transaction, projection);
      await setMetadata(
        transaction,
        "last_synced_at",
        new Date().toISOString(),
      );
      await setMetadata(transaction, "last_sync_error", "");
    });
  }

  async enqueue(operation: ShoppingOperation): Promise<void> {
    const database = await this.database();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = await transaction.getFirstAsync<{
        operation_id: string;
      }>(
        "select operation_id from pending_operations where operation_id = ?",
        operation.operationId,
      );
      if (existing) return;

      const detail = await readGroupDetail(transaction, operation.groupId);
      if (!detail) {
        throw new Error(
          "La lista debe haberse cargado antes de editarla sin conexión.",
        );
      }
      await writeGroupDetail(
        transaction,
        applyOperationLocally(detail, operation),
      );
      await transaction.runAsync(
        `insert into pending_operations
          (operation_id, group_id, kind, payload, status, attempts, created_at)
         values (?, ?, ?, ?, 'pending', 0, ?)`,
        operation.operationId,
        operation.groupId,
        operation.kind,
        JSON.stringify(operation),
        operation.createdAt,
      );
    });
  }

  async nextPending(): Promise<PendingOperationRecord | null> {
    const database = await this.database();
    const row = await database.getFirstAsync<PendingRow>(
      "select sequence,payload,status,attempts,last_error from pending_operations where status = 'pending' order by sequence limit 1",
    );
    return row ? mapPendingRow(row) : null;
  }

  async acknowledge(
    operation: ShoppingOperation,
    serverIntent?: ShoppingIntent,
  ): Promise<void> {
    const database = await this.database();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      if (operation.kind === "add_intent" && serverIntent) {
        const localId = operation.localIntent.id;
        const localRow = await transaction.getFirstAsync<JsonRow>(
          "select data from cached_shopping_intents where id = ?",
          localId,
        );
        const projected = localRow
          ? { ...parseJson<ShoppingIntent>(localRow.data), id: serverIntent.id }
          : serverIntent;
        await transaction.runAsync(
          "delete from cached_shopping_intents where id = ?",
          localId,
        );
        await transaction.runAsync(
          "insert or replace into cached_shopping_intents (id, shopping_list_id, data) values (?, ?, ?)",
          serverIntent.id,
          serverIntent.shopping_list_id,
          JSON.stringify(projected),
        );

        const laterRows = await transaction.getAllAsync<{
          operation_id: string;
          payload: string;
        }>(
          "select operation_id,payload from pending_operations where sequence > (select sequence from pending_operations where operation_id = ?)",
          operation.operationId,
        );
        for (const row of laterRows) {
          const remapped = remapIntentId(
            parseJson<ShoppingOperation>(row.payload),
            localId,
            serverIntent.id,
          );
          await transaction.runAsync(
            "update pending_operations set payload = ? where operation_id = ?",
            JSON.stringify(remapped),
            row.operation_id,
          );
        }
      }
      await transaction.runAsync(
        "delete from pending_operations where operation_id = ?",
        operation.operationId,
      );
    });
  }

  async markConflict(operationId: string, error: string): Promise<void> {
    const database = await this.database();
    await database.runAsync(
      "update pending_operations set status = 'conflict', attempts = attempts + 1, last_error = ? where operation_id = ?",
      error,
      operationId,
    );
    await setMetadata(database, "last_sync_error", error);
  }

  async recordSyncError(error: string): Promise<void> {
    const database = await this.database();
    await database.runAsync(
      "update pending_operations set attempts = attempts + 1, last_error = ? where operation_id = (select operation_id from pending_operations where status = 'pending' order by sequence limit 1)",
      error,
    );
    await setMetadata(database, "last_sync_error", error);
  }

  async getSyncStatus(): Promise<LocalSyncStatus> {
    const database = await this.database();
    const counts = await database.getFirstAsync<{
      pending_count: number;
      conflict_count: number;
    }>(
      `select
        sum(case when status = 'pending' then 1 else 0 end) as pending_count,
        sum(case when status = 'conflict' then 1 else 0 end) as conflict_count
       from pending_operations`,
    );
    const metadata = await database.getAllAsync<{ key: string; value: string }>(
      "select key,value from sync_metadata where key in ('last_sync_error', 'last_synced_at')",
    );
    const values = new Map(metadata.map((row) => [row.key, row.value]));
    return {
      pendingCount: counts?.pending_count ?? 0,
      conflictCount: counts?.conflict_count ?? 0,
      lastError: values.get("last_sync_error") || null,
      lastSyncedAt: values.get("last_synced_at") || null,
    };
  }

  private database(): Promise<Database> {
    this.databasePromise ??= openDatabase();
    return this.databasePromise;
  }
}

async function openDatabase(): Promise<Database> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(`
    pragma journal_mode = WAL;
    pragma foreign_keys = ON;
    create table if not exists cached_groups (
      id text primary key not null,
      data text not null,
      created_at text not null,
      cached_at text not null
    );
    create table if not exists cached_lists (
      id text primary key not null,
      group_id text not null,
      data text not null,
      foreign key (group_id) references cached_groups(id) on delete cascade
    );
    create index if not exists cached_lists_group_idx on cached_lists(group_id);
    create table if not exists cached_shopping_intents (
      id text primary key not null,
      shopping_list_id text not null,
      data text not null,
      foreign key (shopping_list_id) references cached_lists(id) on delete cascade
    );
    create index if not exists cached_intents_list_idx on cached_shopping_intents(shopping_list_id);
    create table if not exists cached_group_members (
      group_id text not null,
      profile_id text not null,
      data text not null,
      primary key (group_id, profile_id),
      foreign key (group_id) references cached_groups(id) on delete cascade
    );
    create table if not exists pending_operations (
      sequence integer primary key autoincrement,
      operation_id text unique not null,
      group_id text not null,
      kind text not null,
      payload text not null,
      status text not null check (status in ('pending', 'conflict')),
      attempts integer not null default 0,
      last_error text,
      created_at text not null
    );
    create index if not exists pending_operations_replay_idx
      on pending_operations(status, sequence);
    create table if not exists sync_metadata (
      key text primary key not null,
      value text not null
    );
    pragma user_version = 1;
  `);
  return database;
}

async function readGroupDetail(
  database: Database,
  groupId: string,
): Promise<GroupDetail | null> {
  const groupRow = await database.getFirstAsync<JsonRow>(
    "select data from cached_groups where id = ?",
    groupId,
  );
  if (!groupRow) return null;
  const listRows = await database.getAllAsync<JsonRow>(
    "select data from cached_lists where group_id = ? order by rowid",
    groupId,
  );
  const memberRows = await database.getAllAsync<JsonRow>(
    "select data from cached_group_members where group_id = ? order by rowid",
    groupId,
  );
  const listIds = listRows.map(
    ({ data }) => parseJson<GroupDetail["lists"][number]>(data).id,
  );
  const intents: ShoppingIntent[] = [];
  for (const listId of listIds) {
    const rows = await database.getAllAsync<JsonRow>(
      "select data from cached_shopping_intents where shopping_list_id = ? order by rowid",
      listId,
    );
    intents.push(...rows.map(({ data }) => parseJson<ShoppingIntent>(data)));
  }
  return {
    group: parseJson<GroupDetail["group"]>(groupRow.data),
    lists: listRows.map(({ data }) =>
      parseJson<GroupDetail["lists"][number]>(data),
    ),
    intents,
    members: memberRows.map(({ data }) =>
      parseJson<GroupDetail["members"][number]>(data),
    ),
  };
}

async function writeGroupDetail(database: Database, detail: GroupDetail) {
  await database.runAsync(
    "insert or replace into cached_groups (id,data,created_at,cached_at) values (?, ?, ?, ?)",
    detail.group.id,
    JSON.stringify(detail.group),
    detail.group.created_at,
    new Date().toISOString(),
  );
  await database.runAsync(
    `delete from cached_shopping_intents
     where shopping_list_id in (
       select id from cached_lists where group_id = ?
     )`,
    detail.group.id,
  );
  await database.runAsync(
    "delete from cached_lists where group_id = ?",
    detail.group.id,
  );
  await database.runAsync(
    "delete from cached_group_members where group_id = ?",
    detail.group.id,
  );
  for (const list of detail.lists) {
    await database.runAsync(
      "insert into cached_lists (id,group_id,data) values (?, ?, ?)",
      list.id,
      detail.group.id,
      JSON.stringify(list),
    );
  }
  for (const intent of detail.intents) {
    await database.runAsync(
      "insert into cached_shopping_intents (id,shopping_list_id,data) values (?, ?, ?)",
      intent.id,
      intent.shopping_list_id,
      JSON.stringify(intent),
    );
  }
  for (const member of detail.members) {
    await database.runAsync(
      "insert into cached_group_members (group_id,profile_id,data) values (?, ?, ?)",
      detail.group.id,
      member.profile_id,
      JSON.stringify(member),
    );
  }
}

async function setMetadata(database: Database, key: string, value: string) {
  await database.runAsync(
    "insert into sync_metadata (key,value) values (?, ?) on conflict(key) do update set value = excluded.value",
    key,
    value,
  );
}

function mapPendingRow(row: PendingRow): PendingOperationRecord {
  return {
    sequence: row.sequence,
    operation: parseJson<ShoppingOperation>(row.payload),
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export const sqliteShoppingStore = new SQLiteShoppingStore();
