import { isRetailer, type Retailer } from "@shopping-app/domain";

interface ProviderPocBaseArguments {
  provider: Retailer;
  postalCode: string;
}

export type ProviderPocArguments = ProviderPocBaseArguments &
  (
    | {
        query: string;
        product?: never;
        category?: never;
        categories?: never;
      }
    | {
        product: string;
        query?: never;
        category?: never;
        categories?: never;
      }
    | {
        category: string;
        query?: never;
        product?: never;
        categories?: never;
      }
    | {
        categories: true;
        query?: never;
        product?: never;
        category?: never;
      }
  );

function requireValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArguments(args: readonly string[]): ProviderPocArguments {
  let providerValue: string | undefined;
  let postalCode: string | undefined;
  let query: string | undefined;
  let product: string | undefined;
  let category: string | undefined;
  let categories = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === undefined) {
      continue;
    }

    switch (flag) {
      case "--provider":
        providerValue = requireValue(args, index, flag);
        index += 1;
        break;
      case "--postal-code":
        postalCode = requireValue(args, index, flag);
        index += 1;
        break;
      case "--query":
        query = requireValue(args, index, flag);
        index += 1;
        break;
      case "--product":
        product = requireValue(args, index, flag);
        index += 1;
        break;
      case "--category":
        category = requireValue(args, index, flag);
        index += 1;
        break;
      case "--categories":
        categories = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  const normalizedProvider = providerValue?.toUpperCase();
  if (normalizedProvider === undefined || !isRetailer(normalizedProvider)) {
    throw new Error(`Invalid provider: ${providerValue ?? "missing"}`);
  }
  if (postalCode === undefined || postalCode.trim() === "") {
    throw new Error("Missing postal code");
  }
  const selectedCapabilities = [
    query !== undefined,
    product !== undefined,
    category !== undefined,
    categories,
  ].filter(Boolean).length;
  if (selectedCapabilities !== 1) {
    throw new Error(
      "Provide exactly one of --query, --product, --category or --categories",
    );
  }

  if (query !== undefined) {
    return { provider: normalizedProvider, postalCode, query };
  }
  if (product !== undefined) {
    return { provider: normalizedProvider, postalCode, product };
  }
  if (category !== undefined) {
    return { provider: normalizedProvider, postalCode, category };
  }
  if (categories) {
    return { provider: normalizedProvider, postalCode, categories: true };
  }

  throw new Error("No provider capability selected");
}
