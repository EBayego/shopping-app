import {
  ProviderContractChangedError,
  ProviderUnavailableError,
} from "@shopping-app/retailer-contracts";
import { describe, expect, it, vi } from "vitest";

import { silentLogger } from "./logger.js";
import { CircuitOpenError, ProviderExecutor } from "./resilience.js";

function executor(overrides: { failureThreshold?: number } = {}) {
  return new ProviderExecutor(
    "DIA",
    1,
    { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 10, jitterRatio: 0 },
    { failureThreshold: overrides.failureThreshold ?? 2, resetAfterMs: 30_000 },
    silentLogger,
    () => new Date("2026-08-09T10:00:00Z"),
    () => Promise.resolve(),
    () => 0.5,
  );
}

describe("ProviderExecutor", () => {
  it("opens the circuit after the configured transient failures", async () => {
    const subject = executor({ failureThreshold: 2 });
    const action = vi.fn(() =>
      Promise.reject(new ProviderUnavailableError("DIA")),
    );
    await expect(subject.run("search", action)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    await expect(subject.run("search", action)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    await expect(subject.run("search", action)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("does not retry or count permanent contract errors", async () => {
    const subject = executor({ failureThreshold: 1 });
    const action = vi.fn(() =>
      Promise.reject(new ProviderContractChangedError("DIA")),
    );
    await expect(subject.run("search", action)).rejects.toBeInstanceOf(
      ProviderContractChangedError,
    );
    await expect(subject.run("search", action)).rejects.toBeInstanceOf(
      ProviderContractChangedError,
    );
    expect(action).toHaveBeenCalledTimes(2);
  });
});
