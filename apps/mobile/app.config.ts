import type { ConfigContext, ExpoConfig } from "expo/config";

type AppEnvironment = "development" | "staging" | "production";

const variants: Record<
  AppEnvironment,
  { name: string; identifier: string; scheme: string }
> = {
  development: {
    name: "shopping-app Dev",
    identifier: "com.shoppingapp.mobile.dev",
    scheme: "shopping-app-dev",
  },
  staging: {
    name: "shopping-app Staging",
    identifier: "com.shoppingapp.mobile.staging",
    scheme: "shopping-app-staging",
  },
  production: {
    name: "shopping-app",
    identifier: "com.shoppingapp.mobile",
    scheme: "shopping-app",
  },
};

function resolveEnvironment(value: string | undefined): AppEnvironment {
  if (value === undefined || value === "") return "development";
  if (
    value === "development" ||
    value === "staging" ||
    value === "production"
  ) {
    return value;
  }
  throw new Error(
    `APP_ENV must be development, staging or production; received ${value}`,
  );
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = resolveEnvironment(process.env.APP_ENV?.trim());
  const variant = variants[environment];

  return {
    ...config,
    name: variant.name,
    slug: "shopping-app",
    scheme: variant.scheme,
    icon: "./assets/icon-placeholder.png",
    plugins: [
      ...(config.plugins ?? []),
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-placeholder.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#0F766E",
        },
      ],
    ],
    ios: {
      ...config.ios,
      bundleIdentifier: variant.identifier,
      supportsTablet: true,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSMicrophoneUsageDescription:
          "Permite dictar productos para preparar una vista previa antes de añadirlos.",
        NSSpeechRecognitionUsageDescription:
          "Permite convertir el dictado en productos de la lista.",
      },
    },
    android: {
      ...config.android,
      package: variant.identifier,
      permissions: ["android.permission.RECORD_AUDIO"],
      adaptiveIcon: {
        foregroundImage: "./assets/icon-placeholder.png",
        backgroundColor: "#0F766E",
      },
    },
    web: {
      ...config.web,
      favicon: "./assets/icon-placeholder.png",
    },
    extra: {
      ...config.extra,
      appEnvironment: environment,
    },
  };
};
