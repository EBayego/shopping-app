import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { QuickAddPanel } from "./quick-add-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  TextInput: "TextInput",
  StyleSheet: { create: <T,>(styles: T) => styles },
}));

async function mount(onAdd: (text: string) => Promise<unknown>) {
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(
      <QuickAddPanel adding={false} onAdd={onAdd} onVoicePress={vi.fn()} />,
    );
  });
  return renderer!;
}
function input(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ accessibilityLabel: "Añadir a la lista" });
}
describe("quick add", () => {
  it("adds the exact custom name and clears only after success", async () => {
    const onAdd = vi.fn(() => Promise.resolve());
    const renderer = await mount(onAdd);
    await act(() => {
      (input(renderer).props.onChangeText as (value: string) => void)(
        "Leche para casa",
      );
    });
    const tile = renderer.root.findByProps({
      accessibilityLabel: "Añadir Leche para casa",
    });
    await act(async () => {
      await (tile.props.onPress as () => Promise<void>)();
    });
    expect(onAdd).toHaveBeenCalledWith("Leche para casa");
    expect(input(renderer).props.value).toBe("");
  });
  it("preserves the draft when the local write fails", async () => {
    const renderer = await mount(() =>
      Promise.reject(new Error("storage failed")),
    );
    await act(() => {
      (input(renderer).props.onChangeText as (value: string) => void)(
        "Mi producto",
      );
    });
    await act(async () => {
      await (input(renderer).props.onSubmitEditing as () => Promise<void>)();
    });
    expect(input(renderer).props.value).toBe("Mi producto");
  });
});
