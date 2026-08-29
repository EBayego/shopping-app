import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpoSpeechRecognitionService } from "./expo-speech-recognition-service";
import { SpeechRecognitionError } from "../features/voice/speech-recognition-service";

type NativeListener = (event: unknown) => void;

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<NativeListener>>();
  return {
    listeners,
    native: {
      abort: vi.fn(),
      addListener: vi.fn((eventName: string, listener: NativeListener) => {
        const eventListeners = listeners.get(eventName) ?? new Set();
        eventListeners.add(listener);
        listeners.set(eventName, eventListeners);
        return { remove: () => eventListeners.delete(listener) };
      }),
      getMicrophonePermissionsAsync: vi
        .fn()
        .mockResolvedValue({ granted: true, canAskAgain: true }),
      getSpeechRecognizerPermissionsAsync: vi
        .fn()
        .mockResolvedValue({ granted: true, canAskAgain: true }),
      isRecognitionAvailable: vi.fn(() => true),
      requestMicrophonePermissionsAsync: vi.fn(),
      requestSpeechRecognizerPermissionsAsync: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    },
  };
});

vi.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: mocks.native,
}));

vi.mock("react-native", () => ({
  Linking: { openSettings: vi.fn().mockResolvedValue(undefined) },
  Platform: { OS: "android" },
}));

describe("ExpoSpeechRecognitionService", () => {
  beforeEach(() => {
    mocks.listeners.clear();
    vi.clearAllMocks();
    mocks.native.getMicrophonePermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    mocks.native.isRecognitionAvailable.mockReturnValue(true);
  });

  it("keeps listening across final segments until the user stops", async () => {
    const service = new ExpoSpeechRecognitionService();
    const onVolumeChange = vi.fn<(level: number) => void>();
    const recognition = service.recognize({
      locale: "es-ES",
      onVolumeChange,
    });
    const resolved = vi.fn();
    void recognition.then(resolved);
    await flushPromises();

    expect(mocks.native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "es-ES",
        addsPunctuation: true,
        contextualStrings: [
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
        ],
        continuous: true,
        interimResults: true,
        maxAlternatives: 3,
        recordingOptions: { persist: false },
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      }),
    );

    emit("volumechange", { value: -2 });
    emit("volumechange", { value: 4 });
    emit("volumechange", { value: 10 });
    expect(onVolumeChange).toHaveBeenNthCalledWith(1, 0);
    expect(onVolumeChange).toHaveBeenNthCalledWith(2, 0.5);
    expect(onVolumeChange).toHaveBeenNthCalledWith(3, 1);

    emit("result", {
      isFinal: true,
      results: [{ transcript: "pan" }],
    });
    await flushPromises();
    expect(resolved).not.toHaveBeenCalled();

    emit("end", undefined);
    expect(mocks.native.start).toHaveBeenCalledTimes(2);
    expect(resolved).not.toHaveBeenCalled();

    emit("result", {
      isFinal: true,
      results: [{ transcript: "seis huevos" }],
    });
    service.stop();
    expect(mocks.native.stop).toHaveBeenCalledOnce();
    emit("end", undefined);

    await expect(recognition).resolves.toEqual({
      transcript: "pan seis huevos",
      segments: ["pan", "seis huevos"],
    });
  });

  it("preserves an interim hypothesis when the native final is empty", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("result", {
      isFinal: false,
      results: [{ transcript: "eeeh dos kilos de patatas" }],
    });
    emit("result", { isFinal: true, results: [{ transcript: "" }] });
    service.stop();
    emit("end", undefined);

    await expect(recognition).resolves.toEqual({
      transcript: "eeeh dos kilos de patatas",
      segments: ["eeeh dos kilos de patatas"],
    });
  });

  it("prefers a shopping-specific alternative over common recognition errors", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("result", {
      isFinal: true,
      results: [
        { transcript: "dos zonas de huevos", confidence: 0.9 },
        { transcript: "dos docenas de huevos", confidence: 0.65 },
      ],
    });
    service.stop();
    emit("end", undefined);

    await expect(recognition).resolves.toEqual({
      transcript: "dos docenas de huevos",
      segments: ["dos docenas de huevos"],
    });
  });

  it("turns recognizer ends caused by pauses into stable segments", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("result", {
      isFinal: false,
      results: [{ transcript: "un kilo de patatas" }],
    });
    emit("error", { error: "no-speech", message: "silence" });
    emit("end", undefined);
    expect(mocks.native.start).toHaveBeenCalledTimes(2);

    emit("result", {
      isFinal: true,
      results: [{ transcript: "dos litros de leche" }],
    });
    service.stop();
    emit("end", undefined);

    await expect(recognition).resolves.toEqual({
      transcript: "un kilo de patatas dos litros de leche",
      segments: ["un kilo de patatas", "dos litros de leche"],
    });
  });

  it("deduplicates cumulative native results", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("result", {
      isFinal: true,
      results: [{ transcript: "pan y" }],
    });
    emit("result", {
      isFinal: true,
      results: [{ transcript: "pan y seis huevos" }],
    });
    service.stop();
    emit("end", undefined);

    await expect(recognition).resolves.toEqual({
      transcript: "pan y seis huevos",
      segments: ["pan y seis huevos"],
    });
  });

  it("merges overlapping words emitted across recognition restarts", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("result", {
      isFinal: true,
      results: [{ transcript: "un kilo de" }],
    });
    emit("end", undefined);
    emit("result", {
      isFinal: true,
      results: [{ transcript: "de patatas" }],
    });
    service.stop();
    emit("end", undefined);

    await expect(recognition).resolves.toEqual({
      transcript: "un kilo de patatas",
      segments: ["un kilo de patatas"],
    });
  });

  it("salvages recognized speech when Android reports a client error on stop", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("result", {
      isFinal: false,
      results: [{ transcript: "tres botellas de agua" }],
    });
    service.stop();
    emit("error", { error: "client", message: "native stop race" });

    await expect(recognition).resolves.toEqual({
      transcript: "tres botellas de agua",
      segments: ["tres botellas de agua"],
    });
  });

  it("returns partial useful speech instead of discarding it on a network error", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("result", {
      isFinal: false,
      results: [{ transcript: "seis huevos" }],
    });
    emit("error", { error: "network", message: "connection lost" });

    await expect(recognition).resolves.toEqual({
      transcript: "seis huevos",
      segments: ["seis huevos"],
    });
  });

  it("keeps stop idempotent and reports a genuinely empty capture", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    service.stop();
    service.stop();
    expect(mocks.native.stop).toHaveBeenCalledOnce();
    emit("error", { error: "speech-timeout", message: "silence" });

    await expect(recognition).rejects.toMatchObject({
      code: "EMPTY_TRANSCRIPT",
    });
  });

  it("cancels an active capture without returning partial speech", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();
    emit("result", {
      isFinal: false,
      results: [{ transcript: "pan" }],
    });

    service.cancel();

    expect(mocks.native.abort).toHaveBeenCalledOnce();
    await expect(recognition).rejects.toEqual(
      expect.objectContaining<Partial<SpeechRecognitionError>>({
        code: "CANCELLED",
      }),
    );
  });

  it("rejects native errors when there is no useful transcript to recover", async () => {
    const service = new ExpoSpeechRecognitionService();
    const recognition = service.recognize({ locale: "es-ES" });
    await flushPromises();

    emit("error", { error: "audio-capture", message: "microphone failed" });

    await expect(recognition).rejects.toMatchObject({
      code: "NATIVE_ERROR",
      message: "microphone failed",
    });
  });
});

function emit(eventName: string, event: unknown): void {
  mocks.listeners
    .get(eventName)
    ?.forEach((listener: NativeListener) => listener(event));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
