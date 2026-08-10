import { describe, expect, it, vi } from "vitest";

import {
  ScheduledIngestionRunner,
  SupabaseJobDispatcher,
  type JobDispatcher,
  type JobWorker,
} from "./scheduled-ingestion.js";

describe("ScheduledIngestionRunner", () => {
  it("continues with independent providers after one job fails", async () => {
    const dispatcher: JobDispatcher = {
      dispatchDue: vi
        .fn()
        .mockResolvedValue({ enqueuedCount: 3, maxJobsPerTick: 10 }),
    };
    const runOnce = vi
      .fn<JobWorker["runOnce"]>()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("succeeded")
      .mockResolvedValueOnce("succeeded")
      .mockResolvedValueOnce("idle");

    await expect(
      new ScheduledIngestionRunner(dispatcher, { runOnce }).runTick(),
    ).resolves.toEqual({
      enqueuedCount: 3,
      maxJobsPerTick: 10,
      processed: 3,
      succeeded: 2,
      failed: 1,
      idle: true,
    });
    expect(runOnce).toHaveBeenCalledTimes(4);
  });

  it("honours the centrally returned per-tick limit", async () => {
    const dispatcher: JobDispatcher = {
      dispatchDue: vi
        .fn()
        .mockResolvedValue({ enqueuedCount: 10, maxJobsPerTick: 2 }),
    };
    const runOnce = vi
      .fn<JobWorker["runOnce"]>()
      .mockResolvedValue("succeeded");

    const result = await new ScheduledIngestionRunner(dispatcher, {
      runOnce,
    }).runTick();

    expect(result.processed).toBe(2);
    expect(result.idle).toBe(false);
  });
});

describe("SupabaseJobDispatcher", () => {
  it("maps the dispatch RPC response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ enqueued_count: 4, max_jobs_per_tick: 25 }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const dispatcher = new SupabaseJobDispatcher({
      url: "https://project.supabase.co/",
      secretKey: "sb_secret_test-key",
      fetch,
    });

    await expect(dispatcher.dispatchDue()).resolves.toEqual({
      enqueuedCount: 4,
      maxJobsPerTick: 25,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/dispatch_due_provider_jobs",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test-key");
    expect(headers.has("Authorization")).toBe(false);
  });
});
