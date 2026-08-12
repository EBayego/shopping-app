import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import type { ShoppingIntentDraft } from "@shopping-app/voice-parser";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  useGroupDetailQuery,
  useToggleIntentMutation,
} from "../../features/groups/queries";
import { formatShoppingIntent } from "../../features/groups/intent-formatting";
import { useGroupRealtime } from "../../features/groups/realtime";
import { resultName } from "../../features/search/formatting";
import { ProductSearchPanel } from "../../features/search/product-search-panel";
import type { ProductSearchResult } from "../../features/search/types";
import { voiceDraftToIntentInput } from "../../features/voice/voice-intent-input";
import { VoiceShoppingPanel } from "../../features/voice/voice-shopping-panel";
import { VoiceDiscoveryModal } from "../../features/voice/voice-discovery-modal";
import { normalizeShoppingItemInput } from "../../features/groups/validation";
import { getErrorMessage } from "../../lib/errors";
import { createOperationId } from "../../lib/operation-id";
import { useThemedStyles, useTheme } from "../../features/theme/theme-context";
import { spacing, type ThemeColors } from "../../lib/theme";
import { useOfflineSync } from "../../offline/offline-sync-provider";
import { speechRecognitionService } from "../../services/expo-speech-recognition-service";

function firstParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function GroupDetailScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const params = useLocalSearchParams<{
    groupId: string | string[];
    joinOutcome?: string | string[];
  }>();
  const groupId = firstParameter(params.groupId);
  const router = useRouter();
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
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
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

  const addFreeItem = (text: string) => {
    if (!activeListId) return;
    try {
      const normalized = normalizeShoppingItemInput(text);
      setInputError(null);
      addIntent.mutate({
        shoppingListId: activeListId,
        operationId: createOperationId(),
        ...normalized,
      });
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
      addIntent.mutate({
        shoppingListId: activeListId,
        operationId: createOperationId(),
        ...normalized,
        canonicalProductId: result.canonicalProduct?.id ?? null,
      });
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

  return (
    <Screen>
      <VoiceDiscoveryModal />
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>{detail.data.group.name}</Text>
          <Text style={styles.muted}>
            {detail.data.members.length} miembro(s)
          </Text>
        </View>
        <AppButton
          tone="secondary"
          onPress={() =>
            router.push({
              pathname: "/groups/settings/[groupId]",
              params: { groupId },
            })
          }
        >
          Ajustes del grupo
        </AppButton>
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
          {activeListId && activeIntents.length > 0 ? (
            <AppButton
              tone="secondary"
              onPress={() => router.push(`/comparison/${activeListId}`)}
            >
              Comparar cesta entre supermercados
            </AppButton>
          ) : null}

          <View style={styles.addBox}>
            {!voiceOpen && activeListId ? (
              <ProductSearchPanel
                adding={addIntent.isPending}
                onAddFreeItem={addFreeItem}
                onSelectProduct={addSearchResult}
                onVoicePress={() => setVoiceOpen(true)}
                shoppingListId={activeListId}
              />
            ) : voiceOpen ? (
              <VoiceShoppingPanel
                adding={addIntent.isPending}
                onClose={() => setVoiceOpen(false)}
                onConfirm={addVoiceDrafts}
                service={speechRecognitionService}
              />
            ) : null}
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
              {activeIntents.map((intent) => {
                const display = formatShoppingIntent(intent);
                return (
                  <View key={intent.id} style={styles.item}>
                    <Pressable
                      accessibilityLabel={
                        intent.checked
                          ? "Desmarcar producto"
                          : "Marcar producto"
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
                            {display.title}
                          </Text>
                          <View style={styles.quantityControls}>
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
                              {display.quantity}
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
                            {display.unit ? (
                              <Text style={styles.quantityUnit}>
                                {display.unit}
                              </Text>
                            ) : null}
                          </View>
                        </>
                      )}
                    </View>
                    {editingIntentId !== intent.id ? (
                      <View style={styles.itemIconActions}>
                        <Pressable
                          accessibilityLabel={`Editar ${display.title}`}
                          accessibilityRole="button"
                          hitSlop={6}
                          onPress={() => {
                            setEditingIntentId(intent.id);
                            setEditingText(intent.raw_text);
                            setEditingError(null);
                          }}
                          style={({ pressed }) => [
                            styles.iconButton,
                            pressed && styles.iconButtonPressed,
                          ]}
                        >
                          <Ionicons
                            color={colors.primary}
                            name="create-outline"
                            size={21}
                          />
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`Eliminar ${display.title}`}
                          accessibilityRole="button"
                          hitSlop={6}
                          onPress={() =>
                            deleteIntent.mutate({
                              intentId: intent.id,
                              operationId: createOperationId(),
                            })
                          }
                          style={({ pressed }) => [
                            styles.iconButton,
                            styles.deleteIconButton,
                            pressed && styles.iconButtonPressed,
                          ]}
                        >
                          <Ionicons
                            color={colors.danger}
                            name="trash-outline"
                            size={21}
                          />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
          {mutationError ? (
            <Text style={styles.error}>{getErrorMessage(mutationError)}</Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    heading: { gap: spacing.sm },
    headingCopy: { gap: spacing.xs },
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
    quantityControls: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    itemIconActions: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.xs,
    },
    iconButton: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
    deleteIconButton: {
      backgroundColor: colors.dangerBackground,
      borderColor: colors.danger,
    },
    iconButtonPressed: { opacity: 0.65 },
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
    quantityUnit: { color: colors.muted, fontWeight: "600" },
    actionText: {
      color: colors.primary,
      fontWeight: "700",
      padding: spacing.xs,
    },
    smallButton: { minHeight: 40, flexGrow: 1 },
    error: { color: colors.danger, lineHeight: 20 },
  });
