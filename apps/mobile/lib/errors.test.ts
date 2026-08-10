import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("traduce errores conocidos de las RPC de invitaciones", () => {
    expect(
      getErrorMessage(new Error("Invite code is invalid or expired")),
    ).toContain("invitación");
  });

  it("no asume que el valor recibido sea Error", () => {
    expect(getErrorMessage(null)).toBe("Ha ocurrido un error inesperado.");
  });
});
