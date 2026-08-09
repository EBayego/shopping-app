import type { StructuredLogger } from "./types.js";

const REDACTED_KEYS = /authorization|cookie|password|secret|token|api[-_]?key/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        REDACTED_KEYS.test(key) ? "[REDACTED]" : redact(entry),
      ]),
    );
  }
  return value;
}

export class JsonConsoleLogger implements StructuredLogger {
  debug(event: string, context: Readonly<Record<string, unknown>> = {}): void {
    this.write("debug", event, context);
  }

  info(event: string, context: Readonly<Record<string, unknown>> = {}): void {
    this.write("info", event, context);
  }

  warn(event: string, context: Readonly<Record<string, unknown>> = {}): void {
    this.write("warn", event, context);
  }

  error(event: string, context: Readonly<Record<string, unknown>> = {}): void {
    this.write("error", event, context);
  }

  private write(
    level: string,
    event: string,
    context: Readonly<Record<string, unknown>>,
  ): void {
    const safeContext = redact(context) as Readonly<Record<string, unknown>>;
    const line = JSON.stringify({ level, event, ...safeContext });
    if (level === "error") console.error(line);
    else console.log(line);
  }
}

export const silentLogger: StructuredLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
