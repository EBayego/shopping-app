import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import { VoiceHttpError, type VoiceDependencies } from "./voice-http.ts";

export const voiceDependencies: VoiceDependencies = {
  env: (name) => Deno.env.get(name),
  fetch: globalThis.fetch,
  async authorize(request) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key)
      throw new VoiceHttpError(503, "El servicio AI no está configurado.");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
      },
    });
    const token = request.headers
      .get("authorization")
      ?.replace(/^Bearer /i, "");
    if (!token)
      throw new VoiceHttpError(401, "Inicia sesión para utilizar AI.");
    const { data, error } = await client.auth.getUser(token);
    // SessionProvider/ensureAnonymousSession creates authenticated anonymous sessions.
    // Preserve that existing access model: getUser validates their JWT too, and the
    // service-only atomic quota below applies per user AND globally to paid calls.
    if (error || !data.user)
      throw new VoiceHttpError(401, "Inicia sesión para utilizar AI.");
    const quota = await client.rpc("consume_voice_ai_quota", {
      actor_id: data.user.id,
      operation: "extract",
    });
    if (quota.error)
      throw new VoiceHttpError(
        503,
        "No se pudo comprobar el límite de AI. Revisa las migraciones del servidor.",
      );
    if (quota.data !== true)
      throw new VoiceHttpError(
        429,
        "Has alcanzado el límite temporal de AI. Puedes usar el modo local o intentarlo más tarde.",
      );
  },
};
