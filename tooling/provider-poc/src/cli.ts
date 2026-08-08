import { pathToFileURL } from "node:url";

import { parseArguments } from "./arguments.js";
import { runProviderPoc } from "./runner.js";

export async function main(args: readonly string[]): Promise<void> {
  const options = parseArguments(args);
  const result = await runProviderPoc(options);
  console.log(JSON.stringify(result, null, 2));
}

const executedFile = process.argv[1];
if (
  executedFile !== undefined &&
  import.meta.url === pathToFileURL(executedFile).href
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
