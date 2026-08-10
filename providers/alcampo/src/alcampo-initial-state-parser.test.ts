import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AlcampoInitialStateError,
  AlcampoInitialStateParser,
} from "./alcampo-initial-state-parser.js";

describe("AlcampoInitialStateParser", () => {
  const parser = new AlcampoInitialStateParser();

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
