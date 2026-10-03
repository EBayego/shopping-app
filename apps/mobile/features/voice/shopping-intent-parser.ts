import type { ShoppingIntentDraft } from "@shopping-app/voice-parser";

export interface ShoppingIntentParser {
  parse(
    transcript: string,
    signal: AbortSignal,
  ): Promise<readonly ShoppingIntentDraft[]>;
}
