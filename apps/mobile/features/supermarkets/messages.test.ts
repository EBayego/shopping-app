import { describe, expect, it } from "vitest";

import { supermarketAccuracyWarning } from "./messages";

describe("supermarket accuracy messages", () => {
  it("warns specifically about Eroski postal-code precision", () => {
    expect(supermarketAccuracyWarning("EROSKI")).toContain("código postal");
    expect(supermarketAccuracyWarning("EROSKI")).toContain(
      "quizá no sean los más precisos",
    );
  });

  it("shows a general accuracy warning for every other retailer", () => {
    expect(supermarketAccuracyWarning("MERCADONA")).toContain(
      "podrían no ser totalmente precisos",
    );
  });
});
