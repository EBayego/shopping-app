import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";

import { createAdminApplication } from "./app.js";
import { AdminActions } from "./actions.js";
import { loadConfig } from "./env.js";
import { AdminQueries } from "./queries.js";
import { SupabaseRestClient } from "./supabase.js";

const config = loadConfig();
const client = new SupabaseRestClient({
  url: config.supabaseUrl,
  serviceRoleKey: config.serviceRoleKey,
});
const queries = new AdminQueries(client);
const application = createAdminApplication({
  credentials: { username: config.username, password: config.password },
  queries,
  actions: new AdminActions(client, config.username),
});

const server = createServer((incoming, outgoing) => {
  void respond(incoming, outgoing).catch((error: unknown) => {
    console.error("admin.server.failed", error);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  });
});

async function respond(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const method = incoming.method ?? "GET";
  const protocol =
    incoming.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const requestBody =
    method === "GET" || method === "HEAD"
      ? undefined
      : await readBody(incoming);
  const request = new Request(
    new URL(
      incoming.url ?? "/",
      `${protocol}://${incoming.headers.host ?? "localhost"}`,
    ),
    {
      method,
      headers: new Headers(
        Object.entries(incoming.headers).flatMap(([name, value]) =>
          value === undefined
            ? []
            : [[name, Array.isArray(value) ? value.join(", ") : value]],
        ),
      ),
      ...(requestBody === undefined ? {} : { body: requestBody }),
    },
  );
  const response = await application(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) outgoing.end();
  else Readable.fromWeb(response.body).pipe(outgoing);
}

async function readBody(incoming: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of incoming as AsyncIterable<unknown>) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new TypeError("Unexpected admin request body chunk");
    }
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > 64 * 1024) throw new Error("Admin request body is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Shopping Admin listening on http://127.0.0.1:${config.port}`);
});
