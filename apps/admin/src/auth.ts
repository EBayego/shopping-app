import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface AdminCredentials {
  username: string;
  password: string;
}

export function isAuthorized(
  request: Pick<IncomingMessage, "headers">,
  expected: AdminCredentials,
): boolean {
  return isAuthorizedHeader(request.headers.authorization, expected);
}

export function isAuthorizedHeader(
  authorization: string | undefined,
  expected: AdminCredentials,
): boolean {
  if (authorization === undefined || !authorization.startsWith("Basic ")) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  return (
    safeEqual(decoded.slice(0, separator), expected.username) &&
    safeEqual(decoded.slice(separator + 1), expected.password)
  );
}

function safeEqual(received: string, expected: string): boolean {
  const receivedHash = createHash("sha256").update(received).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}
