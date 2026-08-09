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
    try {
      await requestNativePermissions();
    } catch (error) {
      if (this.cancelCurrent === cancelPermissionRequest)
        this.cancelCurrent = null;
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
      throw new SpeechRecognitionError(
        "CANCELLED",
        "Reconocimiento cancelado.",
      );
    }

    return new Promise<string>((resolve, reject) => {
      const subscriptions: Subscription[] = [];
      let settled = false;
      let latestTranscript = "";

      const finish = (result: { transcript?: string; error?: Error }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subscriptions.forEach((subscription) => subscription.remove());
        this.cancelCurrent = null;
        if (result.error !== undefined) reject(result.error);
        else resolve(result.transcript ?? "");
      };

      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener("result", (event) => {
          const transcript = event.results[0]?.transcript.trim() ?? "";
          if (transcript.length > 0) latestTranscript = transcript;
          if (event.isFinal) {
            finish(
              latestTranscript.length > 0
                ? { transcript: latestTranscript }
                : { error: emptyTranscriptError() },
            );
          }
        }),
        ExpoSpeechRecognitionModule.addListener("nomatch", () => {
          finish({ error: emptyTranscriptError() });
        }),
        ExpoSpeechRecognitionModule.addListener("end", () => {
          finish(
            latestTranscript.length > 0
              ? { transcript: latestTranscript }
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
            finish({ error: emptyTranscriptError() });
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

      const timeout = setTimeout(() => {
        ExpoSpeechRecognitionModule.abort();
        finish({
          error: new SpeechRecognitionError(
            "TIMEOUT",
            "No se detectó voz a tiempo.",
          ),
        });
      }, options.timeoutMs);

      this.cancelCurrent = () => {
        ExpoSpeechRecognitionModule.abort();
        finish({
          error: new SpeechRecognitionError(
            "CANCELLED",
            "Reconocimiento cancelado.",
          ),
        });
      };

      try {
        ExpoSpeechRecognitionModule.start({
          lang: options.locale,
          interimResults: true,
          continuous: false,
          maxAlternatives: 1,
          recordingOptions: { persist: false },
        });
      } catch (error) {
        finish({ error: nativeError(error) });
      }
    });
  }

  cancel(): void {
    this.cancelCurrent?.();
  }

  async openSettings(): Promise<void> {
    await Linking.openSettings();
  }
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
