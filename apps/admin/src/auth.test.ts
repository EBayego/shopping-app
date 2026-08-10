import { describe, expect, it } from "vitest";

import { isAuthorizedHeader } from "./auth.js";

const credentials = {
  username: "operator",
  password: "a-very-long-admin-password",
};

describe("admin authorization", () => {
  it("accepts exact Basic credentials", () => {
    const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
    expect(isAuthorizedHeader(authorization, credentials)).toBe(true);
  });

  it.each([
    undefined,
    "Bearer token",
    `Basic ${Buffer.from("operator:wrong-password").toString("base64")}`,
    `Basic ${Buffer.from("other:a-very-long-admin-password").toString("base64")}`,
    `Basic ${Buffer.from("missing-separator").toString("base64")}`,
  ])("rejects missing or invalid credentials", (authorization) => {
    expect(isAuthorizedHeader(authorization, credentials)).toBe(false);
  });
});
