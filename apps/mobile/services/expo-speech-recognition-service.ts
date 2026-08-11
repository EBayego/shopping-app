import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { Linking, Platform } from "react-native";

import {
  SpeechRecognitionError,
  type SpeechRecognitionOptions,
  type SpeechRecognitionService,
} from "../features/voice/speech-recognition-service";

type Subscription = { remove(): void };

export class ExpoSpeechRecognitionService implements SpeechRecognitionService {
  private cancelCurrent: (() => void) | null = null;
  private stopCurrent: (() => void) | null = null;

  async recognize(options: SpeechRecognitionOptions): Promise<string> {
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

    return new Promise<string>((resolve, reject) => {
      const subscriptions: Subscription[] = [];
      let settled = false;
      let committedTranscript = "";
      let interimTranscript = "";
      let stopRequested = false;

      const transcript = (): string =>
        joinTranscript(committedTranscript, interimTranscript);

      const finish = (result: { transcript?: string; error?: Error }): void => {
        if (settled) return;
        settled = true;
        subscriptions.forEach((subscription) => subscription.remove());
        this.cancelCurrent = null;
        this.stopCurrent = null;
        if (result.error !== undefined) reject(result.error);
        else resolve(result.transcript ?? "");
      };

      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener("result", (event) => {
          const recognized = event.results[0]?.transcript.trim() ?? "";
          if (event.isFinal) {
            committedTranscript = joinTranscript(
              committedTranscript,
              recognized,
            );
            interimTranscript = "";
          } else {
            interimTranscript = recognized;
          }
        }),
        ExpoSpeechRecognitionModule.addListener("nomatch", () => undefined),
        ExpoSpeechRecognitionModule.addListener("end", () => {
          if (!stopRequested) {
            committedTranscript = joinTranscript(
              committedTranscript,
              interimTranscript,
            );
            interimTranscript = "";
            startNativeRecognition(options.locale, finish);
            return;
          }
          const recognized = transcript();
          finish(
            recognized.length > 0
              ? { transcript: recognized }
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
  finish: (result: { transcript?: string; error?: Error }) => void,
): void {
  try {
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      recordingOptions: { persist: false },
    });
  } catch (error) {
    finish({ error: nativeError(error) });
  }
}

function joinTranscript(current: string, next: string): string {
  const normalizedCurrent = current.trim();
  const normalizedNext = next.trim();
  if (!normalizedCurrent) return normalizedNext;
  if (!normalizedNext) return normalizedCurrent;
  if (normalizedNext.startsWith(normalizedCurrent)) return normalizedNext;
  return `${normalizedCurrent} ${normalizedNext}`;
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
