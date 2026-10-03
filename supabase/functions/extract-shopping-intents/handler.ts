import {
  MAX_AI_TRANSCRIPT_LENGTH,
  parseAiShoppingResponse,
  SHOPPING_EXTRACTION_INSTRUCTIONS,
  SHOPPING_EXTRACTION_PROMPT_VERSION,
  SHOPPING_EXTRACTION_SCHEMA,
} from "../../../packages/voice-parser/src/ai-contract.ts";
import {
  isRecord,
  openAiJson,
  readBoundedBody,
  voiceHandler,
  VoiceHttpError,
  type VoiceDependencies,
} from "../_shared/voice-http.ts";

export function createExtractionHandler(
  deps: VoiceDependencies,
): (request: Request) => Promise<Response> {
  return voiceHandler(deps, async (request, apiKey) => {
    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      throw new VoiceHttpError(415, "Se esperaba una transcripción en JSON.");
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder().decode(await readBoundedBody(request, 64_000)),
      );
    } catch (error) {
      if (error instanceof VoiceHttpError) throw error;
      throw new VoiceHttpError(400, "El JSON de entrada no es válido.");
    }
    if (
      !isRecord(input) ||
      typeof input.transcript !== "string" ||
      !input.transcript.trim() ||
      input.transcript.length > MAX_AI_TRANSCRIPT_LENGTH
    )
      throw new VoiceHttpError(
        400,
        `La transcripción debe tener entre 1 y ${MAX_AI_TRANSCRIPT_LENGTH} caracteres.`,
      );
    const model = deps.env("OPENAI_EXTRACTION_MODEL")?.trim() || "gpt-6-luna";
    const effort = deps.env("OPENAI_EXTRACTION_REASONING")?.trim() || "none";
    if (effort !== "none" && effort !== "low")
      throw new VoiceHttpError(
        503,
        "El nivel de razonamiento AI no es compatible.",
      );
    const payload = await openAiJson(
      deps,
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort },
          max_output_tokens: 12000,
          instructions: SHOPPING_EXTRACTION_INSTRUCTIONS,
          input: [{ role: "user", content: input.transcript }],
          text: {
            format: {
              type: "json_schema",
              name: "shopping_intents",
              strict: true,
              schema: SHOPPING_EXTRACTION_SCHEMA,
            },
          },
        }),
      },
    );
    if (
      !isRecord(payload) ||
      payload.status !== "completed" ||
      !Array.isArray(payload.output)
    )
      throw new VoiceHttpError(
        502,
        "La interpretación de AI quedó incompleta. Puedes reintentar.",
      );
    const texts: string[] = [];
    for (const output of payload.output) {
      if (
        !isRecord(output) ||
        output.type !== "message" ||
        !Array.isArray(output.content)
      )
        continue;
      for (const content of output.content) {
        if (!isRecord(content)) continue;
        if (content.type === "refusal")
          throw new VoiceHttpError(
            422,
            "AI no pudo interpretar este texto. Puedes revisarlo o usar el modo local.",
          );
        if (content.type === "output_text" && typeof content.text === "string")
          texts.push(content.text);
      }
    }
    let extraction: unknown;
    try {
      extraction = JSON.parse(texts.join(""));
      parseAiShoppingResponse(extraction, input.transcript);
    } catch {
      throw new VoiceHttpError(
        502,
        "AI devolvió datos que no se pueden validar. Puedes reintentar o usar el modo local.",
      );
    }
    return {
      ...(extraction as Record<string, unknown>),
      model,
      promptVersion: SHOPPING_EXTRACTION_PROMPT_VERSION,
    };
  });
}
