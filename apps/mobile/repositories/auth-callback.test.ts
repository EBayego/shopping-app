import { describe, expect, it } from "vitest";

import { parseOAuthCallbackUrl } from "../features/auth/oauth-callback";

describe("parseOAuthCallbackUrl", () => {
  it("extrae el código PKCE de una redirección correcta", () => {
    expect(
      parseOAuthCallbackUrl("shopping-app-dev://auth/callback?code=abc123"),
    ).toEqual({ code: "abc123", errorDescription: null });
  });

  it("conserva el error descriptivo devuelto por el proveedor", () => {
    expect(
      parseOAuthCallbackUrl(
        "shopping-app-dev://auth/callback?error=access_denied&error_description=Acceso%20cancelado",
      ),
    ).toEqual({ code: null, errorDescription: "Acceso cancelado" });
  });
});
