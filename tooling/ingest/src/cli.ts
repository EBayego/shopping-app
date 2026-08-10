import { pathToFileURL } from "node:url";

import {
  JsonConsoleLogger,
  PriceRefreshPipeline,
  RetailerIngestionPipeline,
  SupabaseIngestionStore,
  type IngestionStore,
} from "@shopping-app/ingestion";

import { parseIngestArguments } from "./arguments.js";
import {
  createPriceRefreshStrategy,
  createSearchStrategy,
} from "./provider-registry.js";

const unavailableStore: IngestionStore = new Proxy({} as IngestionStore, {
  get() {
    return () =>
      Promise.reject(new Error("Persistence is unavailable in dry-run"));
  },
});

export async function main(args: readonly string[]): Promise<void> {
  const options = parseIngestArguments(args);
  const logger = new JsonConsoleLogger();
  const result =
    options.operation === "refresh"
      ? await new PriceRefreshPipeline(
          createPriceRefreshStrategy(options.provider),
          createStoreFromEnvironment(),
          { logger },
        ).refresh({
          postalCode: options.postalCode,
          dryRun: options.dryRun,
          ...(options.productIds === undefined
            ? {}
            : { productIds: options.productIds }),
        })
      : await new RetailerIngestionPipeline(
          createSearchStrategy(options.provider),
          options.dryRun ? unavailableStore : createStoreFromEnvironment(),
          { logger },
        ).ingest({
          postalCode: options.postalCode,
          query: options.query,
          dryRun: options.dryRun,
        });
  console.log(JSON.stringify({ event: "ingestion.result", ...result }));
}

function createStoreFromEnvironment(): SupabaseIngestionStore {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (url === undefined || secretKey === undefined) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY are required for persistence and refresh selection",
    );
  }
  return new SupabaseIngestionStore({ url, secretKey });
}

const executedFile = process.argv[1];
if (
  executedFile !== undefined &&
  import.meta.url === pathToFileURL(executedFile).href
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ event: "ingestion.cli_failed", error: { message } }),
    );
    process.exitCode = 1;
  });
}
