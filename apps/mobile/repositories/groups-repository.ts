import { getSupabaseClient } from "../services/supabase";
import type {
  CreateGroupInput,
  CreateGroupResult,
  EditShoppingIntentInput,
  GroupDetail,
  GroupSummary,
  JoinGroupResult,
  ShoppingIntent,
} from "../features/groups/types";
import type { ShoppingOperation, ShoppingSyncBackend } from "../offline/types";

export async function listGroups(): Promise<readonly GroupSummary[]> {
  const { data, error } = await getSupabaseClient()
    .from("groups")
    .select("id,name,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((group) => ({
    id: group.id,
    name: group.name,
    createdAt: group.created_at,
  }));
}

export async function getGroupDetail(groupId: string): Promise<GroupDetail> {
  const supabase = getSupabaseClient();
  const [groupResult, listsResult, membersResult] = await Promise.all([
    supabase.from("groups").select("*").eq("id", groupId).single(),
    supabase
      .from("shopping_lists")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at"),
    supabase
      .from("group_members")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at"),
  ]);
  if (groupResult.error) throw groupResult.error;
  if (listsResult.error) throw listsResult.error;
  if (membersResult.error) throw membersResult.error;

  const listIds = listsResult.data.map((list) => list.id);
  let intents: readonly ShoppingIntent[] = [];
  if (listIds.length > 0) {
    const intentsResult = await supabase
      .from("shopping_intents")
      .select("*")
      .in("shopping_list_id", listIds)
      .order("created_at");
    if (intentsResult.error) throw intentsResult.error;
    intents = intentsResult.data;
  }

  const profileIds = membersResult.data.map((member) => member.profile_id);
  const profilesResult = await supabase
    .from("profiles")
    .select("id,display_name")
    .in("id", profileIds);
  if (profilesResult.error) throw profilesResult.error;
  const profileNames = new Map(
    profilesResult.data.map((profile) => [profile.id, profile.display_name]),
  );

  return {
    group: groupResult.data,
    lists: listsResult.data,
    intents,
    members: membersResult.data.map((member) => ({
      ...member,
      displayName: profileNames.get(member.profile_id) ?? null,
    })),
  };
}

export async function createGroup(
  input: CreateGroupInput,
): Promise<CreateGroupResult> {
  const { data, error } = await getSupabaseClient().rpc(
    "create_group_with_initial_list",
    {
      group_name: input.groupName.trim(),
      list_name: input.listName.trim(),
      postal_code: input.postalCode.trim(),
    },
  );
  if (error) throw error;
  const created = data[0];
  if (!created) throw new Error("No se ha podido recuperar el grupo creado.");
  return {
    groupId: created.group_id,
    shoppingListId: created.shopping_list_id,
  };
}

export async function joinGroup(inviteCode: string): Promise<JoinGroupResult> {
  const supabase = getSupabaseClient();
  const groupsBefore = await supabase.from("groups").select("id");
  if (groupsBefore.error) throw groupsBefore.error;
  const knownGroupIds = new Set(groupsBefore.data.map((group) => group.id));

  const { data, error } = await supabase.rpc("join_group_by_invite", {
    invite_code: inviteCode.trim(),
  });
  if (error) throw error;
  return {
    groupId: data,
    outcome: knownGroupIds.has(data) ? "already-member" : "joined",
  };
}

export async function generateGroupInvite(groupId: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc(
    "generate_group_invite",
    {
      target_group_id: groupId,
      expires_in: "7 days",
      allowed_uses: 100,
    },
  );
  if (error) throw error;
  return data;
}

export async function addShoppingIntent(
  shoppingListId: string,
  input: {
    rawText: string;
    normalizedName: string;
    productConceptId?: string | null;
    requestedQuantity?: number;
    requestedUnit?: string;
    packageCount?: number;
    packageSize?: number;
    packageUnit?: string;
    totalAmount?: number;
    brandPreference?: string;
    variant?: string;
  },
  operationId: string,
): Promise<ShoppingIntent> {
  const { data, error } = await getSupabaseClient().rpc(
    "add_shopping_product_operation",
    {
      operation_id: operationId,
      shopping_list_id: shoppingListId,
      raw_text: input.rawText,
      normalized_name: input.normalizedName,
      ...(input.productConceptId == null
        ? {}
        : { product_concept_id: input.productConceptId }),
      ...(input.requestedQuantity === undefined
        ? {}
        : { requested_quantity: input.requestedQuantity }),
      ...(input.requestedUnit === undefined
        ? {}
        : { requested_unit: input.requestedUnit }),
      ...(input.packageCount === undefined
        ? {}
        : { package_count: input.packageCount }),
      ...(input.packageSize === undefined
        ? {}
        : { package_size: input.packageSize }),
      ...(input.packageUnit === undefined
        ? {}
        : { package_unit: input.packageUnit }),
      ...(input.totalAmount === undefined
        ? {}
        : { total_amount: input.totalAmount }),
      ...(input.brandPreference === undefined
        ? {}
        : { brand_preference: input.brandPreference }),
      ...(input.variant === undefined ? {} : { variant: input.variant }),
    },
  );
  if (error) throw error;
  return data as unknown as ShoppingIntent;
}

type IntentOperation =
  | {
      action: "add";
      operationId: string;
      shoppingListId: string;
      rawText: string;
      normalizedName: string;
    }
  | {
      action: "set_checked";
      operationId: string;
      intentId: string;
      checked: boolean;
    }
  | {
      action: "increment" | "decrement" | "delete";
      operationId: string;
      intentId: string;
    };

async function applyIntentOperation(
  operation: IntentOperation,
): Promise<ShoppingIntent> {
  const { data, error } = await getSupabaseClient().rpc(
    "apply_shopping_intent_operation",
    {
      operation_id: operation.operationId,
      action: operation.action,
      ...(operation.action === "add"
        ? { shopping_list_id: operation.shoppingListId }
        : { intent_id: operation.intentId }),
      ...(operation.action === "add"
        ? {
            raw_text: operation.rawText,
            normalized_name: operation.normalizedName,
          }
        : {}),
      ...(operation.action === "set_checked"
        ? { checked: operation.checked }
        : {}),
    },
  );
  if (error) throw error;
  return data as unknown as ShoppingIntent;
}

export async function setShoppingIntentChecked(
  intentId: string,
  checked: boolean,
  operationId: string,
): Promise<ShoppingIntent> {
  return applyIntentOperation({
    action: "set_checked",
    operationId,
    intentId,
    checked,
  });
}

export async function editShoppingIntent(
  intentId: string,
  input: EditShoppingIntentInput,
  operationId: string,
): Promise<ShoppingIntent> {
  const { data, error } = await getSupabaseClient().rpc(
    "edit_shopping_product_operation",
    {
      operation_id: operationId,
      intent_id: intentId,
      raw_text: input.rawText,
      normalized_name: input.normalizedName,
      requested_quantity: input.requestedQuantity,
      ...(input.requestedUnit === null
        ? {}
        : { requested_unit: input.requestedUnit }),
      ...(input.packageCount === null
        ? {}
        : { package_count: input.packageCount }),
      ...(input.packageSize === null
        ? {}
        : { package_size: input.packageSize }),
      ...(input.packageUnit === null
        ? {}
        : { package_unit: input.packageUnit }),
      ...(input.totalAmount === null
        ? {}
        : { total_amount: input.totalAmount }),
      ...(input.brandPreference === null
        ? {}
        : { brand_preference: input.brandPreference }),
      ...(input.variant === null ? {} : { variant: input.variant }),
    },
  );
  if (error) throw error;
  return data as unknown as ShoppingIntent;
}

export async function changeShoppingIntentQuantity(
  intentId: string,
  direction: "increment" | "decrement",
  operationId: string,
): Promise<ShoppingIntent> {
  return applyIntentOperation({ action: direction, operationId, intentId });
}

export async function deleteShoppingIntent(
  intentId: string,
  operationId: string,
): Promise<ShoppingIntent> {
  return applyIntentOperation({ action: "delete", operationId, intentId });
}

export async function updateShoppingListPostalCode(
  shoppingListId: string,
  postalCode: string,
  operationId: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc(
    "apply_shopping_list_operation",
    {
      operation_id: operationId,
      shopping_list_id: shoppingListId,
      postal_code: postalCode.trim(),
    },
  );
  if (error) throw error;
}

export const shoppingSyncBackend: ShoppingSyncBackend = {
  apply(operation: ShoppingOperation) {
    switch (operation.kind) {
      case "add_intent":
        return addShoppingIntent(
          operation.shoppingListId,
          {
            rawText: operation.localIntent.raw_text,
            normalizedName: operation.localIntent.normalized_name,
            productConceptId: operation.localIntent.product_concept_id,
            ...(operation.localIntent.requested_quantity === null
              ? {}
              : {
                  requestedQuantity: operation.localIntent.requested_quantity,
                }),
            ...(operation.localIntent.requested_unit === null
              ? {}
              : { requestedUnit: operation.localIntent.requested_unit }),
            ...(operation.localIntent.package_count === null
              ? {}
              : { packageCount: operation.localIntent.package_count }),
            ...(operation.localIntent.package_size === null
              ? {}
              : { packageSize: operation.localIntent.package_size }),
            ...(operation.localIntent.package_unit === null
              ? {}
              : { packageUnit: operation.localIntent.package_unit }),
            ...(operation.localIntent.total_amount === null
              ? {}
              : { totalAmount: operation.localIntent.total_amount }),
            ...(operation.localIntent.brand_preference === null
              ? {}
              : {
                  brandPreference: operation.localIntent.brand_preference,
                }),
            ...(operation.localIntent.variant === null
              ? {}
              : { variant: operation.localIntent.variant }),
          },
          operation.operationId,
        );
      case "edit_intent":
        return editShoppingIntent(
          operation.intentId,
          operation.input,
          operation.operationId,
        );
      case "set_checked":
        return setShoppingIntentChecked(
          operation.intentId,
          operation.checked,
          operation.operationId,
        );
      case "change_quantity":
        return changeShoppingIntentQuantity(
          operation.intentId,
          operation.direction,
          operation.operationId,
        );
      case "delete_intent":
        return deleteShoppingIntent(operation.intentId, operation.operationId);
      case "update_postal_code":
        return updateShoppingListPostalCode(
          operation.shoppingListId,
          operation.postalCode,
          operation.operationId,
        ).then(() => undefined);
    }
  },
  getGroupDetail,
};
