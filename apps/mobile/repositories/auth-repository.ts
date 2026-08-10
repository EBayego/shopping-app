import {
  ensureAnonymousSession,
  type EnsuredSession,
} from "../features/auth/anonymous-session";
import { getSupabaseClient } from "../services/supabase";

export type IdentityLinkMethod = "google" | "apple" | "email";

export async function restoreOrCreateAnonymousSession(): Promise<EnsuredSession> {
  return ensureAnonymousSession(getSupabaseClient().auth);
}

export async function signOutLocalSession(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut({ scope: "local" });
  if (error) throw error;
}

// Google, Apple y email se conectarán aquí mediante linkIdentity/unlinkIdentity
// de Supabase Auth. La sesión anónima actual seguirá siendo la identidad base.
export const futureIdentityLinkMethods: readonly IdentityLinkMethod[] = [
  "google",
  "apple",
  "email",
];
