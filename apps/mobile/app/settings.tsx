import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";

import { AppButton } from "../components/app-button";
import { AppInput } from "../components/app-input";
import { Screen } from "../components/screen";
import { ScreenState } from "../components/screen-state";
import { useSession } from "../features/auth/session-provider";
import {
  useProfileQuery,
  useUpdateProfileMutation,
} from "../features/settings/queries";
import { getErrorMessage } from "../lib/errors";
import { colors, spacing } from "../lib/theme";

export default function SettingsScreen() {
  const session = useSession();
  const userId = session.status === "ready" ? session.session.user.id : "";
  const profile = useProfileQuery(userId);
  const updateProfile = useUpdateProfileMutation(userId);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (profile.data) setDisplayName(profile.data.display_name ?? "");
  }, [profile.data]);

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
        onChangeText={setDisplayName}
        placeholder="Tu nombre"
        value={displayName}
      />
      {updateProfile.error ? (
        <Text style={styles.error}>{getErrorMessage(updateProfile.error)}</Text>
      ) : null}
      <AppButton
        loading={updateProfile.isPending}
        onPress={() => updateProfile.mutate(displayName)}
      >
        Guardar nombre
      </AppButton>

      <Text style={styles.identifier}>ID de sesión: {userId}</Text>
      <Text style={styles.warning}>
        Reiniciar crea una identidad anónima nueva. Perderás el acceso a los
        grupos de la sesión actual si no conservas una invitación.
      </Text>
      <AppButton tone="danger" onPress={() => void session.resetSession()}>
        Reiniciar sesión local
      </AppButton>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  muted: { color: colors.muted, lineHeight: 21 },
  error: { color: colors.danger },
  identifier: { color: colors.muted, fontSize: 12, marginTop: spacing.lg },
  warning: {
    color: colors.danger,
    backgroundColor: colors.dangerBackground,
    padding: spacing.md,
    borderRadius: 12,
    lineHeight: 21,
  },
});
