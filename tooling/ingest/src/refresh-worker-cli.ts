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
} from "./refresh-request-worker.js";

export async function main(): Promise<void> {
  const url = required("SUPABASE_URL");
  const secretKey = required("SUPABASE_SECRET_KEY");
  const workerId =
    process.env.REFRESH_WORKER_ID?.trim() || `${hostname()}:${process.pid}`;
  const queue = new SupabaseRefreshQueue({ url, secretKey });
  const store = new SupabaseIngestionStore({ url, secretKey });
  const logger = new JsonConsoleLogger();
  const outcome = await new RefreshRequestWorker(
    queue,
    new PipelineRefreshExecutor(store, logger),
    workerId,
  ).runOnce();
  console.log(
    JSON.stringify({ event: "refresh_worker.completed", outcome, workerId }),
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
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ event: "refresh_worker.failed", error: { message } }),
    );
    process.exitCode = 1;
  });
}
