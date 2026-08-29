import type { AudioRecorder } from "expo-audio";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpeechRecognitionError } from "../features/voice/speech-recognition-service";
import { GroqSpeechRecognitionService } from "./groq-speech-recognition-service";

const mocks = vi.hoisted(() => {
  const recorder = {
    uri: "file:///cache/recording.m4a" as string | null,
    isRecording: false,
    getStatus: vi.fn(() => ({ metering: -30 })),
    prepareToRecordAsync: vi.fn().mockResolvedValue(undefined),
    record: vi.fn(() => {
      recorder.isRecording = true;
    }),
    stop: vi.fn(() => {
      recorder.isRecording = false;
      return Promise.resolve();
    }),
  };
  return {
    file: {
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      delete: vi.fn(),
    },
    getRecordingPermissionsAsync: vi
      .fn()
      .mockResolvedValue({ granted: true, canAskAgain: true }),
    invoke: vi.fn(),
    recorder,
    requestRecordingPermissionsAsync: vi
      .fn()
      .mockResolvedValue({ granted: true, canAskAgain: true }),
    setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("expo-audio", () => ({
  getRecordingPermissionsAsync: mocks.getRecordingPermissionsAsync,
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: ".m4a",
      sampleRate: 44_100,
      numberOfChannels: 2,
      bitRate: 128_000,
      android: { outputFormat: "mpeg4", audioEncoder: "aac" },
      ios: { outputFormat: "aac ", audioQuality: 127 },
      web: { mimeType: "audio/webm", bitsPerSecond: 128_000 },
    },
  },
  requestRecordingPermissionsAsync: mocks.requestRecordingPermissionsAsync,
  setAudioModeAsync: mocks.setAudioModeAsync,
  useAudioRecorder: () => mocks.recorder,
}));

vi.mock("expo-file-system", () => ({
  File: class MockFile {
    readonly name: string;

    constructor(uri: string) {
      this.name = uri.split("/").pop() ?? "";
    }

    arrayBuffer = mocks.file.arrayBuffer;
    delete = mocks.file.delete;
  },
}));

vi.mock("react-native", () => ({
  Linking: { openSettings: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    functions: { invoke: mocks.invoke },
  }),
}));

describe("GroqSpeechRecognitionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recorder.uri = "file:///cache/recording.m4a";
    mocks.recorder.isRecording = false;
    mocks.getRecordingPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    mocks.requestRecordingPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    mocks.file.arrayBuffer.mockResolvedValue(new ArrayBuffer(4));
    mocks.invoke.mockResolvedValue({
      data: {
        text: " dos litros de leche ",
        segments: ["dos litros de leche"],
      },
      error: null,
    });
  });

  it("records raw audio and sends it to Groq without using native speech recognition", async () => {
    const service = createService();
    const onProcessingChange = vi.fn<(processing: boolean) => void>();
    const recognition = service.recognize({
      locale: "es-ES",
      onProcessingChange,
    });
    await flushPromises();

    expect(mocks.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    expect(mocks.recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
    expect(mocks.recorder.record).toHaveBeenCalledOnce();

    service.stop();

    await expect(recognition).resolves.toEqual({
      transcript: "dos litros de leche",
      segments: ["dos litros de leche"],
    });
    expect(mocks.recorder.stop).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledOnce();
    const invocation: unknown = mocks.invoke.mock.calls[0];
    expect(invocation).toEqual([
      "transcribe-audio",
      expect.objectContaining({
        headers: {
          "Content-Type": "audio/mp4",
          "X-Audio-Filename": "recording.m4a",
        },
      }),
    ]);
    if (!Array.isArray(invocation) || !isRecord(invocation[1])) {
      throw new TypeError("Missing Supabase invocation");
    }
    expect(invocation[1].body).toBeInstanceOf(ArrayBuffer);
    expect(onProcessingChange.mock.calls).toEqual([[true], [false]]);
    expect(mocks.file.delete).toHaveBeenCalledOnce();
  });

  it("reports a blocked microphone permission before recording", async () => {
    mocks.getRecordingPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });
    mocks.requestRecordingPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });
    const service = createService();

    await expect(service.recognize({ locale: "es-ES" })).rejects.toEqual(
      expect.objectContaining<Partial<SpeechRecognitionError>>({
        code: "PERMISSION_BLOCKED",
      }),
    );
    expect(mocks.recorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(mocks.recorder.record).not.toHaveBeenCalled();
  });

  it("reports backend failures as AI errors and still deletes the audio", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: new Error("function unavailable"),
    });
    const service = createService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    service.stop();

    await expect(recognition).rejects.toMatchObject({ code: "AI_ERROR" });
    await expect(recognition).rejects.toThrow("function unavailable");
    expect(mocks.file.delete).toHaveBeenCalledOnce();
  });

  it("cancels the recorder without invoking Groq", async () => {
    const service = createService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    service.cancel();

    await expect(recognition).rejects.toMatchObject({ code: "CANCELLED" });
    expect(mocks.recorder.stop).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.file.delete).toHaveBeenCalledOnce();
  });
});

function createService(): GroqSpeechRecognitionService {
  return new GroqSpeechRecognitionService(
    mocks.recorder as unknown as AudioRecorder,
  );
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
