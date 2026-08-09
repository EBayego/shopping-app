import { describe, expect, it } from "vitest";

import { createInviteLink } from "./invites";

describe("createInviteLink", () => {
  it("genera un deep link compatible con el scheme de Expo Router", () => {
    expect(createInviteLink(" ABC123 ")).toBe("shopping-app://join/ABC123");
  });
});
