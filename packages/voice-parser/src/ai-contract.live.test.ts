import { afterAll, describe, expect, it } from "vitest";
import {
  parseAiShoppingResponse,
  SHOPPING_EXTRACTION_INSTRUCTIONS,
  SHOPPING_EXTRACTION_SCHEMA,
} from "./ai-contract.ts";
import type { ShoppingIntentDraft } from "./types.ts";

// Excluded from the default gate: requires a server key and bills API usage.
const enabled = process.env.RUN_LIVE_VOICE_AI_TESTS === "true";
const models = (process.env.OPENAI_EVAL_MODELS ?? "gpt-6-luna,gpt-5.6-luna")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const effort =
  process.env.OPENAI_EXTRACTION_REASONING === "low" ? "low" : "none";
const cases: readonly {
  text: string;
  expected: readonly Partial<ShoppingIntentDraft>[];
}[] = [
  {
    text: "dos litros de leche semidesnatada",
    expected: [
      {
        product: "leche",
        variant: "semidesnatada",
        requestedQuantity: 2,
        requestedUnit: "l",
        totalAmount: 2,
      },
    ],
  },
  {
    text: "tres botellas de agua de un litro y medio",
    expected: [
      {
        product: "agua",
        packageCount: 3,
        packageSize: 1.5,
        packageUnit: "l",
        packageType: "bottle",
        totalAmount: 4.5,
      },
    ],
  },
  {
    text: "dos packs de seis yogures Danone",
    expected: [
      {
        product: "yogur",
        brandPreference: "Danone",
        packageCount: 2,
        packageSize: 6,
        packageUnit: "unit",
        packageType: "pack",
        totalAmount: 12,
      },
    ],
  },
  {
    text: "dos litros de leche, no, tres litros",
    expected: [
      {
        product: "leche",
        requestedQuantity: 3,
        requestedUnit: "l",
        totalAmount: 3,
      },
    ],
  },
  {
    text: "dos briks de leche sin lactosa de marca Nueva de un litro",
    expected: [
      {
        product: "leche",
        variant: "sin lactosa",
        brandPreference: "Nueva",
        packageType: "carton",
        packageCount: 2,
        packageSize: 1,
        packageUnit: "l",
      },
    ],
  },
  {
    text: "medio kilo de arroz y pan",
    expected: [
      { product: "arroz", requestedQuantity: 0.5, requestedUnit: "kg" },
      { product: "pan" },
    ],
  },
  {
    text: "dos packs de seis latas de Coca-Cola de 33 centilitros",
    expected: [
      {
        brandPreference: "Coca-Cola",
        packageType: "can",
        packageCount: 12,
        packageSize: 33,
        packageUnit: "cl",
        totalAmount: 396,
      },
    ],
  },
  { text: "gracias, hasta mañana", expected: [] },
];
const timings = new Map<string, number[]>();

describe.skipIf(!enabled)("live shopping model comparison", () => {
  for (const model of models) {
    it.each(cases.map((fixture, index) => ({ ...fixture, index })))(
      `${model} case $index`,
      async ({ text, expected }) => {
        const key = process.env.OPENAI_API_KEY?.trim();
        if (!key)
          throw new Error(
            "Define OPENAI_API_KEY en el entorno del terminal; nunca en EXPO_PUBLIC_*.",
          );
        const startedAt = Date.now();
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({
            model,
            store: false,
            reasoning: { effort },
            max_output_tokens: 12000,
            instructions: SHOPPING_EXTRACTION_INSTRUCTIONS,
            input: [{ role: "user", content: text }],
            text: {
              format: {
                type: "json_schema",
                name: "shopping_intents",
                strict: true,
                schema: SHOPPING_EXTRACTION_SCHEMA,
              },
            },
          }),
        });
        if (!response.ok)
          throw new Error(
            `OpenAI respondió HTTP ${response.status} para ${model}`,
          );
        const payload: unknown = await response.json();
        if (
          !isRecord(payload) ||
          payload.status !== "completed" ||
          !Array.isArray(payload.output)
        )
          throw new Error("Respuesta incompleta");
        const content = payload.output
          .filter(isRecord)
          .filter((item) => item.type === "message")
          .flatMap((item) =>
            Array.isArray(item.content) ? item.content.filter(isRecord) : [],
          )
          .filter(
            (item) =>
              item.type === "output_text" && typeof item.text === "string",
          )
          .map((item) => String(item.text))
          .join("");
        const data: unknown = JSON.parse(content);
        const drafts = parseAiShoppingResponse(data, text);
        const elapsed = Date.now() - startedAt;
        timings.set(model, [...(timings.get(model) ?? []), elapsed]);
        console.info("voice-eval", {
          model,
          effort,
          milliseconds: elapsed,
          usage: payload.usage,
        });
        expect(drafts).toHaveLength(expected.length);
        expected.forEach((fields, index) =>
          expect(drafts[index]).toMatchObject(fields),
        );
      },
      60000,
    );
  }
  afterAll(() => {
    for (const [model, samples] of timings) {
      const sorted = [...samples].sort((a, b) => a - b);
      console.info("voice-eval-summary", {
        model,
        cases: samples.length,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        maxMs: sorted.at(-1),
      });
    }
  });
});
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
