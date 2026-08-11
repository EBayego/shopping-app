import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExpoSpeechRecognitionService } from "./expo-speech-recognition-service";

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
    const recognition = service.recognize({ locale: "es-ES" });
    const resolved = vi.fn();
    void recognition.then(resolved);
    await flushPromises();

    expect(mocks.native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: "es-ES",
        continuous: true,
        interimResults: true,
      }),
    );

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
