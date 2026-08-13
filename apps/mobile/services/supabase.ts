import type { Database } from "@shopping-app/database";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { secureStoreAdapter } from "./secure-store-adapter";

let client: SupabaseClient<Database> | undefined;

function readPublicConfiguration(): { url: string; key: string } {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "Faltan EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY. Revisa apps/mobile/.env.example.",
    );
  }

  return { url, key };
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const { url, key } = readPublicConfiguration();
  client = createClient<Database>(url, key, {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return client;
}
