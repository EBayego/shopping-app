import {
  ProviderContractChangedError,
  ProviderUnavailableError,
} from "@shopping-app/retailer-contracts";
import { describe, expect, it, vi } from "vitest";

import { silentLogger } from "./logger.js";
import { CircuitOpenError, ProviderExecutor, safeError } from "./resilience.js";

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

  it("allows all retries and counts one failure per exhausted operation", async () => {
    const subject = new ProviderExecutor(
      "ALCAMPO",
      1,
      { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, jitterRatio: 0 },
      { failureThreshold: 2, resetAfterMs: 30_000 },
      silentLogger,
      () => new Date("2026-10-04T10:00:00Z"),
      () => Promise.resolve(),
      () => 0.5,
    );
    const action = vi.fn(() =>
      Promise.reject(new ProviderUnavailableError("ALCAMPO")),
    );
    await expect(subject.run("refresh_price", action)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(action).toHaveBeenCalledTimes(3);
    await expect(subject.run("refresh_price", action)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(action).toHaveBeenCalledTimes(6);
    await expect(subject.run("refresh_price", action)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(action).toHaveBeenCalledTimes(6);
  });

  it("does not open the circuit when a retry recovers", async () => {
    const subject = new ProviderExecutor(
      "ALCAMPO",
      1,
      { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, jitterRatio: 0 },
      { failureThreshold: 1, resetAfterMs: 30_000 },
      silentLogger,
      () => new Date("2026-10-04T10:00:00Z"),
      () => Promise.resolve(),
      () => 0.5,
    );
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ProviderUnavailableError("ALCAMPO"))
      .mockResolvedValue("offer");
    await expect(subject.run("refresh_price", action)).resolves.toBe("offer");
    await expect(subject.run("refresh_price", action)).resolves.toBe("offer");
    expect(action).toHaveBeenCalledTimes(3);
  });
});

describe("safeError", () => {
  it("keeps HTTP and network diagnostics without exposing cause messages or headers", () => {
    const transport = Object.assign(new Error("cookie=session-secret"), {
      kind: "http",
      status: 403,
      headers: { authorization: "secret" },
    });
    expect(
      safeError(new ProviderUnavailableError("DIA", { cause: transport })),
    ).toEqual({
      name: "ProviderUnavailableError",
      message: "Provider DIA is unavailable",
      httpStatus: 403,
      transportKind: "http",
    });
    const network = Object.assign(new Error("token=secret"), {
      code: "ECONNRESET",
    });
    expect(safeError(new Error("fetch failed", { cause: network }))).toEqual({
      name: "Error",
      message: "fetch failed",
      networkCode: "ECONNRESET",
    });
  });

  it("handles cyclic causes and aggregate connection errors", () => {
    const error = new Error("fetch failed");
    error.cause = error;
    expect(safeError(error)).toEqual({
      name: "Error",
      message: "fetch failed",
    });
    const connection = Object.assign(new Error("private host"), {
      code: "ETIMEDOUT",
    });
    expect(
      safeError(
        new Error("fetch failed", { cause: new AggregateError([connection]) }),
      ),
    ).toMatchObject({ networkCode: "ETIMEDOUT" });
  });
});
