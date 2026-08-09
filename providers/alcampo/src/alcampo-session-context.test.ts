import { describe, expect, it } from "vitest";

import { AlcampoSessionContext } from "./alcampo-session-context.js";

describe("AlcampoSessionContext", () => {
  it("sólo se crea desde entorno cuando todo el contexto explícito está presente", () => {
    expect(
      AlcampoSessionContext.fromEnvironment({ ALCAMPO_GLOBAL_SID: "sid-test" }),
    ).toBeUndefined();
    const context = AlcampoSessionContext.fromEnvironment({
      ALCAMPO_GLOBAL_SID: "sid-test",
      ALCAMPO_AWS_WAF_TOKEN: "waf-test",
      ALCAMPO_CSRF_TOKEN: "csrf-test",
      ALCAMPO_MARKET_ID: "configured:test",
      ALCAMPO_POSTAL_CODE: "50009",
    });
    expect(context?.requestHeaders()).toEqual({
      accept: "application/json",
      cookie: "global_sid=sid-test; aws-waf-token=waf-test",
      "x-csrf-token": "csrf-test",
    });
  });

  it("rechaza caracteres capaces de inyectar cabeceras o cookies", () => {
    expect(
      () =>
        new AlcampoSessionContext({
          globalSid: "sid; injected=true",
          awsWafToken: "waf-test",
          csrfToken: "csrf-test",
          marketExternalId: "configured:test",
          postalCode: "50009",
        }),
    ).toThrow(TypeError);
  });
});
