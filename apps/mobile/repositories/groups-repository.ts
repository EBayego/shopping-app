import { getSupabaseClient } from "../services/supabase";
import type {
  CreateGroupInput,
  CreateGroupResult,
  GroupDetail,
  GroupSummary,
  JoinGroupResult,
  ShoppingIntent,
} from "../features/groups/types";

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
      allowed_uses: 1,
    },
  );
  if (error) throw error;
  return data;
}

export async function addShoppingIntent(
  shoppingListId: string,
  input: { rawText: string; normalizedName: string },
): Promise<void> {
  const { error } = await getSupabaseClient().from("shopping_intents").insert({
    shopping_list_id: shoppingListId,
    raw_text: input.rawText,
    normalized_name: input.normalizedName,
  });
  if (error) throw error;
}

export async function setShoppingIntentChecked(
  intentId: string,
  checked: boolean,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("shopping_intents")
    .update({ checked })
    .eq("id", intentId);
  if (error) throw error;
}

export async function updateShoppingListPostalCode(
  shoppingListId: string,
  postalCode: string,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("shopping_lists")
    .update({ postal_code: postalCode.trim() })
    .eq("id", shoppingListId);
  if (error) throw error;
}
