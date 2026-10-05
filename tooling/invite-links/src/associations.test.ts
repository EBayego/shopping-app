import { describe, expect, it } from "vitest";
import { androidAssociation, appleAssociation } from "./associations.js";

describe("public app associations", () => {
  it("authorizes only the production Android app and real certificate format", () => {
    const fingerprint = Array.from({ length: 32 }, () => "ab").join(":");
    expect(
      androidAssociation(`${fingerprint},${fingerprint}`)[0]?.target,
    ).toEqual({
      namespace: "android_app",
      package_name: "com.shoppingapp.mobile",
      sha256_cert_fingerprints: [fingerprint.toUpperCase()],
    });
    expect(() => androidAssociation("replace-me")).toThrow(
      "huellas SHA-256 reales",
    );
  });

  it("authorizes only invitation paths for the production iOS app", () => {
    expect(appleAssociation("ABCDE12345").applinks.details).toEqual([
      {
        appIDs: ["ABCDE12345.com.shoppingapp.mobile"],
        components: [{ "/": "/join/*" }],
      },
    ]);
    expect(() => appleAssociation("unknown")).toThrow("identificador real");
  });
});
