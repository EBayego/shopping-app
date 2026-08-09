import type { Database } from "@shopping-app/database";

export type Group = Database["public"]["Tables"]["groups"]["Row"];
export type ShoppingList =
  Database["public"]["Tables"]["shopping_lists"]["Row"];
export type ShoppingIntent =
  Database["public"]["Tables"]["shopping_intents"]["Row"];
export type GroupMember = Database["public"]["Tables"]["group_members"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export interface GroupMemberWithProfile extends GroupMember {
  displayName: string | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface GroupDetail {
  group: Group;
  lists: readonly ShoppingList[];
  intents: readonly ShoppingIntent[];
  members: readonly GroupMemberWithProfile[];
}

export interface CreateGroupInput {
  groupName: string;
  listName: string;
  postalCode: string;
}

export interface CreateGroupResult {
  groupId: string;
  shoppingListId: string;
}

export interface JoinGroupResult {
  groupId: string;
  outcome: "joined" | "already-member";
}
