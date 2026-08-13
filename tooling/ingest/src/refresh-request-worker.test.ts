import { describe, expect, it, vi } from "vitest";
import type { PriceRefreshStore } from "@shopping-app/ingestion";

import {
  RefreshRequestWorker,
  PipelineRefreshExecutor,
  sanitizeError,
  SupabaseRefreshQueue,
  type RefreshExecutor,
  type RefreshQueue,
} from "./refresh-request-worker.js";

const request = {
  id: "request-1",
  retailer_code: "DIA",
  request_type: "PRICE_REFRESH" as const,
  postal_code: "50009",
  product_ids: ["sku-1"],
};

describe("RefreshRequestWorker", () => {
  it("claims, executes and completes a request", async () => {
    const claim = vi.fn().mockResolvedValue(request);
    const complete = vi.fn().mockResolvedValue("succeeded" as const);
    const queue: RefreshQueue = {
      claim,
      complete,
    };
    const execute = vi.fn().mockResolvedValue(undefined);
    const executor: RefreshExecutor = {
      execute,
    };
    const worker = new RefreshRequestWorker(queue, executor, "worker-1");

    await expect(worker.runOnce()).resolves.toBe("succeeded");
    expect(claim).toHaveBeenCalledWith("worker-1");
    expect(execute).toHaveBeenCalledWith(request);
    expect(complete).toHaveBeenCalledWith("request-1", true);
  });

  it("records a redacted failure without leaking credentials", async () => {
    const complete = vi.fn().mockResolvedValue("failed" as const);
    const queue: RefreshQueue = {
      claim: vi.fn().mockResolvedValue(request),
      complete,
    };
    const executor: RefreshExecutor = {
      execute: vi
        .fn()
        .mockRejectedValue(new Error("token=top-secret provider failed")),
    };
    const worker = new RefreshRequestWorker(queue, executor, "worker-1");

    await expect(worker.runOnce()).resolves.toBe("failed");
    expect(complete).toHaveBeenCalledWith(
      "request-1",
      false,
      "token=[REDACTED] provider failed",
    );
  });

  it("reports a scheduled retry separately from a terminal failure", async () => {
    const complete = vi.fn().mockResolvedValue("retry_scheduled" as const);
    const queue: RefreshQueue = {
      claim: vi.fn().mockResolvedValue(request),
      complete,
    };
    const worker = new RefreshRequestWorker(
      queue,
      { execute: vi.fn().mockRejectedValue(new Error("temporary failure")) },
      "worker-1",
    );

    await expect(worker.runOnce()).resolves.toBe("retry_scheduled");
    expect(complete).toHaveBeenCalledWith(
      "request-1",
      false,
      "temporary failure",
    );
  });

  it("does nothing when the queue is empty", async () => {
    const queue: RefreshQueue = {
      claim: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue("succeeded" as const),
    };
    const execute = vi.fn();
    const executor: RefreshExecutor = { execute };
    await expect(
      new RefreshRequestWorker(queue, executor, "worker-1").runOnce(),
    ).resolves.toBe("idle");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("sanitizeError", () => {
  it("redacts secret-shaped values", () => {
    expect(sanitizeError("Authorization: Bearer123 password=hunter2")).toBe(
      "Authorization=[REDACTED] password=[REDACTED]",
    );
  });
});

describe("SupabaseRefreshQueue authentication", () => {
  it("uses the opaque backend key only as apikey", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const queue = new SupabaseRefreshQueue({
      url: "https://project.supabase.co",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    await expect(queue.claim("worker-1")).resolves.toBeUndefined();
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test-key");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("maps a pending completion to a scheduled retry", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ status: "PENDING" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const queue = new SupabaseRefreshQueue({
      url: "https://project.supabase.co",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    await expect(
      queue.complete("request-1", false, "temporary failure"),
    ).resolves.toBe("retry_scheduled");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://project.supabase.co/rest/v1/rpc/complete_refresh_request?select=status",
    );
  });
});

describe("PipelineRefreshExecutor observability", () => {
  it("records a preflight run and health when execution fails before opening a pipeline run", async () => {
    const recordPreflightFailure = vi
      .fn<NonNullable<PriceRefreshStore["recordPreflightFailure"]>>()
      .mockResolvedValue(undefined);
    const store: PriceRefreshStore = {
      resolveRetailer: vi.fn(),
      upsertMarket: vi.fn(),
      findMarketId: vi.fn(),
      startSyncRun: vi.fn(),
      upsertProducts: vi.fn(),
      upsertOffers: vi.fn(),
      recordCatalogProductMisses: vi.fn(),
      deactivateProducts: vi.fn(),
      finishSyncRun: vi.fn(),
      updateProviderHealth: vi.fn(),
      listPriceRefreshCandidates: vi.fn(),
      getOfferFreshnessConfig: vi.fn(),
      recordPreflightFailure,
    };

    await expect(
      new PipelineRefreshExecutor(store).execute({
        ...request,
        retailer_code: "EROSKI",
        request_type: "CATALOG_SYNC",
        postal_code: "",
      }),
    ).rejects.toThrow(
      "Provider EROSKI could not resolve market for postal code",
    );
    expect(recordPreflightFailure).toHaveBeenCalledOnce();
    const recorded = recordPreflightFailure.mock.calls[0]?.[0];
    expect(recorded).toMatchObject({
      retailer: "EROSKI",
      syncType: "CATALOG_SYNC",
    });
    expect(recorded?.errorMessage).toContain(
      "Provider EROSKI could not resolve market for postal code",
    );
    expect(recorded?.startedAt).toBeInstanceOf(Date);
    expect(recorded?.finishedAt).toBeInstanceOf(Date);
  });
});
