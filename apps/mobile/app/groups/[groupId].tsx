import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../../components/app-button";
import { AppInput } from "../../components/app-input";
import { Screen } from "../../components/screen";
import { ScreenState } from "../../components/screen-state";
import { useSession } from "../../features/auth/session-provider";
import {
  useAddIntentMutation,
  useGenerateInviteMutation,
  useGroupDetailQuery,
  useToggleIntentMutation,
  useUpdatePostalCodeMutation,
} from "../../features/groups/queries";
import { createInviteLink } from "../../features/groups/invites";
import {
  isValidSpanishPostalCode,
  normalizeShoppingItemInput,
} from "../../features/groups/validation";
import { getErrorMessage } from "../../lib/errors";
import { colors, spacing } from "../../lib/theme";

function firstParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{
    groupId: string | string[];
    joinOutcome?: string | string[];
  }>();
  const groupId = firstParameter(params.groupId);
  const joinOutcome = firstParameter(params.joinOutcome);
  const session = useSession();
  const detail = useGroupDetailQuery(groupId);
  const addIntent = useAddIntentMutation(groupId);
  const toggleIntent = useToggleIntentMutation(groupId);
  const generateInvite = useGenerateInviteMutation();
  const updatePostalCode = useUpdatePostalCodeMutation(groupId);
  const [newItem, setNewItem] = useState("");
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState("");
  const [postalCodeError, setPostalCodeError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const activeListId = selectedListId ?? detail.data?.lists[0]?.id ?? null;
  const activeIntents = useMemo(
    () =>
      detail.data?.intents.filter(
        (intent) => intent.shopping_list_id === activeListId,
      ) ?? [],
    [activeListId, detail.data?.intents],
  );
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
        <ScreenState loading title="Cargando lista" />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen scroll={false}>
        <ScreenState
          title="No se pudo abrir el grupo"
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

  const submitItem = () => {
    if (!activeListId) return;
    try {
      const normalized = normalizeShoppingItemInput(newItem);
      setInputError(null);
      addIntent.mutate(
        { shoppingListId: activeListId, ...normalized },
        { onSuccess: () => setNewItem("") },
      );
    } catch (error) {
      setInputError(getErrorMessage(error));
    }
  };

  const submitPostalCode = () => {
    if (!activeListId) return;
    if (!isValidSpanishPostalCode(postalCode)) {
      setPostalCodeError("El código postal debe tener cinco dígitos.");
      return;
    }
    setPostalCodeError(null);
    updatePostalCode.mutate({ shoppingListId: activeListId, postalCode });
  };

  const shareInvite = async () => {
    const inviteCode = generateInvite.data;
    if (!inviteCode) return;
    setShareError(null);
    try {
      await Share.share({
        title: `Invitación a ${detail.data.group.name}`,
        message: `Únete a ${detail.data.group.name} en shopping-app.\nCódigo: ${inviteCode}\n${createInviteLink(inviteCode)}`,
      });
    } catch (error) {
      setShareError(getErrorMessage(error));
    }
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.title}>{detail.data.group.name}</Text>
        <Text style={styles.muted}>
          {detail.data.members.length} miembro(s)
        </Text>
      </View>

      {joinOutcome ? (
        <Text style={styles.successBanner}>
          {joinOutcome === "already-member"
            ? "Ya eras miembro de este grupo."
            : "Te has unido al grupo correctamente."}
        </Text>
      ) : null}

      <View style={styles.membersBox}>
        <Text style={styles.sectionTitle}>Miembros</Text>
        {detail.data.members.map((member) => (
          <Text key={member.profile_id} style={styles.muted}>
            {member.displayName ?? "Miembro sin nombre"} ·{" "}
            {member.role === "owner" ? "propietario" : "miembro"}
          </Text>
        ))}
      </View>

      {detail.data.lists.length === 0 ? (
        <ScreenState
          title="Este grupo no tiene listas"
          message="Crea una lista desde una próxima versión de la app."
        />
      ) : (
        <>
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

          <Text style={styles.sectionTitle}>{activeList?.name}</Text>
          <View style={styles.postalBox}>
            <AppInput
              error={postalCodeError ?? undefined}
              keyboardType="number-pad"
              label="Código postal para precios"
              maxLength={5}
              onChangeText={setPostalCode}
              value={postalCode}
            />
            {updatePostalCode.error ? (
              <Text style={styles.error}>
                {getErrorMessage(updatePostalCode.error)}
              </Text>
            ) : null}
            <AppButton
              loading={updatePostalCode.isPending}
              tone="secondary"
              onPress={submitPostalCode}
            >
              Actualizar código postal
            </AppButton>
          </View>

          <View style={styles.addBox}>
            <AppInput
              error={inputError ?? undefined}
              label="Añadir producto"
              onChangeText={setNewItem}
              onSubmitEditing={submitItem}
              placeholder="Leche, pan, tomates…"
              returnKeyType="done"
              value={newItem}
            />
            {addIntent.error ? (
              <Text style={styles.error}>
                {getErrorMessage(addIntent.error)}
              </Text>
            ) : null}
            <AppButton loading={addIntent.isPending} onPress={submitItem}>
              Añadir
            </AppButton>
          </View>

          {activeIntents.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.sectionTitle}>La lista está vacía</Text>
              <Text style={styles.muted}>
                Añade el primer producto para empezar.
              </Text>
            </View>
          ) : (
            <View style={styles.items}>
              {activeIntents.map((intent) => (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: intent.checked }}
                  key={intent.id}
                  onPress={() =>
                    toggleIntent.mutate({
                      intentId: intent.id,
                      checked: !intent.checked,
                    })
                  }
                  style={styles.item}
                >
                  <View
                    style={[
                      styles.checkbox,
                      intent.checked && styles.checkboxChecked,
                    ]}
                  >
                    {intent.checked ? (
                      <Text style={styles.checkmark}>✓</Text>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.itemText,
                      intent.checked && styles.itemChecked,
                    ]}
                  >
                    {intent.raw_text}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}

      {isOwner ? (
        <View style={styles.inviteBox}>
          <Text style={styles.sectionTitle}>Invitar a alguien</Text>
          <Text style={styles.muted}>
            El código caduca en 7 días y solo admite un uso.
          </Text>
          <AppButton
            loading={generateInvite.isPending}
            tone="secondary"
            onPress={() => generateInvite.mutate(groupId)}
          >
            Generar código
          </AppButton>
          {generateInvite.data ? (
            <>
              <Text selectable style={styles.code}>
                {generateInvite.data}
              </Text>
              <Text selectable style={styles.link}>
                {createInviteLink(generateInvite.data)}
              </Text>
              <AppButton tone="secondary" onPress={() => void shareInvite()}>
                Compartir código y enlace
              </AppButton>
            </>
          ) : null}
          {generateInvite.error ? (
            <Text style={styles.error}>
              {getErrorMessage(generateInvite.error)}
            </Text>
          ) : null}
          {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs },
  successBanner: {
    color: colors.text,
    backgroundColor: colors.successBackground,
    padding: spacing.md,
    borderRadius: 12,
  },
  membersBox: { gap: spacing.xs },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  muted: { color: colors.muted, lineHeight: 21 },
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
  addBox: { gap: spacing.sm, marginVertical: spacing.sm },
  postalBox: { gap: spacing.sm, marginVertical: spacing.sm },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: "center",
  },
  items: { gap: spacing.sm },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: colors.primary },
  checkmark: { color: "#FFFFFF", fontWeight: "800" },
  itemText: { color: colors.text, fontSize: 16, flex: 1 },
  itemChecked: { color: colors.muted, textDecorationLine: "line-through" },
  inviteBox: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  code: {
    backgroundColor: colors.successBackground,
    color: colors.text,
    padding: spacing.md,
    borderRadius: 10,
    fontFamily: "monospace",
  },
  link: { color: colors.primary, lineHeight: 20 },
  error: { color: colors.danger, lineHeight: 20 },
});
