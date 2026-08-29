import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useMemo } from "react";
import { Linking } from "react-native";

import {
  SpeechRecognitionError,
  type SpeechRecognitionOptions,
  type SpeechRecognitionResult,
  type SpeechRecognitionService,
} from "../features/voice/speech-recognition-service";
import { getSupabaseClient } from "./supabase";

interface TranscriptionResponse {
  text: string;
  segments: readonly string[];
}

const AI_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: "cache" as const,
  isMeteringEnabled: true,
  numberOfChannels: 1,
};

export class GroqSpeechRecognitionService implements SpeechRecognitionService {
  private cancelCurrent: (() => void) | null = null;
  private stopCurrent: (() => void) | null = null;

  constructor(private readonly recorder: AudioRecorder) {}

  async recognize(
    options: SpeechRecognitionOptions,
  ): Promise<SpeechRecognitionResult> {
    if (this.cancelCurrent !== null) {
      throw new SpeechRecognitionError(
        "AI_ERROR",
        "Ya hay una transcripción con AI en curso.",
      );
    }

    let cancelledBeforeStart = false;
    const cancelStart = (): void => {
      cancelledBeforeStart = true;
    };
    this.cancelCurrent = cancelStart;
    this.stopCurrent = cancelStart;

    try {
      await requestAudioPermission();
      if (cancelledBeforeStart) throw cancelledError();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      if (cancelledBeforeStart) throw cancelledError();
      await this.recorder.prepareToRecordAsync();
    } catch (error) {
      this.clearIfCurrent(cancelStart);
      releaseRecordingMode();
      throw cancelledBeforeStart ? cancelledError() : aiError(error);
    }

    if (cancelledBeforeStart) {
      this.clearIfCurrent(cancelStart);
      releaseRecordingMode();
      throw cancelledError();
    }

    return new Promise<SpeechRecognitionResult>((resolve, reject) => {
      let settled = false;
      let processingStarted = false;
      let stopRequested = false;
      let volumeTimer: ReturnType<typeof setInterval> | null = null;

      const finish = (outcome: {
        result?: SpeechRecognitionResult;
        error?: Error;
      }): void => {
        if (settled) return;
        settled = true;
        if (volumeTimer !== null) clearInterval(volumeTimer);
        options.onVolumeChange?.(0);
        this.cancelCurrent = null;
        this.stopCurrent = null;
        releaseRecordingMode();
        if (outcome.error !== undefined) reject(outcome.error);
        else resolve(outcome.result ?? { transcript: "", segments: [] });
      };

      const transcribe = async (uri: string): Promise<void> => {
        if (processingStarted || settled) return;
        processingStarted = true;
        options.onProcessingChange?.(true);
        try {
          const response = await transcribeRecording(uri);
          const transcript = normalizeWhitespace(response.text);
          if (!transcript) {
            throw new SpeechRecognitionError(
              "EMPTY_TRANSCRIPT",
              "No se ha reconocido ningún producto.",
            );
          }
          const segments = response.segments
            .map((segment) => normalizeWhitespace(segment))
            .filter(Boolean);
          finish({
            result: {
              transcript,
              segments: segments.length > 0 ? segments : [transcript],
            },
          });
        } catch (error) {
          finish({ error: aiError(error) });
        } finally {
          options.onProcessingChange?.(false);
          deleteTemporaryRecording(uri);
        }
      };

      const stopAndTranscribe = async (): Promise<void> => {
        if (stopRequested || processingStarted || settled) return;
        stopRequested = true;
        if (volumeTimer !== null) {
          clearInterval(volumeTimer);
          volumeTimer = null;
        }
        try {
          await this.recorder.stop();
          if (settled) {
            if (this.recorder.uri) deleteTemporaryRecording(this.recorder.uri);
            return;
          }
          const uri = this.recorder.uri;
          if (!uri) {
            throw new SpeechRecognitionError(
              "AI_ERROR",
              "No se pudo preparar el audio para la transcripción con AI.",
            );
          }
          await transcribe(uri);
        } catch (error) {
          finish({ error: aiError(error) });
        }
      };

      this.cancelCurrent = () => {
        const cancelRecording = async (): Promise<void> => {
          const uriBeforeStop = this.recorder.uri;
          try {
            await this.recorder.stop();
          } catch {
            // Cancellation should still settle even when the recorder cannot stop cleanly.
          }
          const uri = this.recorder.uri ?? uriBeforeStop;
          if (uri) deleteTemporaryRecording(uri);
          finish({ error: cancelledError() });
        };
        void cancelRecording();
      };
      this.stopCurrent = () => {
        void stopAndTranscribe();
      };

      try {
        this.recorder.record();
        volumeTimer = setInterval(() => {
          const metering = this.recorder.getStatus().metering;
          if (metering !== undefined) {
            options.onVolumeChange?.(normalizeMetering(metering));
          }
        }, 100);
      } catch (error) {
        finish({ error: aiError(error) });
      }
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

  private clearIfCurrent(callback: () => void): void {
    if (this.cancelCurrent === callback) this.cancelCurrent = null;
    if (this.stopCurrent === callback) this.stopCurrent = null;
  }
}

export function useGroqSpeechRecognitionService(): SpeechRecognitionService {
  const recorder = useAudioRecorder(AI_RECORDING_OPTIONS);
  return useMemo(() => new GroqSpeechRecognitionService(recorder), [recorder]);
}

async function requestAudioPermission(): Promise<void> {
  const current = await getRecordingPermissionsAsync();
  const permission = current.granted
    ? current
    : await requestRecordingPermissionsAsync();
  if (permission.granted) return;
  throw new SpeechRecognitionError(
    permission.canAskAgain ? "PERMISSION_DENIED" : "PERMISSION_BLOCKED",
    permission.canAskAgain
      ? "Se necesita permiso de micrófono."
      : "El permiso de micrófono está bloqueado. Actívalo en Ajustes.",
  );
}

async function transcribeRecording(
  uri: string,
): Promise<TranscriptionResponse> {
  const file = new File(uri);
  const audio = await file.arrayBuffer();
  const metadata = audioMetadata(file.name);
  const invocationResult: unknown =
    await getSupabaseClient().functions.invoke<TranscriptionResponse>(
      "transcribe-audio",
      {
        body: audio,
        headers: {
          "Content-Type": metadata.contentType,
          "X-Audio-Filename": file.name || metadata.fallbackName,
        },
      },
    );
  if (!isRecord(invocationResult)) {
    throw new Error("El servicio de AI devolvió una respuesta no válida.");
  }
  if (invocationResult.error) {
    throw invocationResult.error instanceof Error
      ? invocationResult.error
      : new Error("La función de transcripción con AI ha fallado.");
  }
  if (!isTranscriptionResponse(invocationResult.data)) {
    throw new Error("El servicio de AI devolvió una respuesta no válida.");
  }
  return invocationResult.data;
}

function audioMetadata(fileName: string): {
  contentType: string;
  fallbackName: string;
} {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "webm") {
    return { contentType: "audio/webm", fallbackName: "voice-recording.webm" };
  }
  if (extension === "wav") {
    return { contentType: "audio/wav", fallbackName: "voice-recording.wav" };
  }
  return { contentType: "audio/mp4", fallbackName: "voice-recording.m4a" };
}

function isTranscriptionResponse(
  value: unknown,
): value is TranscriptionResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === "string" &&
    Array.isArray(value.segments) &&
    value.segments.every((segment) => typeof segment === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function deleteTemporaryRecording(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // The recording is stored in the OS cache and may already have been removed.
  }
}

function releaseRecordingMode(): void {
  void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
}

function cancelledError(): SpeechRecognitionError {
  return new SpeechRecognitionError("CANCELLED", "Transcripción cancelada.");
}

function aiError(error: unknown): SpeechRecognitionError {
  if (error instanceof SpeechRecognitionError) return error;
  return new SpeechRecognitionError(
    "AI_ERROR",
    error instanceof Error
      ? `No se pudo completar la transcripción con AI: ${error.message}`
      : "No se pudo completar la transcripción con AI.",
  );
}

function normalizeMetering(value: number): number {
  return Math.min(1, Math.max(0, (value + 60) / 60));
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
