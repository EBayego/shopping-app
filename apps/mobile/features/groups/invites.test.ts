import { describe, expect, it } from "vitest";

import {
  createInviteDeepLink,
  createInviteLink,
  getInviteBaseUrl,
  normalizeInviteCode,
} from "./invites";

describe("createInviteLink", () => {
  it("genera un enlace HTTPS y conserva ceros iniciales", () => {
    expect(
      createInviteLink(
        " 001234 ",
        "shopping-app",
        "https://shoppingapp.ebia.cloud",
      ),
    ).toBe("https://shoppingapp.ebia.cloud/join/001234");
  });

  it("usa el scheme de la variante instalada", () => {
    expect(
      createInviteLink(
        "001234",
        "shopping-app-staging",
        "https://shoppingapp.ebia.cloud",
      ),
    ).toBe(
      "https://shoppingapp.ebia.cloud/preview/join/001234?scheme=shopping-app-staging",
    );
  });

  it("mantiene el deep link nativo para abrir la app desde la página", () => {
    expect(createInviteDeepLink(" 001234 ", "shopping-app-staging")).toBe(
      "shopping-app-staging://join/001234",
    );
  });

  it.each([
    " 001234 ",
    "https://shoppingapp.ebia.cloud/join/001234",
    "https://shoppingapp.ebia.cloud/join/001234/?scheme=shopping-app-staging",
    "https://shoppingapp.ebia.cloud/preview/join/001234?scheme=shopping-app-staging",
    "shopping-app://join/001234",
    "shopping-app-dev://join/001234",
  ])("extrae el código para pegar códigos o enlaces: %s", (value) => {
    expect(normalizeInviteCode(value)).toBe("001234");
  });

  it("conserva los códigos antiguos y tolera enlaces mal formados", () => {
    const legacy = "EF31-75A4-D56E-57C5-886C-C3DC";
    expect(
      normalizeInviteCode(`https://shoppingapp.ebia.cloud/join/${legacy}`),
    ).toBe(legacy);
    expect(normalizeInviteCode("shopping-app://join/%")).toBe(
      "shopping-app://join/%",
    );
  });

  it.each([
    "http://shoppingapp.ebia.cloud",
    "https://user:password@shoppingapp.ebia.cloud",
    "https://shoppingapp.ebia.cloud/otra",
    "https://shoppingapp.ebia.cloud?x=1",
  ])("rechaza una base pública inválida: %s", (value) => {
    expect(() => getInviteBaseUrl(value)).toThrow("dominio HTTPS");
  });
});
