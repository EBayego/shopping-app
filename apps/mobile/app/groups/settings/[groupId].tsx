import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";

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
