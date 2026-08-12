import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { AppButton } from "../components/app-button";
import { AppInput } from "../components/app-input";
import { Screen } from "../components/screen";
import { useCreateGroupMutation } from "../features/groups/queries";
import {
  validateCreateGroup,
  type CreateGroupErrors,
} from "../features/groups/validation";
import { getErrorMessage } from "../lib/errors";
import { useThemedStyles } from "../features/theme/theme-context";
import { spacing, type ThemeColors } from "../lib/theme";
import { useUiStore } from "../stores/ui-store";

export default function OnboardingScreen() {
  const styles = useThemedStyles(createStyles);
  const [groupName, setGroupName] = useState("");
  const [listName, setListName] = useState("Compra semanal");
  const [postalCode, setPostalCode] = useState("");
  const [errors, setErrors] = useState<CreateGroupErrors>({});
  const createGroup = useCreateGroupMutation();
  const pendingInviteCode = useUiStore((state) => state.pendingInviteCode);

  const submit = () => {
    const input = { groupName, listName, postalCode };
    const validationErrors = validateCreateGroup(input);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    createGroup.mutate(input, {
      onSuccess: ({ groupId }) =>
        router.replace({ pathname: "/groups/[groupId]", params: { groupId } }),
    });
  };

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.title}>Prepara tu primera lista</Text>
      <Text style={styles.subtitle}>
        El grupo se puede compartir más adelante mediante una invitación segura.
      </Text>
      {pendingInviteCode ? (
        <>
          <Text style={styles.pendingText}>
            Conservamos la invitación {pendingInviteCode} mientras decides qué
            hacer.
          </Text>
          <AppButton
            tone="secondary"
            onPress={() =>
              router.replace({
                pathname: "/join/[inviteCode]",
                params: { inviteCode: pendingInviteCode },
              })
            }
          >
            Usar invitación pendiente
          </AppButton>
        </>
      ) : null}
      <AppInput
        autoCapitalize="sentences"
        error={errors.groupName}
        label="Nombre del grupo"
        onChangeText={setGroupName}
        placeholder="Casa"
        value={groupName}
      />
      <AppInput
        autoCapitalize="sentences"
        error={errors.listName}
        label="Nombre de la lista"
        onChangeText={setListName}
        value={listName}
      />
      <AppInput
        error={errors.postalCode}
        keyboardType="number-pad"
        label="Código postal"
        maxLength={5}
        onChangeText={setPostalCode}
        placeholder="50009"
        value={postalCode}
      />
      {createGroup.error ? (
        <Text style={styles.error}>{getErrorMessage(createGroup.error)}</Text>
      ) : null}
      <AppButton loading={createGroup.isPending} onPress={submit}>
        Crear grupo y lista
      </AppButton>
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    content: { paddingTop: spacing.xl },
    title: { color: colors.text, fontSize: 28, fontWeight: "800" },
    subtitle: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 23,
      marginBottom: spacing.sm,
    },
    error: { color: colors.danger, lineHeight: 20 },
    pendingText: {
      color: colors.text,
      backgroundColor: colors.successBackground,
      padding: spacing.md,
      borderRadius: 12,
    },
  });
