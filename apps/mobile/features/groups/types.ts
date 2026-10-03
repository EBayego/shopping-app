import type { Database } from "@shopping-app/database";
import type { ShoppingPackageType } from "@shopping-app/voice-parser";

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

export interface AddShoppingIntentInput {
  rawText: string;
  normalizedName: string;
  requestedQuantity?: number;
  requestedUnit?: string;
  packageCount?: number;
  packageSize?: number;
  packageUnit?: string;
  packageType?: ShoppingPackageType;
  totalAmount?: number;
  brandPreference?: string;
  variant?: string;
}

export interface EditShoppingIntentInput {
  rawText: string;
  normalizedName: string;
  requestedQuantity: number;
  requestedUnit: string | null;
  packageCount: number | null;
  packageSize: number | null;
  packageUnit: string | null;
  packageType?: ShoppingPackageType | null;
  totalAmount: number | null;
  brandPreference: string | null;
  variant: string | null;
}
