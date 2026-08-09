import { useQueryClient } from "@tanstack/react-query";
import type { ShoppingIntentDraft } from "@shopping-app/voice-parser";
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
  useChangeIntentQuantityMutation,
  useDeleteIntentMutation,
  useEditIntentMutation,
  useGenerateInviteMutation,
  useGroupDetailQuery,
  useToggleIntentMutation,
  useUpdatePostalCodeMutation,
} from "../../features/groups/queries";
import { useGroupRealtime } from "../../features/groups/realtime";
import { createInviteLink } from "../../features/groups/invites";
import { resultName } from "../../features/search/formatting";
import { ProductSearchPanel } from "../../features/search/product-search-panel";
import type { ProductSearchResult } from "../../features/search/types";
import { voiceDraftToIntentInput } from "../../features/voice/voice-intent-input";
import { VoiceShoppingPanel } from "../../features/voice/voice-shopping-panel";
import {
  isValidSpanishPostalCode,
  normalizeShoppingItemInput,
} from "../../features/groups/validation";
import { getErrorMessage } from "../../lib/errors";
import { createOperationId } from "../../lib/operation-id";
import { colors, spacing } from "../../lib/theme";
import { useOfflineSync } from "../../offline/offline-sync-provider";
import { speechRecognitionService } from "../../services/expo-speech-recognition-service";

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
  const queryClient = useQueryClient();
  const sync = useOfflineSync();
  const detail = useGroupDetailQuery(groupId);
  const addIntent = useAddIntentMutation(groupId);
  const toggleIntent = useToggleIntentMutation(groupId);
  const editIntent = useEditIntentMutation(groupId);
  const changeQuantity = useChangeIntentQuantityMutation(groupId);
  const deleteIntent = useDeleteIntentMutation(groupId);
  const generateInvite = useGenerateInviteMutation();
  const updatePostalCode = useUpdatePostalCodeMutation(groupId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState("");
  const [postalCodeError, setPostalCodeError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [editingIntentId, setEditingIntentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);

  useGroupRealtime(
    groupId,
    session.status === "ready" && groupId.length > 0 && sync.isOnline,
    queryClient,
  );

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

  const addFreeItem = (text: string) => {
    if (!activeListId) return;
    try {
      const normalized = normalizeShoppingItemInput(text);
      setInputError(null);
      addIntent.mutate(
        {
          shoppingListId: activeListId,
          operationId: createOperationId(),
          ...normalized,
        },
        { onSuccess: () => setSearchOpen(false) },
      );
    } catch (error) {
      setInputError(getErrorMessage(error));
    }
  };

  const addSearchResult = (result: ProductSearchResult) => {
    if (!activeListId) return;
    try {
      const name = resultName(result);
      const normalized = result.canonicalProduct
        ? {
            rawText: name,
            normalizedName: result.canonicalProduct.normalizedName,
          }
        : normalizeShoppingItemInput(name);
      setInputError(null);
      addIntent.mutate(
        {
          shoppingListId: activeListId,
          operationId: createOperationId(),
          ...normalized,
          canonicalProductId: result.canonicalProduct?.id ?? null,
        },
        { onSuccess: () => setSearchOpen(false) },
      );
    } catch (error) {
      setInputError(getErrorMessage(error));
    }
  };

  const addVoiceDrafts = async (
    drafts: readonly ShoppingIntentDraft[],
  ): Promise<void> => {
    if (!activeListId) return;
    setInputError(null);
    for (const draft of drafts) {
      await addIntent.mutateAsync({
        shoppingListId: activeListId,
        operationId: createOperationId(),
        ...voiceDraftToIntentInput(draft),
      });
    }
    setVoiceOpen(false);
  };

  const submitPostalCode = () => {
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

  const submitIntentEdit = (intentId: string) => {
    try {
      const normalized = normalizeShoppingItemInput(editingText);
      setEditingError(null);
      editIntent.mutate(
        { intentId, operationId: createOperationId(), ...normalized },
        { onSuccess: () => setEditingIntentId(null) },
      );
    } catch (error) {
      setEditingError(getErrorMessage(error));
    }
  };

  const mutationError =
    toggleIntent.error ??
    editIntent.error ??
    changeQuantity.error ??
    deleteIntent.error;

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

      {!sync.isOnline ||
      sync.isSyncing ||
      sync.pendingCount > 0 ||
      sync.conflictCount > 0 ? (
        <View
          style={[
            styles.syncBanner,
            sync.conflictCount > 0 && styles.syncErrorBanner,
          ]}
        >
          <Text style={styles.syncText}>
            {!sync.isOnline
              ? `Sin conexión${sync.pendingCount > 0 ? ` · ${sync.pendingCount} cambio(s) pendiente(s)` : ""}`
              : sync.isSyncing
                ? "Sincronizando cambios…"
                : sync.conflictCount > 0
                  ? `${sync.conflictCount} cambio(s) necesitan revisión`
                  : sync.lastError && sync.pendingCount > 0
                    ? `No se pudo sincronizar · ${sync.pendingCount} cambio(s) siguen seguros en el dispositivo`
                    : `${sync.pendingCount} cambio(s) pendiente(s)`}
          </Text>
          {sync.isOnline && !sync.isSyncing && sync.pendingCount > 0 ? (
            <Pressable onPress={sync.syncNow}>
              <Text style={styles.actionText}>Reintentar</Text>
            </Pressable>
          ) : null}
        </View>
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
            {searchOpen && activeListId ? (
              <ProductSearchPanel
                adding={addIntent.isPending}
                onAddFreeItem={addFreeItem}
                onClose={() => setSearchOpen(false)}
                onSelectProduct={addSearchResult}
                shoppingListId={activeListId}
              />
            ) : voiceOpen ? (
              <VoiceShoppingPanel
                adding={addIntent.isPending}
                onClose={() => setVoiceOpen(false)}
                onConfirm={addVoiceDrafts}
                service={speechRecognitionService}
              />
            ) : (
              <View style={styles.addActions}>
                <AppButton
                  style={styles.addAction}
                  onPress={() => {
                    setVoiceOpen(false);
                    setSearchOpen(true);
                  }}
                >
                  Añadir producto
                </AppButton>
                <AppButton
                  style={styles.addAction}
                  tone="secondary"
                  onPress={() => {
                    setSearchOpen(false);
                    setVoiceOpen(true);
                  }}
                >
                  🎙 Añadir por voz
                </AppButton>
              </View>
            )}
            {inputError ? <Text style={styles.error}>{inputError}</Text> : null}
            {addIntent.error ? (
              <Text style={styles.error}>
                {getErrorMessage(addIntent.error)}
              </Text>
            ) : null}
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
                <View key={intent.id} style={styles.item}>
                  <Pressable
                    accessibilityLabel={
                      intent.checked ? "Desmarcar producto" : "Marcar producto"
                    }
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: intent.checked }}
                    onPress={() =>
                      toggleIntent.mutate({
                        intentId: intent.id,
                        checked: !intent.checked,
                        operationId: createOperationId(),
                      })
                    }
                    style={[
                      styles.checkbox,
                      intent.checked && styles.checkboxChecked,
                    ]}
                  >
                    {intent.checked ? (
                      <Text style={styles.checkmark}>✓</Text>
                    ) : null}
                  </Pressable>
                  <View style={styles.itemBody}>
                    {editingIntentId === intent.id ? (
                      <>
                        <AppInput
                          autoFocus
                          error={editingError ?? undefined}
                          label="Nombre del producto"
                          onChangeText={setEditingText}
                          onSubmitEditing={() => submitIntentEdit(intent.id)}
                          value={editingText}
                        />
                        <View style={styles.itemActions}>
                          <AppButton
                            loading={editIntent.isPending}
                            style={styles.smallButton}
                            onPress={() => submitIntentEdit(intent.id)}
                          >
                            Guardar
                          </AppButton>
                          <AppButton
                            style={styles.smallButton}
                            tone="secondary"
                            onPress={() => setEditingIntentId(null)}
                          >
                            Cancelar
                          </AppButton>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text
                          style={[
                            styles.itemText,
                            intent.checked && styles.itemChecked,
                          ]}
                        >
                          {intent.raw_text}
                        </Text>
                        <View style={styles.itemActions}>
                          <Pressable
                            accessibilityLabel="Reducir cantidad"
                            onPress={() =>
                              changeQuantity.mutate({
                                intentId: intent.id,
                                direction: "decrement",
                                operationId: createOperationId(),
                              })
                            }
                            style={styles.quantityButton}
                          >
                            <Text style={styles.quantityButtonText}>−</Text>
                          </Pressable>
                          <Text style={styles.quantity}>
                            {intent.requested_quantity ?? 1}
                          </Text>
                          <Pressable
                            accessibilityLabel="Aumentar cantidad"
                            onPress={() =>
                              changeQuantity.mutate({
                                intentId: intent.id,
                                direction: "increment",
                                operationId: createOperationId(),
                              })
                            }
                            style={styles.quantityButton}
                          >
                            <Text style={styles.quantityButtonText}>+</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              setEditingIntentId(intent.id);
                              setEditingText(intent.raw_text);
                              setEditingError(null);
                            }}
                          >
                            <Text style={styles.actionText}>Editar</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              deleteIntent.mutate({
                                intentId: intent.id,
                                operationId: createOperationId(),
                              })
                            }
                          >
                            <Text style={styles.deleteText}>Eliminar</Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
          {mutationError ? (
            <Text style={styles.error}>{getErrorMessage(mutationError)}</Text>
          ) : null}
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
  addActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  addAction: { flexGrow: 1 },
  successBanner: {
    color: colors.text,
    backgroundColor: colors.successBackground,
    padding: spacing.md,
    borderRadius: 12,
  },
  syncBanner: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  syncErrorBanner: { borderColor: colors.danger },
  syncText: { color: colors.muted, flex: 1 },
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
  itemBody: { flex: 1, gap: spacing.sm },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
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
  quantityButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  quantityButtonText: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: "700",
  },
  quantity: {
    color: colors.text,
    minWidth: 24,
    textAlign: "center",
    fontWeight: "700",
  },
  actionText: { color: colors.primary, fontWeight: "700", padding: spacing.xs },
  deleteText: { color: colors.danger, fontWeight: "700", padding: spacing.xs },
  smallButton: { minHeight: 40, flexGrow: 1 },
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
