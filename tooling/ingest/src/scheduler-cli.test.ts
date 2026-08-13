import { describe, expect, it } from "vitest";

import { assertSuccessfulTick } from "./scheduler-cli.js";

describe("assertSuccessfulTick", () => {
  it("accepts ticks whose jobs all succeeded", () => {
    expect(() =>
      assertSuccessfulTick({
        enqueuedCount: 2,
        maxJobsPerTick: 10,
        processed: 2,
        succeeded: 2,
        failed: 0,
        idle: true,
      }),
    ).not.toThrow();
  });

  it("fails CI when any scheduled job failed", () => {
    expect(() =>
      assertSuccessfulTick({
        enqueuedCount: 3,
        maxJobsPerTick: 10,
        processed: 3,
        succeeded: 2,
        failed: 1,
        idle: true,
      }),
    ).toThrow("1 of 3 scheduled ingestion jobs failed");
  });
});
