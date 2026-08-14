import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { hasSupermarketIcon, SupermarketIcon } from "./supermarket-icon";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("react-native-svg", () => ({
  default: "Svg",
  G: "G",
  Path: "Path",
  Rect: "Rect",
}));

describe("SupermarketIcon", () => {
  it.each(["DIA", "MERCADONA", "ALCAMPO", "EROSKI"])(
    "renders the configured vector logo for %s",
    (code) => {
      const renderer = renderIcon(code);

      expect(
        renderer.root.findByProps({
          testID: `supermarket-icon-${code.toLowerCase()}`,
        }),
      ).toBeDefined();
      expect(hasSupermarketIcon(code)).toBe(true);
    },
  );

  it("normalizes configured retailer codes", () => {
    expect(hasSupermarketIcon(" dia ")).toBe(true);
  });

  it("does not render anything for an unknown retailer", () => {
    const renderer = renderIcon("NUEVA_TIENDA");

    expect(renderer.toJSON()).toBeNull();
    expect(hasSupermarketIcon("NUEVA_TIENDA")).toBe(false);
    expect(hasSupermarketIcon(" ")).toBe(false);
  });
});

function renderIcon(code: string): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(<SupermarketIcon code={code} />);
  });

  if (!renderer) {
    throw new Error("The supermarket icon renderer was not created.");
  }

  return renderer;
}
