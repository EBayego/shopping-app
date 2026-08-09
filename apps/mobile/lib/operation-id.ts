import * as Crypto from "expo-crypto";

export function createOperationId(): string {
  return Crypto.randomUUID();
}
