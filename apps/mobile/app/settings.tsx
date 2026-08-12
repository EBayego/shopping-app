import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../components/app-button";
import { AppInput } from "../components/app-input";
import { Screen } from "../components/screen";
import { ScreenState } from "../components/screen-state";
import { useSession } from "../features/auth/session-provider";
import {
  useProfileQuery,
  useUpdateProfileMutation,
} from "../features/settings/queries";
import { useThemedStyles, useTheme } from "../features/theme/theme-context";
import { getErrorMessage } from "../lib/errors";
import { spacing, type ThemeColors, type ThemeMode } from "../lib/theme";
import {
  beginSocialIdentityLink,
  beginSocialSignIn,
  type SocialIdentityProvider,
} from "../repositories/auth-repository";

const providerLabels: Record<SocialIdentityProvider, string> = {
  google: "Google",
  apple: "Apple",
};

export default function SettingsScreen() {
  const { oauthIntent, oauthProvider } = useLocalSearchParams<{
    oauthIntent?: "link" | "sign-in";
    oauthProvider?: SocialIdentityProvider;
  }>();
  const session = useSession();
  const { mode, setMode } = useTheme();
  const styles = useThemedStyles(createStyles);
  const userId = session.status === "ready" ? session.session.user.id : "";
  const profile = useProfileQuery(userId);
  const updateProfile = useUpdateProfileMutation(userId);
  const [displayName, setDisplayName] = useState("");
  const [linkingProvider, setLinkingProvider] =
    useState<SocialIdentityProvider | null>(null);
  const [signingInProvider, setSigningInProvider] =
    useState<SocialIdentityProvider | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const connectedProviders = useMemo(
    () =>
      new Set(
        session.status === "ready"
          ? (session.session.user.identities ?? []).map(
              (identity) => identity.provider,
            )
          : [],
      ),
    [session],
  );

  useEffect(() => {
    if (profile.data) setDisplayName(profile.data.display_name ?? "");
  }, [profile.data]);

  async function linkIdentity(provider: SocialIdentityProvider) {
    setIdentityError(null);
    setLinkingProvider(provider);
    try {
      await beginSocialIdentityLink(provider);
    } catch (error) {
      setIdentityError(getErrorMessage(error));
    } finally {
      setLinkingProvider(null);
    }
  }

  function confirmSignIn(provider: SocialIdentityProvider) {
    Alert.alert(
      `Iniciar sesión con ${providerLabels[provider]}`,
      "La identidad local actual será sustituida. Si quieres conservar sus listas y grupos, cancela y vincúlala primero.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Iniciar sesión",
          onPress: () => void signIn(provider),
        },
      ],
    );
  }

  async function signIn(provider: SocialIdentityProvider) {
    setIdentityError(null);
    setSigningInProvider(provider);
    try {
      await beginSocialSignIn(provider);
    } catch (error) {
      setIdentityError(getErrorMessage(error));
    } finally {
      setSigningInProvider(null);
    }
  }

  if (profile.isLoading)
    return (
      <Screen scroll={false}>
        <ScreenState loading title="Cargando ajustes" />
      </Screen>
    );
  if (profile.isError) {
    return (
      <Screen scroll={false}>
        <ScreenState
          title="No se pudo cargar el perfil"
          message={getErrorMessage(profile.error)}
          retry={() => void profile.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Tu perfil</Text>
      <Text style={styles.muted}>
        La sesión se guarda de forma segura en este dispositivo.
      </Text>
      <AppInput
        label="Nombre visible"
        onChangeText={(value) => {
          setDisplayName(value);
          updateProfile.reset();
        }}
        placeholder="Tu nombre"
        value={displayName}
      />
      {updateProfile.error ? (
        <Text style={styles.error}>{getErrorMessage(updateProfile.error)}</Text>
      ) : null}
      {updateProfile.isSuccess ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          Nombre visible guardado correctamente.
        </Text>
      ) : null}
      <AppButton
        loading={updateProfile.isPending}
        onPress={() => updateProfile.mutate(displayName)}
      >
        Guardar nombre
      </AppButton>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Apariencia</Text>
        <Text style={styles.muted}>Elige el tema de la aplicación.</Text>
        <View accessibilityRole="radiogroup" style={styles.themeOptions}>
          <ThemeOption
            active={mode === "light"}
            label="Claro"
            mode="light"
            onSelect={setMode}
          />
          <ThemeOption
            active={mode === "dark"}
            label="Oscuro"
            mode="dark"
            onSelect={setMode}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Protege tu cuenta</Text>
        <Text style={styles.muted}>
          Vincula una cuenta para recuperar el acceso sin perder tus listas ni
          grupos. Google y Apple son las opciones sociales disponibles.
        </Text>
        {oauthProvider && providerLabels[oauthProvider] ? (
          <Text accessibilityLiveRegion="polite" style={styles.success}>
            {oauthIntent === "sign-in"
              ? `Sesión iniciada con ${providerLabels[oauthProvider]} correctamente.`
              : `Cuenta vinculada con ${providerLabels[oauthProvider]} correctamente.`}
          </Text>
        ) : null}
        {identityError ? (
          <Text style={styles.error}>{identityError}</Text>
        ) : null}
        {(Object.keys(providerLabels) as SocialIdentityProvider[]).map(
          (provider) => {
            const connected = connectedProviders.has(provider);
            return (
              <AppButton
                disabled={
                  connected ||
                  linkingProvider !== null ||
                  signingInProvider !== null
                }
                key={provider}
                icon={<SocialProviderIcon provider={provider} />}
                loading={linkingProvider === provider}
                onPress={() => void linkIdentity(provider)}
                tone="secondary"
              >
                {connected
                  ? `${providerLabels[provider]} vinculado`
                  : `Vincular con ${providerLabels[provider]}`}
              </AppButton>
            );
          },
        )}
        <Text style={styles.accountHint}>
          ¿Ya protegiste tu cuenta en otro dispositivo? Inicia sesión para
          recuperarla. La identidad local actual será sustituida.
        </Text>
        {(Object.keys(providerLabels) as SocialIdentityProvider[]).map(
          (provider) => (
            <AppButton
              disabled={linkingProvider !== null || signingInProvider !== null}
              key={`sign-in-${provider}`}
              icon={<SocialProviderIcon provider={provider} />}
              loading={signingInProvider === provider}
              onPress={() => confirmSignIn(provider)}
              tone="secondary"
            >
              Iniciar sesión con {providerLabels[provider]}
            </AppButton>
          ),
        )}
      </View>
    </Screen>
  );
}

function SocialProviderIcon({
  provider,
}: {
  provider: SocialIdentityProvider;
}) {
  const { colors } = useTheme();
  return (
    <Ionicons
      color={provider === "google" ? "#4285F4" : colors.text}
      name={provider === "google" ? "logo-google" : "logo-apple"}
      size={21}
    />
  );
}

function ThemeOption({
  active,
  label,
  mode,
  onSelect,
}: {
  active: boolean;
  label: string;
  mode: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={() => onSelect(mode)}
      style={({ pressed }) => [
        styles.themeOption,
        active && styles.themeOptionActive,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[styles.themeOptionText, active && styles.themeOptionTextActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    title: { color: colors.text, fontSize: 28, fontWeight: "800" as const },
    section: { gap: spacing.sm, marginTop: spacing.md },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700" as const,
    },
    muted: { color: colors.muted, lineHeight: 21 },
    error: { color: colors.danger },
    success: {
      color: colors.text,
      backgroundColor: colors.successBackground,
      padding: spacing.md,
      borderRadius: 12,
      lineHeight: 21,
    },
    accountHint: {
      color: colors.muted,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      lineHeight: 21,
      marginTop: spacing.sm,
      paddingTop: spacing.md,
    },
    themeOptions: { flexDirection: "row" as const, gap: spacing.sm },
    themeOption: {
      flex: 1,
      minHeight: 48,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
    },
    themeOptionActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    themeOptionText: { color: colors.text, fontWeight: "700" as const },
    themeOptionTextActive: { color: colors.background },
    pressed: { opacity: 0.78 },
  });
