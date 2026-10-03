import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtractionHandler } from "./extract-shopping-intents/handler.ts";
import {
  openAiJson,
  readBoundedBody,
  VoiceHttpError,
  type VoiceDependencies,
} from "./_shared/voice-http.ts";

const transcript = "dos botellas de agua de un litro y medio";
const extraction = {
  items: [
    {
      rawText: transcript,
      product: "agua",
      variant: null,
      brandPreference: null,
      requestedQuantity: null,
      requestedUnit: null,
      packageCount: 2,
      packageSize: 1.5,
      packageUnit: "l",
      packageType: "bottle",
      needsReview: false,
      reviewReason: null,
    },
  ],
};
function dependencies(payload: unknown): VoiceDependencies {
  return {
    env: (key) => (key === "OPENAI_API_KEY" ? "test-key" : undefined),
    authorize: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)),
  };
}
function jsonRequest(body: unknown = { transcript }): Request {
  return new Request("https://test/extract", {
    method: "POST",
    headers: {
      Authorization: "Bearer session-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
function completed(value: unknown = extraction): unknown {
  return {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenAI text extraction HTTP handler", () => {
  it("extracts from the whole transcript with a strict schema, no storage and no tools", async () => {
    const deps = dependencies(completed());
    const response = await createExtractionHandler(deps)(jsonRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ...extraction,
      model: "gpt-6-luna",
      promptVersion: "shopping-extraction-v1",
    });
    const body: unknown = JSON.parse(
      String(vi.mocked(deps.fetch).mock.calls[0]?.[1]?.body),
    );
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      reasoning: { effort: "none" },
      input: [{ role: "user", content: transcript }],
      text: {
        format: {
          type: "json_schema",
          strict: true,
          schema: { additionalProperties: false },
        },
      },
    });
    expect(body).not.toHaveProperty("tools");
    expect(deps.authorize).toHaveBeenCalledWith(expect.any(Request));
    expect(vi.mocked(deps.fetch).mock.calls[0]?.[0]).toBe(
      "https://api.openai.com/v1/responses",
    );
  });
  it("does not call OpenAI without a user, key or available quota", async () => {
    const deps = dependencies(completed());
    const handler = createExtractionHandler(deps);
    expect(
      (await handler(new Request("https://test", { method: "POST" }))).status,
    ).toBe(401);
    deps.env = () => undefined;
    expect((await handler(jsonRequest())).status).toBe(503);
    deps.env = () => "test-key";
    deps.authorize = vi
      .fn()
      .mockRejectedValue(new VoiceHttpError(429, "quota"));
    expect((await handler(jsonRequest())).status).toBe(429);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("rejects audio instead of sending it to OpenAI", async () => {
    const deps = dependencies(completed());
    const response = await createExtractionHandler(deps)(
      new Request("https://test/extract", {
        method: "POST",
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "audio/mp4",
        },
        body: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(response.status).toBe(415);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("handles preflight and rejects methods without reserving quota", async () => {
    const deps = dependencies({});
    const handler = createExtractionHandler(deps);
    const response = await handler(
      new Request("https://test", { method: "OPTIONS" }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "authorization",
    );
    expect((await handler(new Request("https://test"))).status).toBe(405);
    expect(deps.authorize).not.toHaveBeenCalled();
  });
  it.each([
    { transcript: "" },
    { transcript: "a".repeat(8001) },
    { transcript: 42 },
  ])("rejects invalid transcripts before contacting OpenAI", async (body) => {
    const deps = dependencies(completed());
    expect(
      (await createExtractionHandler(deps)(jsonRequest(body))).status,
    ).toBe(400);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "no" }] },
      ],
    },
    completed({ items: [{ product: "invalid" }] }),
  ])(
    "rejects incomplete, refused and invalid interpretations",
    async (payload) => {
      const response = await createExtractionHandler(dependencies(payload))(
        jsonRequest(),
      );
      expect([422, 502]).toContain(response.status);
    },
  );
  it("does not expose upstream payloads or keys in errors", async () => {
    const deps = dependencies({});
    deps.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: "secret-key and private transcript" },
          { status: 400 },
        ),
      );
    const response = await createExtractionHandler(deps)(jsonRequest());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private transcript");
  });
  it("bounds streamed bodies even without content-length", async () => {
    const request = new Request("https://test", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    await expect(readBoundedBody(request, 2)).rejects.toMatchObject({
      status: 413,
    });
  });
  it("aborts an upstream timeout rather than hanging", async () => {
    vi.useFakeTimers();
    const deps = dependencies({});
    deps.fetch = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const result = openAiJson(deps, "https://test", {});
    const assertion = expect(result).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(45000);
    await assertion;
  });
});
