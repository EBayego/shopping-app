import { SpeechRecognitionError } from "../features/voice/speech-recognition-service";
import { getSupabaseClient } from "./supabase";

export async function invokeVoiceFunction(
  name: "extract-shopping-intents",
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted)
    throw new SpeechRecognitionError("CANCELLED", "Petición AI cancelada.");
  const result: unknown = await getSupabaseClient().functions.invoke<unknown>(
    name,
    {
      body,
      signal,
      timeout: 60_000,
    },
  );
  if (signal.aborted)
    throw new SpeechRecognitionError("CANCELLED", "Petición AI cancelada.");
  if (!isRecord(result))
    throw new Error("AI devolvió una respuesta no válida.");
  if (result.error) {
    const error: unknown = result.error;
    if (isRecord(error) && error.context instanceof Response) {
      const payload: unknown = await error.context.json().catch(() => null);
      if (isRecord(payload) && typeof payload.error === "string")
        throw new Error(payload.error);
    }
    throw error instanceof Error
      ? error
      : new Error("No se pudo conectar con AI.");
  }
  return result.data;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
