import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { Linking, Platform } from "react-native";

import {
  SpeechRecognitionError,
  type SpeechRecognitionOptions,
  type SpeechRecognitionResult,
  type SpeechRecognitionService,
} from "../features/voice/speech-recognition-service";

type Subscription = { remove(): void };

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

      const transcript = (): string =>
        joinTranscript(committedSegments.join(" "), interimTranscript);

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
          const recognized = event.results[0]?.transcript.trim() ?? "";
          if (event.isFinal) {
            committedSegments = appendSegment(committedSegments, recognized);
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
            if (stopRequested && transcript().length === 0) {
              finish({ error: emptyTranscriptError() });
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
      maxAlternatives: 1,
      recordingOptions: { persist: false },
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  } catch (error) {
    finish({ error: nativeError(error) });
  }
}

function normalizeVolume(value: number): number {
  return Math.min(1, Math.max(0, (value + 2) / 12));
}

function joinTranscript(current: string, next: string): string {
  const normalizedCurrent = current.trim();
  const normalizedNext = next.trim();
  if (!normalizedCurrent) return normalizedNext;
  if (!normalizedNext) return normalizedCurrent;
  if (normalizedNext.startsWith(normalizedCurrent)) return normalizedNext;
  return `${normalizedCurrent} ${normalizedNext}`;
}

function appendSegment(current: readonly string[], next: string): string[] {
  const normalizedNext = next.trim();
  if (!normalizedNext) return [...current];
  const fullTranscript = current.join(" ");
  if (normalizedNext === fullTranscript) return [...current];
  if (fullTranscript && normalizedNext.startsWith(fullTranscript)) {
    return [normalizedNext];
  }
  if (current.at(-1) === normalizedNext) return [...current];
  return [...current, normalizedNext];
}

async function requestNativePermissions(): Promise<void> {
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
