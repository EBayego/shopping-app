import { describe, expect, it } from "vitest";

import {
  parseOAuthCallbackRouteParams,
  parseOAuthCallbackUrl,
} from "../features/auth/oauth-callback";

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

  it("extrae el callback de los parámetros que entrega Expo Router", () => {
    expect(
      parseOAuthCallbackRouteParams({
        code: "abc123",
      }),
    ).toEqual({ code: "abc123", errorDescription: null });
  });

  it("tolera parámetros repetidos y prioriza la descripción del error", () => {
    expect(
      parseOAuthCallbackRouteParams({
        code: [],
        error: "access_denied",
        error_description: ["Acceso cancelado", "Ignorado"],
      }),
    ).toEqual({ code: null, errorDescription: "Acceso cancelado" });
  });
});
