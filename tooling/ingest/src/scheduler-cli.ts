import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

import {
  JsonConsoleLogger,
  SupabaseIngestionStore,
} from "@shopping-app/ingestion";

import {
  PipelineRefreshExecutor,
  RefreshRequestWorker,
  SupabaseRefreshQueue,
  sanitizeError,
} from "./refresh-request-worker.js";
import {
  ScheduledIngestionRunner,
  SupabaseJobDispatcher,
} from "./scheduled-ingestion.js";

export async function main(): Promise<void> {
  const url = required("SUPABASE_URL");
  const secretKey = required("SUPABASE_SECRET_KEY");
  const workerId =
    process.env.REFRESH_WORKER_ID?.trim() || `${hostname()}:${process.pid}`;
  const logger = new JsonConsoleLogger();
  const queue = new SupabaseRefreshQueue({ url, secretKey });
  const store = new SupabaseIngestionStore({ url, secretKey });
  const result = await new ScheduledIngestionRunner(
    new SupabaseJobDispatcher({ url, secretKey }),
    new RefreshRequestWorker(
      queue,
      new PipelineRefreshExecutor(store, logger),
      workerId,
    ),
  ).runTick();
  console.log(
    JSON.stringify({
      event: "ingestion_scheduler.completed",
      workerId,
      ...result,
    }),
  );
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "")
    throw new Error(`${name} is required`);
  return value;
}

const executedFile = process.argv[1];
if (
  executedFile !== undefined &&
  import.meta.url === pathToFileURL(executedFile).href
) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "ingestion_scheduler.failed",
        error: { message: sanitizeError(error) },
      }),
    );
    process.exitCode = 1;
  });
}
