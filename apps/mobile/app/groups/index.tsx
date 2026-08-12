import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../../components/app-button";
import { AppInput } from "../../components/app-input";
import { Screen } from "../../components/screen";
import { ScreenState } from "../../components/screen-state";
import { useGroupsQuery } from "../../features/groups/queries";
import { getErrorMessage } from "../../lib/errors";
import { useThemedStyles } from "../../features/theme/theme-context";
import { spacing, type ThemeColors } from "../../lib/theme";
import { useUiStore } from "../../stores/ui-store";

export default function GroupsScreen() {
  const styles = useThemedStyles(createStyles);
  const groups = useGroupsQuery();
  const [inviteCode, setInviteCode] = useState("");
  const isHelpVisible = useUiStore((state) => state.isGroupHelpVisible);
  const toggleHelp = useUiStore((state) => state.toggleGroupHelp);
  const pendingInviteCode = useUiStore((state) => state.pendingInviteCode);

  if (groups.isLoading) {
    return (
      <Screen scroll={false}>
        <ScreenState loading title="Cargando grupos" />
      </Screen>
    );
  }
  if (groups.isError) {
    return (
      <Screen scroll={false}>
        <ScreenState
          title="No se pudieron cargar los grupos"
          message={getErrorMessage(groups.error)}
          retry={() => void groups.refetch()}
        />
      </Screen>
    );
  }
  const groupData = groups.data ?? [];

  return (
    <Screen>
      <View style={styles.headerActions}>
        <AppButton onPress={() => router.push("/onboarding")}>
          Crear grupo
        </AppButton>
        <AppButton tone="secondary" onPress={() => router.push("/settings")}>
          Ajustes
        </AppButton>
      </View>

      {pendingInviteCode ? (
        <View style={styles.pendingInvite}>
          <Text style={styles.sectionTitle}>
            Tienes una invitación pendiente
          </Text>
          <AppButton
            onPress={() =>
              router.push({
                pathname: "/join/[inviteCode]",
                params: { inviteCode: pendingInviteCode },
              })
            }
          >
            Continuar con la invitación
          </AppButton>
        </View>
      ) : null}

      {groupData.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.title}>Aún no tienes grupos</Text>
          <Text style={styles.muted}>
            Crea uno o utiliza un código de invitación.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {groupData.map((group) => (
            <Pressable
              accessibilityRole="button"
              key={group.id}
              onPress={() =>
                router.push({
                  pathname: "/groups/[groupId]",
                  params: { groupId: group.id },
                })
              }
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <Text style={styles.cardTitle}>{group.name}</Text>
              <Text style={styles.muted}>Abrir listas →</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.joinBox}>
        <Text style={styles.sectionTitle}>Unirse con invitación</Text>
        <AppInput
          autoCapitalize="none"
          autoCorrect={false}
          label="Código"
          onChangeText={setInviteCode}
          placeholder="Pega el código recibido"
          value={inviteCode}
        />
        <AppButton
          disabled={!inviteCode.trim()}
          tone="secondary"
          onPress={() =>
            router.push({
              pathname: "/join/[inviteCode]",
              params: { inviteCode: inviteCode.trim() },
            })
          }
        >
          Continuar
        </AppButton>
      </View>

      <Pressable onPress={toggleHelp}>
        <Text style={styles.helpLink}>
          {isHelpVisible ? "Ocultar ayuda" : "¿Cómo funcionan los grupos?"}
        </Text>
      </Pressable>
      {isHelpVisible ? (
        <Text style={styles.helpText}>
          Cada grupo contiene listas compartidas. Las políticas de Supabase solo
          permiten verlas a sus miembros.
        </Text>
      ) : null}
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    headerActions: { flexDirection: "row", gap: spacing.sm },
    empty: {
      paddingVertical: spacing.xl,
      alignItems: "center",
      gap: spacing.sm,
    },
    title: { color: colors.text, fontSize: 22, fontWeight: "800" },
    muted: { color: colors.muted, lineHeight: 21 },
    list: { gap: spacing.sm },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.xs,
    },
    pressed: { opacity: 0.7 },
    cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
    joinBox: {
      marginTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.lg,
      gap: spacing.md,
    },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
    helpLink: { color: colors.primary, fontWeight: "700", textAlign: "center" },
    helpText: { color: colors.muted, textAlign: "center", lineHeight: 21 },
    pendingInvite: {
      backgroundColor: colors.successBackground,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.sm,
    },
  });
