import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { Linking, Platform } from "react-native";

import {
  SpeechRecognitionError,
  type SpeechRecognitionOptions,
  type SpeechRecognitionResult,
  type SpeechRecognitionService,
} from "../features/voice/speech-recognition-service";

type Subscription = { remove(): void };

const SHOPPING_CONTEXT = [
  "agua",
  "tomate",
  "tomate triturado",
  "huevos",
  "leche",
  "gramos",
  "kilos",
  "litros",
  "mililitros",
  "unidades",
  "botellas",
  "latas",
  "cajas",
  "garrafas",
  "paquetes",
  "bandejas",
  "docena",
  "docenas",
  "sin lactosa",
  "semidesnatada",
  "Coca-Cola",
  "eh",
  "ehm",
  "mmm",
] as const;

interface RecognitionAlternative {
  transcript: string;
  confidence?: number;
}

export class ExpoSpeechRecognitionService implements SpeechRecognitionService {
  private cancelCurrent: (() => void) | null = null;
  private stopCurrent: (() => void) | null = null;

  async recognize(
    options: SpeechRecognitionOptions,
  ): Promise<SpeechRecognitionResult> {
    if (this.cancelCurrent !== null) {
      throw new SpeechRecognitionError(
        "NATIVE_ERROR",
        "Ya hay un reconocimiento de voz en curso.",
      );
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      throw new SpeechRecognitionError(
        "UNAVAILABLE",
        "El reconocimiento de voz no está disponible en este dispositivo.",
      );
    }

    let cancelledBeforeStart = false;
    const cancelPermissionRequest = (): void => {
      cancelledBeforeStart = true;
    };
    this.cancelCurrent = cancelPermissionRequest;
    this.stopCurrent = cancelPermissionRequest;
    try {
      await requestNativePermissions();
    } catch (error) {
      if (this.cancelCurrent === cancelPermissionRequest)
        this.cancelCurrent = null;
      if (this.stopCurrent === cancelPermissionRequest) this.stopCurrent = null;
      if (cancelledBeforeStart) {
        throw new SpeechRecognitionError(
          "CANCELLED",
          "Reconocimiento cancelado.",
        );
      }
      throw error;
    }
    if (cancelledBeforeStart) {
      this.cancelCurrent = null;
      this.stopCurrent = null;
      throw new SpeechRecognitionError(
        "CANCELLED",
        "Reconocimiento cancelado.",
      );
    }

    return new Promise<SpeechRecognitionResult>((resolve, reject) => {
      const subscriptions: Subscription[] = [];
      let settled = false;
      let committedSegments: string[] = [];
      let interimTranscript = "";
      let stopRequested = false;

      const result = (): SpeechRecognitionResult => {
        const segments = appendSegment(committedSegments, interimTranscript);
        return { transcript: segments.join(" "), segments };
      };

      const finish = (outcome: {
        result?: SpeechRecognitionResult;
        error?: Error;
      }): void => {
        if (settled) return;
        settled = true;
        subscriptions.forEach((subscription) => subscription.remove());
        this.cancelCurrent = null;
        this.stopCurrent = null;
        if (outcome.error !== undefined) reject(outcome.error);
        else resolve(outcome.result ?? { transcript: "", segments: [] });
      };

      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener("result", (event) => {
          const recognized = selectRecognitionTranscript(event.results);
          if (event.isFinal) {
            committedSegments = appendSegment(
              committedSegments,
              bestFinalTranscript(recognized, interimTranscript),
            );
            interimTranscript = "";
          } else {
            interimTranscript = recognized;
          }
        }),
        ExpoSpeechRecognitionModule.addListener("nomatch", () => undefined),
        ExpoSpeechRecognitionModule.addListener("volumechange", (event) => {
          options.onVolumeChange?.(normalizeVolume(event.value));
        }),
        ExpoSpeechRecognitionModule.addListener("end", () => {
          if (!stopRequested) {
            committedSegments = appendSegment(
              committedSegments,
              interimTranscript,
            );
            interimTranscript = "";
            startNativeRecognition(options.locale, finish);
            return;
          }
          const recognized = result();
          finish(
            recognized.transcript.length > 0
              ? { result: recognized }
              : { error: emptyTranscriptError() },
          );
        }),
        ExpoSpeechRecognitionModule.addListener("error", (event) => {
          if (event.error === "aborted") {
            finish({
              error: new SpeechRecognitionError(
                "CANCELLED",
                "Reconocimiento cancelado.",
              ),
            });
            return;
          }
          if (event.error === "no-speech" || event.error === "speech-timeout") {
            if (stopRequested) {
              const recognized = result();
              finish(
                recognized.transcript.length > 0
                  ? { result: recognized }
                  : { error: emptyTranscriptError() },
              );
            }
            return;
          }
          if (event.error === "not-allowed") {
            finish({
              error: new SpeechRecognitionError(
                "PERMISSION_DENIED",
                "No se concedieron los permisos de voz.",
              ),
            });
            return;
          }
          const recognized = result();
          if (recognized.transcript.length > 0) {
            finish({ result: recognized });
            return;
          }
          finish({
            error: new SpeechRecognitionError(
              event.error === "service-not-allowed"
                ? "UNAVAILABLE"
                : "NATIVE_ERROR",
              event.message || "El reconocimiento de voz ha fallado.",
            ),
          });
        }),
      );

      this.cancelCurrent = () => {
        ExpoSpeechRecognitionModule.abort();
        finish({
          error: new SpeechRecognitionError(
            "CANCELLED",
            "Reconocimiento cancelado.",
          ),
        });
      };
      this.stopCurrent = () => {
        if (stopRequested) return;
        stopRequested = true;
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch (error) {
          finish({ error: nativeError(error) });
        }
      };

      startNativeRecognition(options.locale, finish);
    });
  }

  stop(): void {
    this.stopCurrent?.();
  }

  cancel(): void {
    this.cancelCurrent?.();
  }

  async openSettings(): Promise<void> {
    await Linking.openSettings();
  }
}

function startNativeRecognition(
  locale: string,
  finish: (outcome: {
    result?: SpeechRecognitionResult;
    error?: Error;
  }) => void,
): void {
  try {
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      continuous: true,
      maxAlternatives: 3,
      addsPunctuation: true,
      contextualStrings: [...SHOPPING_CONTEXT],
      recordingOptions: { persist: false },
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  } catch (error) {
    finish({ error: nativeError(error) });
  }
}

function selectRecognitionTranscript(
  alternatives: readonly RecognitionAlternative[],
): string {
  let bestTranscript = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  alternatives.forEach((alternative, index) => {
    const transcript = normalizeWhitespace(alternative.transcript);
    if (!transcript) return;
    const confidence = Number.isFinite(alternative.confidence)
      ? (alternative.confidence ?? 0)
      : 0;
    const score =
      confidence * 2 + shoppingVocabularyScore(transcript) - index * 0.05;
    if (score > bestScore) {
      bestTranscript = transcript;
      bestScore = score;
    }
  });
  return bestTranscript;
}

function shoppingVocabularyScore(transcript: string): number {
  const normalized = transcript
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
  let score = 0;
  for (const phrase of [
    "tomate triturado",
    "tomate triturada",
    "docena de huevos",
    "docenas de huevos",
  ]) {
    if (normalized.includes(phrase)) score += 4;
  }
  for (const phrase of [
    "garrafa de agua",
    "garrafas de agua",
    "litro de leche",
    "litros de leche",
  ]) {
    if (normalized.includes(phrase)) score += 1.5;
  }
  if (normalized.includes("toma triturado")) score -= 2;
  if (
    normalized.includes("zona de huevos") ||
    normalized.includes("zonas de huevos")
  ) {
    score -= 2;
  }
  return score;
}

function normalizeVolume(value: number): number {
  return Math.min(1, Math.max(0, (value + 2) / 12));
}

function appendSegment(current: readonly string[], next: string): string[] {
  const normalizedNext = normalizeWhitespace(next);
  if (!normalizedNext) return [...current];
  const fullTranscript = normalizeWhitespace(current.join(" "));
  if (normalizedNext === fullTranscript) return [...current];
  if (fullTranscript && startsWithWords(normalizedNext, fullTranscript)) {
    return [normalizedNext];
  }
  if (fullTranscript && startsWithWords(fullTranscript, normalizedNext)) {
    return [...current];
  }

  const last = current.at(-1);
  if (last === undefined) return [normalizedNext];
  const normalizedLast = normalizeWhitespace(last);
  if (normalizedLast === normalizedNext) return [...current];
  if (startsWithWords(normalizedNext, normalizedLast)) {
    return [...current.slice(0, -1), normalizedNext];
  }
  if (startsWithWords(normalizedLast, normalizedNext)) return [...current];

  const lastWords = words(normalizedLast);
  const nextWords = words(normalizedNext);
  const overlap = overlappingWordCount(lastWords, nextWords);
  const overlapWord = lastWords.at(-1)?.toLocaleLowerCase("es");
  if (
    overlap >= 2 ||
    (overlap === 1 &&
      (overlapWord === "de" ||
        overlapWord === "del" ||
        overlapWord === "y" ||
        overlapWord === "con"))
  ) {
    return [
      ...current.slice(0, -1),
      [...lastWords, ...nextWords.slice(overlap)].join(" "),
    ];
  }
  return [...current, normalizedNext];
}

function bestFinalTranscript(finalText: string, interimText: string): string {
  const normalizedFinal = normalizeWhitespace(finalText);
  const normalizedInterim = normalizeWhitespace(interimText);
  if (!normalizedFinal) return normalizedInterim;
  if (!normalizedInterim) return normalizedFinal;
  if (startsWithWords(normalizedInterim, normalizedFinal)) {
    return normalizedInterim;
  }
  return normalizedFinal;
}

function startsWithWords(value: string, prefix: string): boolean {
  const valueWords = words(value);
  const prefixWords = words(prefix);
  return prefixWords.every(
    (word, index) =>
      word.toLocaleLowerCase("es") ===
      valueWords[index]?.toLocaleLowerCase("es"),
  );
}

function overlappingWordCount(
  previous: readonly string[],
  next: readonly string[],
): number {
  const maximum = Math.min(previous.length, next.length);
  for (let size = maximum; size > 0; size -= 1) {
    const suffix = previous.slice(-size);
    const prefix = next.slice(0, size);
    if (
      suffix.every(
        (word, index) =>
          word.toLocaleLowerCase("es") ===
          prefix[index]?.toLocaleLowerCase("es"),
      )
    ) {
      return size;
    }
  }
  return 0;
}

function words(value: string): string[] {
  return normalizeWhitespace(value).split(" ").filter(Boolean);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export async function requestNativePermissions(): Promise<void> {
  const microphone =
    await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync();
  const microphoneResult = microphone.granted
    ? microphone
    : await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
  assertPermission(microphoneResult, "micrófono");

  if (Platform.OS === "ios") {
    const speech =
      await ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync();
    const speechResult = speech.granted
      ? speech
      : await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync();
    assertPermission(speechResult, "reconocimiento de voz");
  }
}

function assertPermission(
  permission: { granted: boolean; canAskAgain: boolean },
  permissionName: string,
): void {
  if (permission.granted) return;
  throw new SpeechRecognitionError(
    permission.canAskAgain ? "PERMISSION_DENIED" : "PERMISSION_BLOCKED",
    permission.canAskAgain
      ? `Se necesita permiso de ${permissionName}.`
      : `El permiso de ${permissionName} está bloqueado. Actívalo en Ajustes.`,
  );
}

function emptyTranscriptError(): SpeechRecognitionError {
  return new SpeechRecognitionError(
    "EMPTY_TRANSCRIPT",
    "No se ha reconocido ningún producto.",
  );
}

function nativeError(error: unknown): SpeechRecognitionError {
  return new SpeechRecognitionError(
    "NATIVE_ERROR",
    error instanceof Error
      ? error.message
      : "El reconocimiento de voz ha fallado.",
  );
}

export const speechRecognitionService: SpeechRecognitionService =
  new ExpoSpeechRecognitionService();
