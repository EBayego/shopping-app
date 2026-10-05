export function androidAssociation(fingerprints: string) {
  const values = [
    ...new Set(
      fingerprints.split(",").map((value) => value.trim().toUpperCase()),
    ),
  ];
  if (
    values.length === 0 ||
    values.some((value) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))
  ) {
    throw new Error(
      "INVITE_ANDROID_SHA256 debe contener huellas SHA-256 reales separadas por comas.",
    );
  }
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.shoppingapp.mobile",
        sha256_cert_fingerprints: values,
      },
    },
  ];
}

export function appleAssociation(teamId: string) {
  const value = teamId.trim();
  if (!/^[A-Z0-9]{10}$/.test(value)) {
    throw new Error(
      "INVITE_APPLE_TEAM_ID debe ser el identificador real de 10 caracteres de Apple Developer.",
    );
  }
  return {
    applinks: {
      details: [
        {
          appIDs: [`${value}.com.shoppingapp.mobile`],
          components: [{ "/": "/join/*" }],
        },
      ],
    },
  };
}
