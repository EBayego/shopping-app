import { isRetailer, type Retailer } from "@shopping-app/domain";
import {
  ObservedIngestionError,
  silentLogger,
  PriceRefreshPipeline,
  RetailerIngestionPipeline,
  type PriceRefreshStore,
  type StructuredLogger,
} from "@shopping-app/ingestion";

import {
  createCatalogStrategy,
  createPriceRefreshStrategy,
} from "./provider-registry.js";

export interface RefreshRequest {
  id: string;
  retailer_code: string;
  request_type: "PRICE_REFRESH" | "CATALOG_SYNC";
  postal_code: string;
  product_ids: string[];
}

interface RefreshRequestRow {
  id: string;
  retailer_id: string;
  request_type: RefreshRequest["request_type"];
  postal_code: string;
  product_ids: string[];
  retailers?: { code?: unknown };
}

export interface RefreshQueue {
  claim(workerId: string): Promise<RefreshRequest | undefined>;
  complete(
    requestId: string,
    succeeded: boolean,
    error?: string,
  ): Promise<void>;
}

export interface RefreshExecutor {
  execute(request: RefreshRequest): Promise<void>;
}

export class RefreshRequestWorker {
  constructor(
    private readonly queue: RefreshQueue,
    private readonly executor: RefreshExecutor,
    private readonly workerId: string,
  ) {}

  async runOnce(): Promise<"idle" | "succeeded" | "failed"> {
    const request = await this.queue.claim(this.workerId);
    if (request === undefined) return "idle";
    try {
      await this.executor.execute(request);
      await this.queue.complete(request.id, true);
      return "succeeded";
    } catch (error) {
      await this.queue.complete(request.id, false, sanitizeError(error));
      return "failed";
    }
  }
}

export class PipelineRefreshExecutor implements RefreshExecutor {
  constructor(
    private readonly store: PriceRefreshStore,
    private readonly logger: StructuredLogger = silentLogger,
  ) {}

  async execute(request: RefreshRequest): Promise<void> {
    const retailer = parseRetailer(request.retailer_code);
    const startedAt = new Date();
    try {
      await this.executePipeline(request, retailer);
    } catch (error) {
      if (!(error instanceof ObservedIngestionError)) {
        const message = sanitizeError(error);
        try {
          await this.store.recordPreflightFailure?.({
            retailer,
            syncType: request.request_type,
            startedAt,
            finishedAt: new Date(),
            errorMessage: message,
          });
        } catch (observabilityError) {
          this.logger.error("ingestion.preflight_observability_failed", {
            retailer,
            strategy: request.request_type,
            error: { message: sanitizeError(observabilityError) },
          });
        }
      }
      throw error;
    }
  }

  private async executePipeline(
    request: RefreshRequest,
    retailer: Retailer,
  ): Promise<void> {
    if (request.request_type === "PRICE_REFRESH") {
      const result = await new PriceRefreshPipeline(
        createPriceRefreshStrategy(retailer),
        this.store,
        { logger: this.logger },
      ).refresh({
        postalCode: request.postal_code,
        ...(request.product_ids.length === 0
          ? {}
          : { productIds: request.product_ids }),
      });
      if (result.status !== "succeeded") {
        throw new ObservedIngestionError(
          new Error(
            `PRICE_REFRESH completed with status ${result.status} (${result.failures.length} failures)`,
          ),
        );
      }
      return;
    }
    const result = await new RetailerIngestionPipeline(
      createCatalogStrategy(retailer),
      this.store,
      { logger: this.logger },
    ).ingest({ postalCode: request.postal_code });
    if (result.status !== "succeeded") {
      throw new ObservedIngestionError(
        new Error(`CATALOG_SYNC completed with status ${result.status}`),
      );
    }
  }
}

export class SupabaseRefreshQueue implements RefreshQueue {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: {
    url: string;
    secretKey: string;
    fetch?: typeof globalThis.fetch;
  }) {
    this.baseUrl = options.url.replace(/\/$/, "");
    this.secretKey = options.secretKey;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async claim(workerId: string): Promise<RefreshRequest | undefined> {
    const rows = await this.request<RefreshRequestRow[]>(
      "/rest/v1/rpc/claim_refresh_request?select=id,retailer_id,request_type,postal_code,product_ids,retailers(code)",
      {
        method: "POST",
        body: JSON.stringify({ claiming_worker_id: workerId }),
      },
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const code = row.retailers?.code;
    if (typeof code !== "string") {
      throw new TypeError("Claimed refresh request has no retailer code");
    }
    return {
      id: row.id,
      retailer_code: code,
      request_type: row.request_type,
      postal_code: row.postal_code,
      product_ids: row.product_ids,
    };
  }

  async complete(
    requestId: string,
    succeeded: boolean,
    error?: string,
  ): Promise<void> {
    await this.request("/rest/v1/rpc/complete_refresh_request", {
      method: "POST",
      body: JSON.stringify({
        target_request_id: requestId,
        succeeded,
        completion_error: error ?? null,
      }),
    });
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.secretKey,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Refresh queue request failed (${response.status}): ${detail}`,
      );
    }
    const body = await response.text();
    return (body === "" ? undefined : JSON.parse(body)) as T;
  }
}

function parseRetailer(value: string): Retailer {
  if (!isRetailer(value)) throw new Error(`Unknown queued retailer: ${value}`);
  return value;
}

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(
      /(authorization|api[_-]?key|service[_-]?role|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 2000);
}
