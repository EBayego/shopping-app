export interface DispatchResult {
  enqueuedCount: number;
  maxJobsPerTick: number;
}

export interface JobDispatcher {
  dispatchDue(): Promise<DispatchResult>;
}

export interface JobWorker {
  runOnce(): Promise<"idle" | "succeeded" | "retry_scheduled" | "failed">;
}

export interface SchedulerTickResult extends DispatchResult {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  idle: boolean;
}

export class ScheduledIngestionRunner {
  constructor(
    private readonly dispatcher: JobDispatcher,
    private readonly worker: JobWorker,
  ) {}

  async runTick(): Promise<SchedulerTickResult> {
    const dispatched = await this.dispatcher.dispatchDue();
    let processed = 0;
    let succeeded = 0;
    let retried = 0;
    let failed = 0;
    let idle = false;

    while (processed < dispatched.maxJobsPerTick) {
      const outcome = await this.worker.runOnce();
      if (outcome === "idle") {
        idle = true;
        break;
      }
      processed += 1;
      if (outcome === "succeeded") succeeded += 1;
      else if (outcome === "retry_scheduled") retried += 1;
      else failed += 1;
    }

    return { ...dispatched, processed, succeeded, retried, failed, idle };
  }
}

interface DispatchRow {
  enqueued_count: number;
  max_jobs_per_tick: number;
}

export class SupabaseJobDispatcher implements JobDispatcher {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(
    private readonly options: {
      url: string;
      secretKey: string;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    this.baseUrl = options.url.replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async dispatchDue(): Promise<DispatchResult> {
    const response = await this.fetch(
      `${this.baseUrl}/rest/v1/rpc/dispatch_due_provider_jobs`,
      {
        method: "POST",
        headers: {
          apikey: this.options.secretKey,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Scheduled job dispatch failed (${response.status}): ${detail}`,
      );
    }
    const rows = (await response.json()) as DispatchRow[];
    const row = rows[0];
    if (row === undefined) {
      throw new Error("Scheduled job dispatch returned no configuration");
    }
    return {
      enqueuedCount: row.enqueued_count,
      maxJobsPerTick: row.max_jobs_per_tick,
    };
  }
}
