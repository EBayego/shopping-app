const GROQ_TRANSCRIPTIONS_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-audio-filename, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  const apiKey = Deno.env.get("GROQ_API_KEY")?.trim();
  if (!apiKey) {
    console.error("GROQ_API_KEY is not configured");
    return jsonResponse(
      { error: "La transcripción con AI no está configurada." },
      503,
    );
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!contentType || !ALLOWED_AUDIO_TYPES.has(contentType)) {
    return jsonResponse({ error: "Formato de audio no compatible." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: "El audio supera el límite de 20 MB." }, 413);
  }

  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0) {
    return jsonResponse({ error: "El audio está vacío." }, 400);
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: "El audio supera el límite de 20 MB." }, 413);
  }

  const requestedName = request.headers.get("x-audio-filename") ?? "voice.wav";
  const filename = safeAudioFilename(requestedName);
  const form = new FormData();
  form.append("file", new File([audio], filename, { type: contentType }));
  form.append("model", GROQ_MODEL);
  form.append("language", "es");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  form.append(
    "prompt",
    "Lista de la compra en español: agua, leche, huevos, tomate triturado, kilos, gramos, litros, botellas, garrafas, paquetes, bandejas, docenas, marcas y variantes.",
  );

  let groqResponse: Response;
  try {
    groqResponse = await fetch(GROQ_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    console.error("Groq transcription request failed", error);
    return jsonResponse(
      { error: "No se pudo conectar con el servicio de transcripción." },
      502,
    );
  }

  const payload: unknown = await groqResponse.json().catch(() => null);
  if (!groqResponse.ok) {
    console.error("Groq transcription rejected", groqResponse.status, payload);
    return jsonResponse(
      { error: "El servicio de transcripción no pudo procesar el audio." },
      502,
    );
  }
  if (!isRecord(payload) || typeof payload.text !== "string") {
    console.error("Unexpected Groq transcription response", payload);
    return jsonResponse(
      {
        error: "El servicio de transcripción devolvió una respuesta no válida.",
      },
      502,
    );
  }

  const segments = Array.isArray(payload.segments)
    ? payload.segments
        .filter(isRecord)
        .map((segment) => segment.text)
        .filter((text): text is string => typeof text === "string")
    : [];

  return jsonResponse({ text: payload.text, segments }, 200);
});

function safeAudioFilename(value: string): string {
  const filename = value
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[^a-zA-Z0-9._-]/g, "_");
  return filename && filename.length <= 120 ? filename : "voice.wav";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}
