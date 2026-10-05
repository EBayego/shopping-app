import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { androidAssociation, appleAssociation } from "./associations.js";

const fingerprints = process.env.INVITE_ANDROID_SHA256;
const teamId = process.env.INVITE_APPLE_TEAM_ID;
if (!fingerprints && !teamId) {
  throw new Error(
    "Indica INVITE_ANDROID_SHA256 y/o INVITE_APPLE_TEAM_ID para generar las asociaciones del dominio.",
  );
}

// Validate all inputs before writing any of the public association files.
const android = fingerprints ? androidAssociation(fingerprints) : undefined;
const apple = teamId ? appleAssociation(teamId) : undefined;
const directory = new URL("../public/.well-known/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, value] of [
  ["assetlinks.json", android],
  ["apple-app-site-association", apple],
] as const) {
  if (value === undefined) continue;
  const target = new URL(name, directory);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.info(`Generado ${fileURLToPath(target)}`);
}
