import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AlcampoInitialStateError,
  AlcampoInitialStateParser,
} from "./alcampo-initial-state-parser.js";

describe("AlcampoInitialStateParser", () => {
  const parser = new AlcampoInitialStateParser();

  it("extracts complete catalogue identities beyond the SSR product entities", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const state = {
      data: {
        products: {
          productEntities: {
            [first]: { productId: first, retailerProductId: "54180" },
          },
          catalogue: {
            data: {
              productGroups: [
                { products: [first] },
                { products: [first, second] },
              ],
              totalProducts: 2,
            },
          },
        },
      },
    };
    const html = `<script data-test="initial-state-script">window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`;
    const listing = parser.parseProductListing(html);
    expect(listing.productIds).toEqual([first, second]);
    expect([...listing.internalProductIds]).toEqual([["54180", first]]);
  });

  it.each([
    { productGroups: [{ products: ["invalid"] }], totalProducts: 1 },
    { productGroups: [], totalProducts: 3 },
    { productGroups: "invalid" },
  ])("rejects incompatible or truncated complete catalogues", (data) => {
    const html = `<script data-test="initial-state-script">window.__INITIAL_STATE__=${JSON.stringify({ data: { products: { catalogue: { data } } } })}</script>`;
    expect(() => parser.parseProductListing(html)).toThrow(
      AlcampoInitialStateError,
    );
  });

  it("extrae visitor y CSRF del estado SSR confirmado", () => {
    const html = readFileSync(
      new URL("./fixtures/bootstrap-home.html", import.meta.url),
      "utf8",
    );
    expect(parser.parseSession(html)).toEqual({
      csrfToken: "00000000-0000-4000-8000-000000000010",
      visitorId: "00000000-0000-4000-8000-000000000011",
      assetVersion: "2.0.0-fixture",
    });
  });

  it("rechaza estado ausente, asignación incompatible y JSON inválido", () => {
    expect(() => parser.parseSession("<html></html>")).toThrow(
      AlcampoInitialStateError,
    );
    expect(() =>
      parser.parseSession(
        '<script data-test="initial-state-script">not-state</script>',
      ),
    ).toThrow(AlcampoInitialStateError);
    expect(() =>
      parser.parseSession(
        '<script data-test="initial-state-script">window.__INITIAL_STATE__={</script>',
      ),
    ).toThrow(AlcampoInitialStateError);
  });
});
