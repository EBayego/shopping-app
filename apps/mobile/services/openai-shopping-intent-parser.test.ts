import { describe, expect, it, vi } from "vitest";
import { openAiShoppingIntentParser } from "./openai-shopping-intent-parser";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({ functions: { invoke: mocks.invoke } }),
}));

describe("OpenAI shopping parser", () => {
  it("sends only the complete text and validates before adapting the response", async () => {
    const transcript = "dos briks de leche de un litro";
    mocks.invoke.mockResolvedValue({
      error: null,
      data: {
        model: "gpt-6-luna",
        promptVersion: "v1",
        items: [
          {
            rawText: transcript,
            product: "leche",
            variant: null,
            brandPreference: null,
            requestedQuantity: null,
            requestedUnit: null,
            packageCount: 2,
            packageSize: 1,
            packageUnit: "l",
            packageType: "carton",
            needsReview: false,
            reviewReason: null,
          },
        ],
      },
    });
    const controller = new AbortController();
    await expect(
      openAiShoppingIntentParser.parse(transcript, controller.signal),
    ).resolves.toMatchObject([
      { packageType: "carton", totalAmount: 2, source: "AI" },
    ]);
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "extract-shopping-intents",
      expect.objectContaining({
        body: { transcript },
        signal: controller.signal,
        timeout: 60000,
      }),
    );
  });
  it("rejects invalid data, cancelled calls and oversize transcripts", async () => {
    mocks.invoke.mockResolvedValue({
      error: null,
      data: { items: [{ product: "wrong" }] },
    });
    await expect(
      openAiShoppingIntentParser.parse("pan", new AbortController().signal),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      openAiShoppingIntentParser.parse("pan", controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      openAiShoppingIntentParser.parse(
        "a".repeat(8001),
        new AbortController().signal,
      ),
    ).rejects.toThrow("más corta");
  });
  it("shows the sanitized server error rather than a generic HTTP message", async () => {
    const error = Object.assign(new Error("HTTP error"), {
      context: Response.json(
        { error: "Has alcanzado el límite temporal de AI." },
        { status: 429 },
      ),
    });
    mocks.invoke.mockResolvedValue({ error, data: null });
    await expect(
      openAiShoppingIntentParser.parse("pan", new AbortController().signal),
    ).rejects.toThrow("límite temporal");
  });
});
