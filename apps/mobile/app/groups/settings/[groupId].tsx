import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../../../components/app-button";
import { AppInput } from "../../../components/app-input";
import { Screen } from "../../../components/screen";
import { ScreenState } from "../../../components/screen-state";
import { useSession } from "../../../features/auth/session-provider";
import { createInviteLink } from "../../../features/groups/invites";
import {
  useGenerateInviteMutation,
  useGroupDetailQuery,
  useUpdatePostalCodeMutation,
} from "../../../features/groups/queries";
import { isValidSpanishPostalCode } from "../../../features/groups/validation";
import { getErrorMessage } from "../../../lib/errors";
import { createOperationId } from "../../../lib/operation-id";
import { useThemedStyles } from "../../../features/theme/theme-context";
import { supermarketAccuracyWarning } from "../../../features/supermarkets/messages";
import {
  useSetSupermarketEnabledMutation,
  useSupermarketsQuery,
} from "../../../features/supermarkets/queries";
import { SupermarketIcon } from "../../../features/supermarkets/supermarket-icon";
import type { SupermarketPreference } from "../../../features/supermarkets/types";
import { spacing, type ThemeColors } from "../../../lib/theme";

function firstParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function GroupSettingsScreen() {
  const styles = useThemedStyles(createStyles);
  const params = useLocalSearchParams<{ groupId: string | string[] }>();
  const groupId = firstParameter(params.groupId);
  const session = useSession();
  const detail = useGroupDetailQuery(groupId);
  const updatePostalCode = useUpdatePostalCodeMutation(groupId);
  const generateInvite = useGenerateInviteMutation();
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState("");
  const [postalCodeError, setPostalCodeError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const activeListId = selectedListId ?? detail.data?.lists[0]?.id ?? null;
  const activeList = detail.data?.lists.find(
    (list) => list.id === activeListId,
  );
  const supermarkets = useSupermarketsQuery(activeListId);
  const setSupermarketEnabled = useSetSupermarketEnabledMutation(activeListId);
  const [supermarketWarning, setSupermarketWarning] =
    useState<SupermarketPreference | null>(null);

  useEffect(() => {
    setPostalCode(activeList?.postal_code ?? "");
    setPostalCodeError(null);
  }, [activeList?.id, activeList?.postal_code]);

  if (detail.isLoading) {
    return (
      <Screen scroll={false}>
        <ScreenState loading title="Cargando ajustes" />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen scroll={false}>
        <ScreenState
          title="No se pudieron cargar los ajustes"
          message={getErrorMessage(detail.error)}
          retry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  if (!detail.data) return null;

  const isOwner =
    session.status === "ready" &&
    detail.data.members.some(
      (member) =>
        member.profile_id === session.session.user.id &&
        member.role === "owner",
    );

  const submitPostalCode = (): void => {
    if (!activeListId) return;
    if (!isValidSpanishPostalCode(postalCode)) {
      setPostalCodeError("El código postal debe tener cinco dígitos.");
      return;
    }
    setPostalCodeError(null);
    updatePostalCode.mutate({
      shoppingListId: activeListId,
      postalCode,
      operationId: createOperationId(),
    });
  };

  const shareInvite = async (): Promise<void> => {
    const code = generateInvite.data;
    if (!code) return;
    setShareError(null);
    const link = createInviteLink(code);
    try {
      await Share.share({
        title: `Invitación a ${detail.data.group.name}`,
        message: link,
        url: link,
      });
    } catch (error) {
      setShareError(getErrorMessage(error));
    }
  };

  const shareCode = async (): Promise<void> => {
    const code = generateInvite.data;
    if (!code) return;
    setShareError(null);
    try {
      await Share.share({ message: code });
    } catch (error) {
      setShareError(getErrorMessage(error));
    }
  };

  return (
    <Screen>
      <Text style={styles.title}>{detail.data.group.name}</Text>
      <Text style={styles.muted}>
        Aquí puedes configurar cada lista y gestionar el acceso al grupo.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Precios por zona</Text>
        {detail.data.lists.length > 1 ? (
          <View style={styles.tabs}>
            {detail.data.lists.map((list) => (
              <Pressable
                key={list.id}
                onPress={() => setSelectedListId(list.id)}
                style={[
                  styles.tab,
                  activeListId === list.id && styles.activeTab,
                ]}
              >
                <Text
                  style={
                    activeListId === list.id
                      ? styles.activeTabText
                      : styles.tabText
                  }
                >
                  {list.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {activeList ? (
          <>
            <AppInput
              error={postalCodeError ?? undefined}
              keyboardType="number-pad"
              label={`Código postal de ${activeList.name}`}
              maxLength={5}
              onChangeText={setPostalCode}
              value={postalCode}
            />
            <Text style={styles.muted}>
              Se usa para mostrar precios y disponibilidad de supermercados de
              la zona.
            </Text>
            <AppButton
              loading={updatePostalCode.isPending}
              onPress={submitPostalCode}
            >
              Guardar código postal
            </AppButton>
          </>
        ) : (
          <Text style={styles.muted}>Este grupo todavía no tiene listas.</Text>
        )}
        {updatePostalCode.error ? (
          <Text style={styles.error}>
            {getErrorMessage(updatePostalCode.error)}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Supermercados</Text>
        <Text style={styles.muted}>
          Elige qué supermercados se muestran en esta lista y en su comparación
          de precios.
        </Text>
        {activeListId === null ? (
          <Text style={styles.muted}>Este grupo todavía no tiene listas.</Text>
        ) : supermarkets.isLoading ? (
          <Text style={styles.muted}>Cargando supermercados…</Text>
        ) : supermarkets.isError ? (
          <View style={styles.inlineError}>
            <Text style={styles.error}>
              {getErrorMessage(supermarkets.error)}
            </Text>
            <AppButton
              tone="secondary"
              onPress={() => void supermarkets.refetch()}
            >
              Reintentar
            </AppButton>
          </View>
        ) : supermarkets.data?.length ? (
          <View style={styles.supermarketList}>
            {supermarkets.data.map((supermarket) => (
              <View key={supermarket.retailerId} style={styles.supermarketRow}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: supermarket.enabled }}
                  accessibilityLabel={`${supermarket.name} ${
                    supermarket.enabled ? "activado" : "desactivado"
                  }`}
                  disabled={setSupermarketEnabled.isPending}
                  onPress={() =>
                    setSupermarketEnabled.mutate({
                      retailerId: supermarket.retailerId,
                      enabled: !supermarket.enabled,
                    })
                  }
                  style={styles.supermarketToggle}
                >
                  <View
                    style={[
                      styles.checkbox,
                      supermarket.enabled && styles.checkboxChecked,
                    ]}
                  >
                    {supermarket.enabled ? (
                      <Text style={styles.checkmark}>✓</Text>
                    ) : null}
                  </View>
                  <SupermarketIcon code={supermarket.code} />
                  <Text style={styles.supermarketName}>{supermarket.name}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Información sobre los precios de ${supermarket.name}`}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setSupermarketWarning(supermarket)}
                  style={({ pressed }) => [
                    styles.warningIcon,
                    pressed && styles.warningIconPressed,
                  ]}
                >
                  <Text style={styles.warningIconText}>!</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>No hay supermercados disponibles.</Text>
        )}
        {setSupermarketEnabled.error ? (
          <Text style={styles.error}>
            {getErrorMessage(setSupermarketEnabled.error)}
          </Text>
        ) : null}
      </View>

      {isOwner ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Invitaciones</Text>
          <Text style={styles.muted}>
            Cada enlace caduca en 7 días y permite que se unan hasta 100
            personas. Puedes enviarlo directamente a un grupo de WhatsApp.
          </Text>
          <AppButton
            loading={generateInvite.isPending}
            tone="secondary"
            onPress={() => generateInvite.mutate(groupId)}
          >
            Crear enlace de invitación
          </AppButton>
          {generateInvite.data ? (
            <View style={styles.inviteResult}>
              <Text style={styles.label}>Código fácil de copiar</Text>
              <Text selectable style={styles.code}>
                {generateInvite.data}
              </Text>
              <Text style={styles.label}>Enlace</Text>
              <Text selectable style={styles.link}>
                {createInviteLink(generateInvite.data)}
              </Text>
              <AppButton onPress={() => void shareInvite()}>
                Compartir enlace
              </AppButton>
              <AppButton tone="secondary" onPress={() => void shareCode()}>
                Compartir solo el código
              </AppButton>
            </View>
          ) : null}
          {generateInvite.error ? (
            <Text style={styles.error}>
              {getErrorMessage(generateInvite.error)}
            </Text>
          ) : null}
          {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Miembros</Text>
        <Text style={styles.muted}>
          {detail.data.members.length} persona(s) tienen acceso a este grupo.
        </Text>
        {detail.data.members.map((member) => (
          <Text key={member.profile_id} style={styles.member}>
            {member.displayName ?? "Miembro sin nombre"} ·{" "}
            {member.role === "owner" ? "propietario" : "miembro"}
          </Text>
        ))}
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setSupermarketWarning(null)}
        transparent
        visible={supermarketWarning !== null}
      >
        <Pressable
          accessibilityLabel="Cerrar aviso de precisión de precios"
          accessibilityRole="button"
          onPress={() => setSupermarketWarning(null)}
          style={styles.modalBackdrop}
        >
          <View accessibilityViewIsModal style={styles.warningCard}>
            <View style={styles.warningHeading}>
              <View style={styles.warningIcon}>
                <Text style={styles.warningIconText}>!</Text>
              </View>
              <Text style={styles.warningTitle}>
                {supermarketWarning?.name}
              </Text>
            </View>
            <Text style={styles.warningMessage}>
              {supermarketWarning
                ? supermarketAccuracyWarning(supermarketWarning.code)
                : ""}
            </Text>
            <Text style={styles.warningDismissHint}>
              Toca cualquier parte de la pantalla para cerrar.
            </Text>
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    title: { color: colors.text, fontSize: 28, fontWeight: "800" },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
    label: { color: colors.text, fontSize: 14, fontWeight: "600" },
    muted: { color: colors.muted, lineHeight: 21 },
    section: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.sm,
    },
    tabs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    tab: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
    },
    activeTab: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { color: colors.text },
    activeTabText: { color: "#FFFFFF", fontWeight: "700" },
    inviteResult: { gap: spacing.sm },
    inlineError: { gap: spacing.sm },
    supermarketList: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      overflow: "hidden",
    },
    supermarketRow: {
      alignItems: "center",
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 56,
      paddingHorizontal: spacing.md,
    },
    supermarketToggle: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 56,
    },
    supermarketName: { color: colors.text, flex: 1, fontWeight: "600" },
    checkbox: {
      alignItems: "center",
      borderColor: colors.border,
      borderRadius: 6,
      borderWidth: 2,
      height: 24,
      justifyContent: "center",
      width: 24,
    },
    checkboxChecked: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    checkmark: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
    warningIcon: {
      alignItems: "center",
      borderColor: "#F79009",
      borderRadius: 999,
      borderWidth: 2,
      height: 26,
      justifyContent: "center",
      width: 26,
    },
    warningIconPressed: { opacity: 0.6 },
    warningIconText: { color: "#F79009", fontSize: 16, fontWeight: "900" },
    modalBackdrop: {
      alignItems: "center",
      backgroundColor: "rgba(0, 0, 0, 0.55)",
      flex: 1,
      justifyContent: "center",
      padding: spacing.lg,
    },
    warningCard: {
      backgroundColor: colors.surface,
      borderColor: "#F79009",
      borderRadius: 16,
      borderWidth: 1,
      gap: spacing.md,
      maxWidth: 420,
      padding: spacing.lg,
      width: "100%",
    },
    warningHeading: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
    },
    warningTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
    warningMessage: { color: colors.text, fontSize: 16, lineHeight: 23 },
    warningDismissHint: { color: colors.muted, fontSize: 13 },
    code: {
      backgroundColor: colors.successBackground,
      color: colors.text,
      padding: spacing.md,
      borderRadius: 10,
      fontFamily: "monospace",
      fontSize: 17,
    },
    link: { color: colors.primary, lineHeight: 21 },
    member: { color: colors.text },
    error: { color: colors.danger, lineHeight: 20 },
  });
