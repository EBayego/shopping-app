import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductSearchPanel } from "./product-search-panel";
import type { ProductSearchResult } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  state: {
    data: undefined as readonly ProductSearchResult[] | undefined,
    error: null as Error | null,
    isError: false,
    isFetching: false,
  },
}));

vi.mock("./queries", () => ({
  useProductSearchQuery: (shoppingListId: string, query: string) => {
    mocks.query(shoppingListId, query);
    return { ...mocks.state, refetch: mocks.refetch };
  },
}));

const result: ProductSearchResult = {
  concept: {
    id: "concept-1",
    name: "Leche semidesnatada",
    normalizedName: "leche semidesnatada",
    category: "Lácteos",
    defaultAmount: 1,
    defaultUnit: "l",
    selectionPolicy: "CHEAPEST_COVERING",
  },
  retailerProducts: [
    {
      id: "product-1",
      retailerId: "retailer-1",
      externalId: "milk-1",
      name: "Leche semidesnatada Hacendado",
      brand: "Hacendado",
      gtin: null,
      packageSize: 1,
      packageUnit: "l",
      packageCount: null,
      imageUrl: "https://example.test/milk.png",
      productUrl: null,
      classificationConfidence: "HIGH",
      standard: true,
    },
  ],
  offers: [
    {
      retailer: { id: "retailer-1", code: "DIA", name: "DIA" },
      retailerProduct: {
        id: "product-1",
        externalId: "milk-1",
        name: "Leche semidesnatada Hacendado",
        brand: "Hacendado",
        imageUrl: "https://example.test/milk.png",
        productUrl: null,
      },
      price: 0.84,
      normalPrice: 0.84,
      promoPrice: null,
      pricePerUnit: 0.84,
      referenceUnit: "l",
      promotion: { type: "fixed_price", text: "Oferta semanal" },
      requiresMembership: false,
      availability: true,
      observedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
      freshness: "FRESH",
      market: { id: "market-1", externalId: "dia-madrid", name: "Madrid" },
    },
  ],
};

describe("ProductSearchPanel interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.state.data = undefined;
    mocks.state.error = null;
    mocks.state.isError = false;
    mocks.state.isFetching = false;
  });

  it("debounces text before searching the backend", async () => {
    vi.useFakeTimers();
    const renderer = await renderPanel();
    await act(() => {
      changeText(searchInput(renderer), "leche");
    });
    expect(mocks.query).not.toHaveBeenLastCalledWith("list-1", "leche");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(mocks.query).toHaveBeenLastCalledWith("list-1", "leche");
  });

  it("shows an empty catalog result while preserving free entry", async () => {
    mocks.state.data = [];
    const renderer = await searchedPanel("regalo para Marta");
    expect(screenText(renderer)).toContain("Sin resultados de catálogo");
    expect(screenText(renderer)).toContain("como item libre");
  });

  it("selects a product concept", async () => {
    mocks.state.data = [result];
    const onSelectProduct = vi.fn();
    const renderer = await searchedPanel("leche", { onSelectProduct });
    await act(() => {
      press(
        renderer.root.findByProps({
          accessibilityLabel: "Añadir Leche semidesnatada",
        }),
      );
    });
    expect(onSelectProduct).toHaveBeenCalledWith(result);
  });

  it("adds unmatched text as a free item", async () => {
    mocks.state.data = [];
    const onAddFreeItem = vi.fn();
    const renderer = await searchedPanel("regalo para Marta", {
      onAddFreeItem,
    });
    await act(() => press(buttonByText(renderer, "como item libre")));
    expect(onAddFreeItem).toHaveBeenCalledWith("regalo para Marta");
  });

  it("offers voice entry from the end of the search field", async () => {
    const onVoicePress = vi.fn();
    const renderer = await renderPanel({ onVoicePress, onClose: undefined });

    await act(() => {
      press(
        renderer.root.findByProps({
          accessibilityLabel: "Añadir productos por voz",
        }),
      );
    });

    expect(onVoicePress).toHaveBeenCalledOnce();
    expect(screenText(renderer)).not.toContain("Añadir producto");
  });

  it("renders retailer offer details without claiming real-time pricing", async () => {
    mocks.state.data = [result];
    const renderer = await searchedPanel("leche");
    const text = normalizedScreenText(renderer);
    expect(text).toContain("DIA");
    expect(text).toContain("0,84 €");
    expect(text).toContain("0,84 €/L");
    expect(text).toContain("Oferta semanal");
    expect(text).toContain("Disponible");
    expect(text).toContain("Actualizado hace 2 h");
    expect(text).not.toContain("tiempo real");
  });

  it("marks stale offers discreetly", async () => {
    mocks.state.data = [
      {
        ...result,
        offers: [{ ...result.offers[0]!, freshness: "VERY_STALE" }],
      },
    ];
    const renderer = await searchedPanel("leche");
    expect(screenText(renderer)).toContain("Dato antiguo");
  });

  it("shows an error and retries the backend query", async () => {
    mocks.state.error = new Error("network unavailable");
    mocks.state.isError = true;
    const renderer = await searchedPanel("leche");
    expect(screenText(renderer)).toContain("No se pudo completar la búsqueda");
    await act(() => press(buttonByText(renderer, "Reintentar búsqueda")));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});

async function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ProductSearchPanel>> = {},
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(
      <ProductSearchPanel
        adding={false}
        onAddFreeItem={vi.fn()}
        onClose={vi.fn()}
        onSelectProduct={vi.fn()}
        shoppingListId="list-1"
        {...overrides}
      />,
    );
  });
  return renderer!;
}

async function searchedPanel(
  query: string,
  overrides: Partial<React.ComponentProps<typeof ProductSearchPanel>> = {},
): Promise<ReactTestRenderer> {
  vi.useFakeTimers();
  const renderer = await renderPanel(overrides);
  await act(() => {
    changeText(searchInput(renderer), query);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  return renderer;
}

function searchInput(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByProps({ accessibilityLabel: "Buscar producto" });
}

function changeText(node: ReactTestInstance, value: string): void {
  const handler: unknown = node.props.onChangeText;
  if (typeof handler !== "function")
    throw new TypeError("Missing onChangeText");
  const changeHandler = handler as (nextValue: string) => void;
  changeHandler(value);
}

function press(node: ReactTestInstance): void {
  const handler: unknown = node.props.onPress;
  if (typeof handler !== "function") throw new TypeError("Missing onPress");
  const pressHandler = handler as () => void;
  pressHandler();
}

function buttonByText(
  renderer: ReactTestRenderer,
  expected: string,
): ReactTestInstance {
  return renderer.root
    .findAll((node) => node.props.accessibilityRole === "button")
    .find((node) => textOf(node).includes(expected))!;
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
