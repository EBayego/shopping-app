export interface VoiceDependencies {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  authorize: (request: Request) => Promise<void>;
}

export class VoiceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function voiceHandler(
  deps: VoiceDependencies,
  process: (request: Request, apiKey: string) => Promise<unknown>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST")
      return jsonResponse({ error: "Método no permitido." }, 405);
    try {
      if (!/^Bearer \S+$/i.test(request.headers.get("authorization") ?? ""))
        throw new VoiceHttpError(401, "Inicia sesión para utilizar AI.");
      const apiKey = deps.env("OPENAI_API_KEY")?.trim();
      if (!apiKey)
        throw new VoiceHttpError(503, "La función AI no está configurada.");
      // Reserve quota before reading large bodies or contacting OpenAI.
      await deps.authorize(request);
      return jsonResponse(await process(request, apiKey), 200);
    } catch (error) {
      if (error instanceof VoiceHttpError)
        return jsonResponse({ error: error.message }, error.status);
      // Never log transcripts, audio, upstream payloads, tokens or keys.
      console.error(
        "Voice AI request failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return jsonResponse(
        {
          error: "No se pudo completar la petición con AI. Puedes reintentar.",
        },
        502,
      );
    }
  };
}

export async function readBoundedBody(
  request: Request,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length") ?? 0) > maximum)
    throw new VoiceHttpError(413, "La petición supera el tamaño permitido.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new VoiceHttpError(
          413,
          "La petición supera el tamaño permitido.",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

export async function openAiJson(
  deps: VoiceDependencies,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await deps.fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new VoiceHttpError(
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "AI está temporalmente ocupado. Reintenta en unos instantes."
          : "OpenAI no pudo procesar la petición. Revisa la configuración o reintenta.",
      );
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted)
      throw new VoiceHttpError(
        504,
        "AI ha tardado demasiado. Puedes reintentar.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}
