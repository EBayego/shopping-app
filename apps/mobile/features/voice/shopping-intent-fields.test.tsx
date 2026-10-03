import { describe, expect, it, vi } from "vitest";
import {
  draftToFieldValues,
  fieldValuesToDraft,
} from "./shopping-intent-fields";
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(value: T) => value },
  Text: "Text",
  View: "View",
  TextInput: "TextInput",
  Pressable: "Pressable",
}));

describe("shopping intent field contracts", () => {
  it("round-trips implicit unit quantities and packs with unit sizes", () => {
    const draft = {
      rawText: "dos packs de seis yogures",
      product: "yogur",
      packageCount: 2,
      packageSize: 6,
      packageUnit: "unit" as const,
      packageType: "pack" as const,
      confidence: "MEDIUM" as const,
    };
    expect(fieldValuesToDraft(draftToFieldValues(draft), draft)).toMatchObject({
      packageType: "pack",
      packageUnit: "unit",
      totalAmount: 12,
    });
    const count = {
      rawText: "seis huevos",
      product: "huevo",
      requestedQuantity: 6,
      requestedUnit: "unit" as const,
      confidence: "HIGH" as const,
    };
    expect(fieldValuesToDraft(draftToFieldValues(count), count)).toMatchObject({
      requestedQuantity: 6,
      requestedUnit: "unit",
      totalAmount: 6,
    });
  });
  it("clears optional fields instead of silently restoring their source values", () => {
    const draft = {
      rawText: "leche Pascual",
      product: "leche",
      brandPreference: "Pascual",
      packageType: "carton" as const,
      confidence: "HIGH" as const,
    };
    expect(
      fieldValuesToDraft(
        { ...draftToFieldValues(draft), brandPreference: "", packageType: "" },
        draft,
      ),
    ).not.toHaveProperty("brandPreference");
    expect(
      fieldValuesToDraft(
        { ...draftToFieldValues(draft), packageType: "" },
        draft,
      ),
    ).not.toHaveProperty("packageType");
  });
});
