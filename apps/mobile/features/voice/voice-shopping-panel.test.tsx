import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import {
  SpeechRecognitionError,
  type SpeechRecognitionService,
} from "./speech-recognition-service";
import { VoiceShoppingPanel } from "./voice-shopping-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

describe("VoiceShoppingPanel", () => {
  it("shows a successful transcript, preselects HIGH and confirms it", async () => {
    const service = serviceReturning("dos litros de leche semidesnatada");
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const renderer = await renderPanel(service, { onConfirm });

    await listen(renderer);

    expect(screenText(renderer)).toContain("dos litros de leche semidesnatada");
    expect(screenText(renderer)).toContain("alta confianza, preseleccionado");
    expect(
      renderer.root.findByProps({
        accessibilityLabel: "Seleccionar resultado 1",
      }).props.accessibilityState,
    ).toEqual({ checked: true });

    await pressAndFlush(buttonByText(renderer, "Añadir seleccionados"));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({
        product: "leche",
        variant: "semidesnatada",
        requestedQuantity: 2,
        requestedUnit: "l",
      }),
    ]);
  });

  it("cancels an active recognition through the service", async () => {
    let rejectRecognition: ((reason: Error) => void) | undefined;
    const cancel = vi.fn(() =>
      rejectRecognition?.(
        new SpeechRecognitionError("CANCELLED", "Reconocimiento cancelado."),
      ),
    );
    const service: SpeechRecognitionService = {
      recognize: vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectRecognition = reject;
          }),
      ),
      cancel,
      openSettings: vi.fn().mockResolvedValue(undefined),
    };
    const renderer = await renderPanel(service);

    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    await pressAndFlush(buttonByText(renderer, "Cancelar escucha"));

    expect(cancel).toHaveBeenCalledOnce();
    expect(screenText(renderer)).toContain("Escucha cancelada");
  });

  it("shows native errors without producing a preview", async () => {
    const service = serviceRejecting(
      new SpeechRecognitionError("NATIVE_ERROR", "fallo del recognizer"),
    );
    const renderer = await renderPanel(service);
    await listen(renderer);
    expect(screenText(renderer)).toContain("Error de reconocimiento");
    expect(screenText(renderer)).toContain("fallo del recognizer");
    expect(resultSelectors(renderer)).toHaveLength(0);
  });

  it("handles an empty transcript", async () => {
    const renderer = await renderPanel(serviceReturning("   "));
    await listen(renderer);
    expect(screenText(renderer)).toContain(
      "No se ha reconocido ningún producto",
    );
    expect(resultSelectors(renderer)).toHaveLength(0);
  });

  it("previews multiple parsed items without auto-selecting MEDIUM results", async () => {
    const renderer = await renderPanel(
      serviceReturning("dos litros de leche, pan y seis huevos"),
    );
    await listen(renderer);
    expect(resultSelectors(renderer)).toHaveLength(3);
    expect(resultSelectors(renderer).map(accessibilityState)).toEqual([
      { checked: true },
      { checked: false },
      { checked: false },
    ]);
    expect(screenText(renderer)).toContain("Producto 3");
  });

  it("makes LOW confidence explicit and requires selection", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const renderer = await renderPanel(serviceReturning("cuarto queso"), {
      onConfirm,
    });
    await listen(renderer);
    expect(screenText(renderer)).toContain("No estamos seguros");
    expect(resultSelectors(renderer)[0]?.props.accessibilityState).toEqual({
      checked: false,
    });
    await pressAndFlush(buttonByText(renderer, "Añadir seleccionados"));
    expect(screenText(renderer)).toContain("Selecciona al menos un producto");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("offers system settings after a permanent permission denial", async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    const service = serviceRejecting(
      new SpeechRecognitionError("PERMISSION_BLOCKED", "bloqueado"),
      openSettings,
    );
    const renderer = await renderPanel(service);
    await listen(renderer);
    expect(screenText(renderer)).toContain("permiso está bloqueado");
    await pressAndFlush(buttonByText(renderer, "Abrir Ajustes"));
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "PERMISSION_DENIED" as const,
      "denegado",
      "Necesitamos permiso de micrófono",
    ],
    ["TIMEOUT" as const, "timeout", "No se detectó voz a tiempo"],
    ["UNAVAILABLE" as const, "unavailable", "no está disponible"],
  ])(
    "explains recoverable service error %s",
    async (code, message, expected) => {
      const renderer = await renderPanel(
        serviceRejecting(new SpeechRecognitionError(code, message)),
      );
      await listen(renderer);
      expect(screenText(renderer)).toContain(expected);
    },
  );
});

function serviceReturning(transcript: string): SpeechRecognitionService {
  return {
    recognize: vi.fn().mockResolvedValue(transcript),
    cancel: vi.fn(),
    openSettings: vi.fn().mockResolvedValue(undefined),
  };
}

function serviceRejecting(
  error: Error,
  openSettings = vi.fn().mockResolvedValue(undefined),
): SpeechRecognitionService {
  return {
    recognize: vi.fn().mockRejectedValue(error),
    cancel: vi.fn(),
    openSettings,
  };
}

async function renderPanel(
  service: SpeechRecognitionService,
  overrides: Partial<React.ComponentProps<typeof VoiceShoppingPanel>> = {},
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(
      <VoiceShoppingPanel
        adding={false}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        service={service}
        {...overrides}
      />,
    );
  });
  return renderer!;
}

async function listen(renderer: ReactTestRenderer): Promise<void> {
  await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
}

async function pressAndFlush(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    press(node);
    await Promise.resolve();
  });
}

function accessibilityState(node: ReactTestInstance): unknown {
  return (node.props as { accessibilityState?: unknown }).accessibilityState;
}

function resultSelectors(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith("Seleccionar resultado"),
  );
}

function buttonByText(
  renderer: ReactTestRenderer,
  expected: string,
): ReactTestInstance {
  const result = renderer.root
    .findAll((node) => node.props.accessibilityRole === "button")
    .find((node) => textOf(node).includes(expected));
  if (!result) throw new TypeError(`Missing button: ${expected}`);
  return result;
}

function press(node: ReactTestInstance): void {
  const handler: unknown = node.props.onPress;
  if (typeof handler !== "function") throw new TypeError("Missing onPress");
  (handler as () => void)();
}

function screenText(renderer: ReactTestRenderer): string {
  return textOf(renderer.root);
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join(" ");
}
