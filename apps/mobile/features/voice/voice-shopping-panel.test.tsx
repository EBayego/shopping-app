import React from "react";
import type { ShoppingIntentDraft } from "@shopping-app/voice-parser";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import {
  SpeechRecognitionError,
  type SpeechRecognitionOptions,
  type SpeechRecognitionResult,
  type SpeechRecognitionService,
} from "./speech-recognition-service";
import { VoiceShoppingPanel } from "./voice-shopping-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

describe("VoiceShoppingPanel", () => {
  it("shows a successful transcript, preselects HIGH and confirms it", async () => {
    const service = serviceReturning("dos litros de leche semidesnatada");
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const renderer = await renderPanel(service, { onConfirm });

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
        product: "Leche",
        variant: "semidesnatada",
        requestedQuantity: 2,
        requestedUnit: "l",
      }),
    ]);
  });

  it("starts automatically and waits for the user to stop recognition", async () => {
    let resolveRecognition:
      ((result: SpeechRecognitionResult) => void) | undefined;
    const stop = vi.fn(() =>
      resolveRecognition?.({
        transcript: "pan y seis huevos",
        segments: ["pan y seis huevos"],
      }),
    );
    const recognize = vi.fn((options: SpeechRecognitionOptions) => {
      expect(options.locale).toBe("es-ES");
      return new Promise<SpeechRecognitionResult>((resolve) => {
        resolveRecognition = resolve;
      });
    });
    const service: SpeechRecognitionService = {
      recognize,
      stop,
      cancel: vi.fn(),
      openSettings: vi.fn().mockResolvedValue(undefined),
    };
    const renderer = await renderPanel(service);

    expect(recognize).toHaveBeenCalledOnce();
    expect(screenText(renderer)).toContain("Escuchando…");
    expect(
      renderer.root.findByProps({
        accessibilityLabel: "Duración de grabación 00:00",
      }),
    ).toBeDefined();
    const recognitionOptions = recognize.mock.calls[0]?.[0];
    expect(recognitionOptions?.locale).toBe("es-ES");
    expect(typeof recognitionOptions?.onVolumeChange).toBe("function");
    await pressAndFlush(buttonByText(renderer, "Parar escucha"));

    expect(stop).toHaveBeenCalledOnce();
    expect(screenText(renderer)).toContain("pan y seis huevos");
  });

  it("always transcribes natively and sends only the full text to AI", async () => {
    const nativeRecognize = vi.fn().mockResolvedValue({
      transcript: "dos litros de leche",
      segments: ["dos litros", "de leche"],
    });
    const nativeService = serviceReturning(
      "dos litros de leche",
      [],
      nativeRecognize,
    );
    const aiParser = {
      parse: vi.fn().mockResolvedValue([
        {
          rawText: "dos litros de leche",
          product: "leche",
          requestedQuantity: 2,
          requestedUnit: "l",
          source: "AI",
          needsReview: false,
          confidence: "MEDIUM",
        },
      ]),
    };
    const renderer = await renderPanel(nativeService, { aiParser });

    expect(nativeRecognize).not.toHaveBeenCalled();
    expect(aiParser.parse).not.toHaveBeenCalled();

    await pressAndFlush(
      renderer.root.findByProps({
        accessibilityLabel: "Información sobre la interpretación con AI",
      }),
    );
    expect(normalizedScreenText(renderer)).toContain(
      "cantidades, formatos y marcas con modelos de OpenAI",
    );
    expect(normalizedScreenText(renderer)).toContain(
      "solo envía el texto transcrito a OpenAI, nunca el audio",
    );

    const aiSwitch = renderer.root.findByProps({
      accessibilityLabel: "Usar AI para interpretar la transcripción",
    });
    await act(() => {
      const onValueChange: unknown = aiSwitch.props.onValueChange;
      if (typeof onValueChange !== "function") {
        throw new TypeError("Missing onValueChange");
      }
      (onValueChange as (value: boolean) => void)(true);
    });
    expect(aiSwitch.props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });

    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    expect(nativeRecognize).toHaveBeenCalledOnce();
    expect(aiParser.parse).toHaveBeenCalledWith(
      "dos litros de leche",
      expect.any(AbortSignal),
    );
    expect(screenText(renderer)).toContain("dos litros de leche");
    expect(screenText(renderer)).toContain("nunca el audio");
  });

  it("uses the native transcriber and local parser without calling GPT when AI is off", async () => {
    const recognize = vi.fn().mockResolvedValue({
      transcript: "un kilo de judías verdes una docena de patatas",
      segments: ["un kilo de judías verdes", "una docena de patatas"],
    });
    const nativeService = serviceReturning(
      "un kilo de judías verdes una docena de patatas",
      ["un kilo de judías verdes", "una docena de patatas"],
      recognize,
    );
    const aiParser = { parse: vi.fn().mockResolvedValue([]) };
    const renderer = await renderPanel(nativeService, { aiParser });
    expect(
      renderer.root.findByProps({
        accessibilityLabel: "Usar AI para interpretar la transcripción",
      }).props.accessibilityState,
    ).toEqual({ checked: false, disabled: false });
    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    expect(recognize).toHaveBeenCalledOnce();
    expect(aiParser.parse).not.toHaveBeenCalled();
    expect(inputsByLabel(renderer, "Producto").map(inputValue)).toEqual([
      "Judias verdes",
      "Patatas",
    ]);
    expect(inputsByLabel(renderer, "Cantidad").map(inputValue)).toEqual([
      "1",
      "12",
    ]);
  });

  it("still requires native voice permissions with AI enabled", async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    const nativeService = serviceRejecting(
      new SpeechRecognitionError("PERMISSION_BLOCKED", "blocked"),
      openSettings,
    );
    const aiParser = { parse: vi.fn().mockResolvedValue([]) };
    const renderer = await renderPanel(nativeService, { aiParser });
    await enableAi(renderer);
    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    expect(aiParser.parse).not.toHaveBeenCalled();
    await pressAndFlush(buttonByText(renderer, "Abrir Ajustes"));
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("cancels native recognition with AI enabled before any GPT request", async () => {
    let complete: ((result: SpeechRecognitionResult) => void) | undefined;
    const cancel = vi.fn();
    const nativeService: SpeechRecognitionService = {
      ...serviceReturning(
        "pan",
        [],
        vi.fn(
          () =>
            new Promise<SpeechRecognitionResult>((resolve) => {
              complete = resolve;
            }),
        ),
      ),
      cancel,
    };
    const aiParser = { parse: vi.fn().mockResolvedValue([]) };
    const renderer = await renderPanel(nativeService, { aiParser });
    await enableAi(renderer);
    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    await pressAndFlush(buttonByText(renderer, "Cancelar"));
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => {
      complete?.({ transcript: "pan", segments: ["pan"] });
      await Promise.resolve();
    });
    expect(aiParser.parse).not.toHaveBeenCalled();
    expect(resultSelectors(renderer)).toHaveLength(0);
  });

  it("keeps text after an AI extraction failure and offers a local fallback", async () => {
    const aiParser = {
      parse: vi.fn().mockRejectedValue(new Error("AI ocupado")),
    };
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const renderer = await renderPanel(
      serviceReturning("dos litros de leche"),
      {
        aiParser,
        onConfirm,
      },
    );
    await enableAi(renderer);
    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    expect(screenText(renderer)).toContain("dos litros de leche");
    expect(screenText(renderer)).toContain("AI ocupado");
    expect(resultSelectors(renderer)).toHaveLength(0);
    await pressAndFlush(buttonByText(renderer, "Usar parser local"));
    expect(screenText(renderer)).toContain("Se ha utilizado el parser local");
    await pressAndFlush(buttonByText(renderer, "Añadir seleccionados"));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ product: "Leche", requestedQuantity: 2 }),
    ]);
  });

  it("retries AI on the saved full text without recording again and leaves ambiguous items unselected", async () => {
    const transcript = "leche de marca desconocida";
    const recognize = vi.fn().mockResolvedValue({
      transcript,
      segments: ["leche de", "marca desconocida"],
    });
    const aiParser = {
      parse: vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce([
          {
            rawText: transcript,
            product: "leche",
            confidence: "MEDIUM",
            source: "AI",
            needsReview: true,
            reviewReason: "Marca poco clara",
          },
        ]),
    };
    const renderer = await renderPanel(
      serviceReturning(transcript, [], recognize),
      {
        aiParser,
      },
    );
    await enableAi(renderer);
    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    await pressAndFlush(
      buttonByText(renderer, "Reintentar interpretación con AI"),
    );
    expect(recognize).toHaveBeenCalledOnce();
    expect(aiParser.parse).toHaveBeenCalledTimes(2);
    expect(aiParser.parse).toHaveBeenLastCalledWith(
      transcript,
      expect.any(AbortSignal),
    );
    expect(screenText(renderer)).toContain("Marca poco clara");
    expect(resultSelectors(renderer)[0]?.props.accessibilityState).toEqual({
      checked: false,
    });
  });

  it("cancels extraction and ignores a late result", async () => {
    let complete: ((items: readonly ShoppingIntentDraft[]) => void) | undefined;
    const aiParser = {
      parse: vi.fn(
        () =>
          new Promise<readonly ShoppingIntentDraft[]>((resolve) => {
            complete = resolve;
          }),
      ),
    };
    const renderer = await renderPanel(serviceReturning("pan"), {
      aiParser,
    });
    await enableAi(renderer);
    await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
    expect(screenText(renderer)).toContain("Interpretando productos con AI");
    await pressAndFlush(buttonByText(renderer, "Cancelar"));
    await act(async () => {
      complete?.([
        {
          rawText: "pan",
          product: "pan",
          confidence: "MEDIUM",
          source: "AI",
          needsReview: false,
        },
      ]);
      await Promise.resolve();
    });
    expect(resultSelectors(renderer)).toHaveLength(0);
    expect(screenText(renderer)).toContain("Petición cancelada");
  });

  it("shows native errors without producing a preview", async () => {
    const service = serviceRejecting(
      new SpeechRecognitionError("NATIVE_ERROR", "fallo del recognizer"),
    );
    const renderer = await renderPanel(service);
    expect(screenText(renderer)).toContain("Error de reconocimiento");
    expect(screenText(renderer)).toContain("fallo del recognizer");
    expect(resultSelectors(renderer)).toHaveLength(0);
  });

  it("handles an empty transcript", async () => {
    const renderer = await renderPanel(serviceReturning("   "));
    expect(screenText(renderer)).toContain(
      "No se ha reconocido ningún producto",
    );
    expect(resultSelectors(renderer)).toHaveLength(0);
  });

  it("previews multiple parsed items without auto-selecting MEDIUM results", async () => {
    const renderer = await renderPanel(
      serviceReturning("dos litros de leche, pan y seis huevos"),
    );
    expect(resultSelectors(renderer)).toHaveLength(3);
    expect(resultSelectors(renderer).map(accessibilityState)).toEqual([
      { checked: true },
      { checked: false },
      { checked: false },
    ]);
    const text = normalizedScreenText(renderer);
    expect(text).toContain("Resultado 3");
    expect(text).not.toContain("Producto 3");
    expect(inputsByLabel(renderer, "Producto")).toHaveLength(3);
  });

  it("keeps native pauses as product boundaries", async () => {
    const renderer = await renderPanel(
      serviceReturning("un kilo de judías verdes una docena de patatas", [
        "un kilo de judías verdes",
        "una docena de patatas",
      ]),
    );

    expect(resultSelectors(renderer)).toHaveLength(2);
    expect(inputsByLabel(renderer, "Producto").map(inputValue)).toEqual([
      "Judias verdes",
      "Patatas",
    ]);
    expect(inputsByLabel(renderer, "Cantidad").map(inputValue)).toEqual([
      "1",
      "12",
    ]);
  });

  it("renders four accurate cards for the noisy real-device transcript", async () => {
    const transcript =
      "quiero añadir tres garrafas de agua de 8 litros de dos cajas de un kilo de toma triturado y dos zonas de huevos y tres litros de leche";
    const renderer = await renderPanel(serviceReturning(transcript));

    expect(screenText(renderer)).toContain("Transcripción");
    expect(resultSelectors(renderer)).toHaveLength(4);
    expect(inputsByLabel(renderer, "Producto").map(inputValue)).toEqual([
      "Agua",
      "Tomate triturado",
      "Huevo",
      "Leche",
    ]);
    expect(inputsByLabel(renderer, "Envases").map(inputValue)).toEqual([
      "3",
      "2",
      "",
      "",
    ]);
    expect(inputsByLabel(renderer, "Tamaño").map(inputValue)).toEqual([
      "8",
      "1",
      "",
      "",
    ]);
    expect(inputsByLabel(renderer, "Cantidad").map(inputValue)).toEqual([
      "",
      "",
      "24",
      "3",
    ]);
  });

  it("capitalizes display values and keeps empty optional fields editable", async () => {
    const renderer = await renderPanel(serviceReturning("dos leches"));

    expect(inputByLabel(renderer, "Producto").props.value).toBe("Leche");
    expect(inputByLabel(renderer, "Variante").props.value).toBe("");
    expect(inputByLabel(renderer, "Marca").props.value).toBe("");
    expect(inputByLabel(renderer, "Unidad").props.value).toBe("");
    expect(inputByLabel(renderer, "Tipo de envase").props.value).toBe("");
    expect(screenText(renderer)).not.toContain("Producto 1");
    expect(screenText(renderer)).not.toContain("Cantidad 1");
  });

  it("shows non-default units with an initial capital", async () => {
    const renderer = await renderPanel(
      serviceReturning("dos litros de leche semidesnatada"),
    );

    expect(inputByLabel(renderer, "Unidad").props.value).toBe("L");
    expect(inputByLabel(renderer, "Variante").props.value).toBe(
      "semidesnatada",
    );
    expect(inputByLabel(renderer, "Marca").props.value).toBe("");
  });

  it.each([false, true])(
    "confirms details added to a product-only transcript with AI=%s",
    async (useAi) => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const aiParser = {
        parse: vi.fn().mockResolvedValue([
          {
            rawText: "leche",
            product: "leche",
            confidence: "MEDIUM",
            source: "AI",
            needsReview: false,
          },
        ]),
      };
      const renderer = await renderPanel(serviceReturning("leche"), {
        onConfirm,
        aiParser,
      });
      if (useAi) await enableAi(renderer);
      await pressAndFlush(buttonByText(renderer, "Empezar a escuchar"));
      for (const [label, value] of [
        ["Cantidad", "2"],
        ["Unidad", "l"],
        ["Marca", "Pascual"],
        ["Variante", "semidesnatada"],
      ]) {
        await act(() => {
          const input = inputByLabel(renderer, label!);
          const handler: unknown = input.props.onChangeText;
          if (typeof handler !== "function")
            throw new TypeError("Missing onChangeText");
          (handler as (text: string) => void)(value!);
        });
      }
      const selector = resultSelectors(renderer)[0]!;
      if (
        !(selector.props as { accessibilityState: { checked: boolean } })
          .accessibilityState.checked
      ) {
        await pressAndFlush(selector);
      }
      await pressAndFlush(buttonByText(renderer, "Añadir seleccionados"));
      expect(onConfirm).toHaveBeenCalledWith([
        expect.objectContaining({
          product: "Leche",
          requestedQuantity: 2,
          requestedUnit: "l",
          totalAmount: 2,
          brandPreference: "Pascual",
          variant: "semidesnatada",
        }),
      ]);
    },
  );

  it("makes LOW confidence explicit and requires selection", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const renderer = await renderPanel(serviceReturning("cuarto queso"), {
      onConfirm,
    });
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
      expect(screenText(renderer)).toContain(expected);
    },
  );
});

function serviceReturning(
  transcript: string,
  segments: readonly string[] = [transcript],
  recognize = vi.fn().mockResolvedValue({ transcript, segments }),
): SpeechRecognitionService {
  return {
    recognize,
    stop: vi.fn(),
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
    stop: vi.fn(),
    cancel: vi.fn(),
    openSettings,
  };
}

async function renderPanel(
  service: SpeechRecognitionService,
  overrides: Partial<React.ComponentProps<typeof VoiceShoppingPanel>> = {},
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <VoiceShoppingPanel
        adding={false}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        service={service}
        {...overrides}
      />,
    );
    await Promise.resolve();
  });
  return renderer!;
}

async function pressAndFlush(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    press(node);
    await Promise.resolve();
  });
}

async function enableAi(renderer: ReactTestRenderer): Promise<void> {
  await act(() => {
    const node = renderer.root.findByProps({
      accessibilityLabel: "Usar AI para interpretar la transcripción",
    });
    const handler: unknown = node.props.onValueChange;
    if (typeof handler !== "function")
      throw new TypeError("Missing switch handler");
    (handler as (value: boolean) => void)(true);
  });
}

function accessibilityState(node: ReactTestInstance): unknown {
  return (node.props as { accessibilityState?: unknown }).accessibilityState;
}

function inputValue(node: ReactTestInstance): unknown {
  return (node.props as { value?: unknown }).value;
}

function resultSelectors(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith("Seleccionar resultado"),
  );
}

function inputsByLabel(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance[] {
  return renderer.root.findAllByProps({ accessibilityLabel: label });
}

function inputByLabel(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance {
  return renderer.root.findByProps({ accessibilityLabel: label });
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

function normalizedScreenText(renderer: ReactTestRenderer): string {
  return screenText(renderer).replace(/\s+/g, " ");
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join(" ");
}
