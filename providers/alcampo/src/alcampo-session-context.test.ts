import { describe, expect, it } from "vitest";

import { AlcampoSessionContext } from "./alcampo-session-context.js";

const VALUES = {
  postalCode: "50009",
  regionId: "region-fixture",
  deliveryDestinationId: "destination-fixture",
  visitorId: "visitor-fixture",
  cartId: "cart-fixture",
  csrfToken: "csrf-fixture",
  globalSid: "sid-fixture",
  awsWafToken: "waf-fixture",
} as const;

describe("AlcampoSessionContext", () => {
  it("conserva el contexto resuelto y genera cabeceras sin exponerlo en logs", () => {
    const context = new AlcampoSessionContext(VALUES);
    expect(context.marketExternalId).toBe("region-fixture");
    expect(context.requestHeaders()).toMatchObject({
      "visitor-id": "visitor-fixture",
      visitorid: "visitor-fixture",
      "x-csrf-token": "csrf-fixture",
      cookie: "global_sid=sid-fixture; aws-waf-token=waf-fixture",
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("sólo carga del entorno un contexto resuelto completo", () => {
    expect(
      AlcampoSessionContext.fromEnvironment({ ALCAMPO_REGION_ID: "region" }),
    ).toBeUndefined();
    expect(
      AlcampoSessionContext.fromEnvironment({
        ALCAMPO_POSTAL_CODE: "50009",
        ALCAMPO_REGION_ID: "region-fixture",
        ALCAMPO_DELIVERY_DESTINATION_ID: "destination-fixture",
        ALCAMPO_VISITOR_ID: "visitor-fixture",
      }),
    ).toMatchObject({ regionId: "region-fixture", postalCode: "50009" });
  });

  it("rechaza inyección de cabeceras o cookies", () => {
    expect(
      () =>
        new AlcampoSessionContext({
          ...VALUES,
          globalSid: "sid; injected=true",
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new AlcampoSessionContext({
          ...VALUES,
          visitorId: "visitor\r\ninjected",
        }),
    ).toThrow(TypeError);
  });
});
