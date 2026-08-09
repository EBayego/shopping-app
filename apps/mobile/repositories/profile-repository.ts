import type { Database } from "@shopping-app/database";

import { getSupabaseClient } from "../services/supabase";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export async function getOwnProfile(userId: string): Promise<Profile> {
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateDisplayName(
  userId: string,
  displayName: string,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("profiles")
    .update({ display_name: displayName.trim() || null })
    .eq("id", userId);
  if (error) throw error;
}
