import type { Session } from "@supabase/supabase-js";

interface SessionResult {
  data: { session: Session | null };
  error: Error | null;
}

export interface AnonymousAuthClient {
  getSession: () => Promise<SessionResult>;
  signInAnonymously: () => Promise<SessionResult>;
}

export interface EnsuredSession {
  session: Session;
  source: "restored" | "anonymous-created";
}

export async function ensureAnonymousSession(
  auth: AnonymousAuthClient,
): Promise<EnsuredSession> {
  const restored = await auth.getSession();
  if (restored.error) throw restored.error;
  if (restored.data.session) {
    return { session: restored.data.session, source: "restored" };
  }

  const anonymous = await auth.signInAnonymously();
  if (anonymous.error) throw anonymous.error;
  if (!anonymous.data.session) {
    throw new Error("Supabase no ha devuelto una sesión.");
  }
  return { session: anonymous.data.session, source: "anonymous-created" };
}
