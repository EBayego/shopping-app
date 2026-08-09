import { describe, expect, it } from "vitest";

import { parseArguments } from "./arguments.js";

describe("parseArguments", () => {
  it("parsea una búsqueda y normaliza el provider", () => {
    expect(
      parseArguments([
        "--provider",
        "dia",
        "--postal-code",
        "50009",
        "--query",
        "leche",
      ]),
    ).toEqual({
      provider: "DIA",
      postalCode: "50009",
      query: "leche",
    });
  });

  it("parsea la consulta directa de producto", () => {
    expect(
      parseArguments([
        "--provider",
        "eroski",
        "--postal-code",
        "50009",
        "--product",
        "261354",
      ]),
    ).toEqual({
      provider: "EROSKI",
      postalCode: "50009",
      product: "261354",
    });
  });

  it("parsea las capabilities de catálogo", () => {
    expect(
      parseArguments([
        "--provider",
        "mercadona",
        "--postal-code",
        "50009",
        "--categories",
      ]),
    ).toEqual({
      provider: "MERCADONA",
      postalCode: "50009",
      categories: true,
    });
    expect(
      parseArguments([
        "--provider",
        "mercadona",
        "--postal-code",
        "50009",
        "--category",
        "72",
      ]),
    ).toEqual({
      provider: "MERCADONA",
      postalCode: "50009",
      category: "72",
    });
  });

  it.each([
    [["--provider", "unknown", "--postal-code", "50009", "--query", "x"]],
    [["--provider", "dia", "--query", "x"]],
    [
      [
        "--provider",
        "dia",
        "--postal-code",
        "50009",
        "--query",
        "x",
        "--product",
        "1",
      ],
    ],
    [["--provider", "dia", "--postal-code", "50009", "--other", "x"]],
  ])("rechaza argumentos inválidos: %j", (args) => {
    expect(() => parseArguments(args)).toThrow();
  });
});
