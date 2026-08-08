import { isRetailer, type Retailer } from "@shopping-app/domain";

interface ProviderPocBaseArguments {
  provider: Retailer;
  postalCode: string;
}

export type ProviderPocArguments = ProviderPocBaseArguments &
  ({ query: string; product?: never } | { product: string; query?: never });

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
  if ((query === undefined) === (product === undefined)) {
    throw new Error("Provide exactly one of --query or --product");
  }

  if (query !== undefined) {
    return { provider: normalizedProvider, postalCode, query };
  }
  if (product !== undefined) {
    return { provider: normalizedProvider, postalCode, product };
  }

  throw new Error("Provide exactly one of --query or --product");
}
