import {
  MAX_AI_TRANSCRIPT_LENGTH,
  parseAiShoppingResponse,
} from "@shopping-app/voice-parser";
import type { ShoppingIntentParser } from "../features/voice/shopping-intent-parser";
import { invokeVoiceFunction, isRecord } from "./voice-ai-request";

export const openAiShoppingIntentParser: ShoppingIntentParser = {
  async parse(transcript, signal) {
    if (!transcript.trim() || transcript.length > MAX_AI_TRANSCRIPT_LENGTH)
      throw new Error(
        `La transcripción debe tener entre 1 y ${MAX_AI_TRANSCRIPT_LENGTH} caracteres. Prueba una lista más corta.`,
      );
    const result = await invokeVoiceFunction(
      "extract-shopping-intents",
      { transcript },
      signal,
    );
    if (!isRecord(result))
      throw new Error("La interpretación de AI no es válida.");
    return parseAiShoppingResponse({ items: result.items }, transcript);
  },
};
