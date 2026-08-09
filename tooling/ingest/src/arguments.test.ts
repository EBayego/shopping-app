import { describe, expect, it } from "vitest";

import { parseIngestArguments } from "./arguments.js";

describe("parseIngestArguments", () => {
  it("parses search ingestion and dry-run", () => {
    expect(
      parseIngestArguments([
        "--provider",
        "dia",
        "--postal-code",
        "50009",
        "--query",
        "leche",
        "--dry-run",
      ]),
    ).toEqual({
      operation: "search",
      provider: "DIA",
      postalCode: "50009",
      query: "leche",
      dryRun: true,
    });
  });

  it("parses refresh with explicit product ids", () => {
    expect(
      parseIngestArguments([
        "refresh",
        "--provider",
        "dia",
        "--postal-code",
        "50009",
        "--product-id",
        "one",
        "--product-id",
        "two",
        "--dry-run",
      ]),
    ).toEqual({
      operation: "refresh",
      provider: "DIA",
      postalCode: "50009",
      productIds: ["one", "two"],
      dryRun: true,
    });
  });

  it("rejects missing required arguments", () => {
    expect(() => parseIngestArguments(["--provider", "dia"])).toThrow(
      "Missing postal code",
    );
  });
});
