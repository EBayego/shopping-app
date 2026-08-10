import { isRetailer, type Retailer } from "@shopping-app/domain";

interface BaseArguments {
  provider: Retailer;
  postalCode: string;
  dryRun: boolean;
}

export type IngestArguments =
  | (BaseArguments & { operation: "search"; query: string })
  | (BaseArguments & {
      operation: "catalog";
      categoryIds?: readonly string[];
    })
  | (BaseArguments & { operation: "refresh"; productIds?: readonly string[] });

export function parseIngestArguments(args: readonly string[]): IngestArguments {
  const operation =
    args[0] === "refresh"
      ? "refresh"
      : args[0] === "catalog"
        ? "catalog"
        : "search";
  const flags = operation === "search" ? args : args.slice(1);
  let provider: string | undefined;
  let postalCode: string | undefined;
  let query: string | undefined;
  const productIds: string[] = [];
  const categoryIds: string[] = [];
  let dryRun = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (
      flag !== "--provider" &&
      flag !== "--postal-code" &&
      flag !== "--query" &&
      flag !== "--product-id" &&
      flag !== "--category-id"
    ) {
      throw new Error(`Unknown argument: ${flag ?? "missing"}`);
    }
    const value = flags[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--provider") provider = value;
    if (flag === "--postal-code") postalCode = value;
    if (flag === "--query") query = value;
    if (flag === "--product-id") productIds.push(value);
    if (flag === "--category-id") categoryIds.push(value);
    index += 1;
  }

  const normalizedProvider = provider?.toUpperCase();
  if (normalizedProvider === undefined || !isRetailer(normalizedProvider)) {
    throw new Error(`Invalid provider: ${provider ?? "missing"}`);
  }
  if (postalCode?.trim() === "") postalCode = undefined;
  if (postalCode === undefined) throw new Error("Missing postal code");

  if (operation === "refresh") {
    if (query !== undefined)
      throw new Error("--query is not valid for refresh");
    return {
      operation,
      provider: normalizedProvider,
      postalCode,
      dryRun,
      ...(productIds.length === 0 ? {} : { productIds }),
    };
  }
  if (operation === "catalog") {
    if (query !== undefined)
      throw new Error("--query is not valid for catalog");
    if (productIds.length !== 0)
      throw new Error("--product-id is only valid for refresh");
    return {
      operation,
      provider: normalizedProvider,
      postalCode,
      dryRun,
      ...(categoryIds.length === 0 ? {} : { categoryIds }),
    };
  }
  if (categoryIds.length !== 0)
    throw new Error("--category-id is only valid for catalog");
  if (productIds.length !== 0) {
    throw new Error("--product-id is only valid for refresh");
  }
  if (query?.trim() === "") query = undefined;
  if (query === undefined) throw new Error("Missing query");
  return {
    operation,
    provider: normalizedProvider,
    postalCode,
    query,
    dryRun,
  };
}
