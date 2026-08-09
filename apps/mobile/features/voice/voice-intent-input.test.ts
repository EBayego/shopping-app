import { describe, expect, it } from "vitest";

import { voiceDraftToIntentInput } from "./voice-intent-input";

describe("voiceDraftToIntentInput", () => {
  it("maps all structured parser fields for persistence", () => {
    expect(
      voiceDraftToIntentInput({
        rawText: "dos botellas de coca cola de dos litros",
        product: "coca cola",
        brandPreference: "Coca-Cola",
        packageCount: 2,
        packageSize: 2,
        packageUnit: "l",
        totalAmount: 4,
        confidence: "HIGH",
      }),
    ).toEqual({
      rawText: "dos botellas de coca cola de dos litros",
      normalizedName: "coca cola",
      packageCount: 2,
      packageSize: 2,
      packageUnit: "l",
      totalAmount: 4,
      brandPreference: "Coca-Cola",
    });
  });

  it("normalizes centilitres to the database-supported millilitres", () => {
    expect(
      voiceDraftToIntentInput({
        rawText: "dos latas de cerveza de 33 cl",
        product: "cerveza",
        packageCount: 2,
        packageSize: 33,
        packageUnit: "cl",
        totalAmount: 66,
        confidence: "HIGH",
      }),
    ).toMatchObject({ packageSize: 330, packageUnit: "ml", totalAmount: 660 });
  });
});
