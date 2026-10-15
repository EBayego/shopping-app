import { QuickAddPanel } from "../../features/groups/quick-add-panel";
import { ShoppingItemCard } from "../../features/groups/shopping-item-card";
import { ProductLinkModal } from "../../features/groups/product-link-modal";
import { readProductLink } from "../../features/groups/product-links";
import { useSupermarketsQuery } from "../../features/supermarkets/queries";
import type { AutomaticLinkResult } from "../../repositories/product-link-repository";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import type { ShoppingIntentDraft } from "@shopping-app/voice-parser";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { AppButton } from "../../components/app-button";
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
  useAutomaticProductLinksMutation,
  useUndoProductLinksMutation,
} from "../../features/groups/queries";

import { useGroupRealtime } from "../../features/groups/realtime";

import {
  textToIntentInput,
  voiceDraftToIntentInput,
} from "../../features/voice/voice-intent-input";
import { VoiceShoppingPanel } from "../../features/voice/voice-shopping-panel";
import { VoiceDiscoveryModal } from "../../features/voice/voice-discovery-modal";
import {
  fieldValuesToDraft,
  PACKAGE_LABELS,
  ShoppingIntentFields,
  type ShoppingIntentFieldValues,
} from "../../features/voice/shopping-intent-fields";

import type { ShoppingIntent } from "../../features/groups/types";
import { getErrorMessage } from "../../lib/errors";
import { createOperationId } from "../../lib/operation-id";
import { useThemedStyles, useTheme } from "../../features/theme/theme-context";
import { spacing, type ThemeColors } from "../../lib/theme";
import { useOfflineSync } from "../../offline/offline-sync-provider";
import { speechRecognitionService } from "../../services/expo-speech-recognition-service";
import { openAiShoppingIntentParser } from "../../services/openai-shopping-intent-parser";

function firstParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function intentToFieldValues(
  intent: ShoppingIntent,
): ShoppingIntentFieldValues {
  const hasStandaloneQuantity =
    intent.package_count === null &&
    (intent.requested_unit !== null || intent.requested_quantity !== 1);
  return {
    product: capitalizeFirst(intent.normalized_name),
    variant: intent.variant ?? "",
    brandPreference: intent.brand_preference ?? "",
    requestedQuantity: hasStandaloneQuantity
      ? numberText(intent.requested_quantity)
      : "",
    requestedUnit: hasStandaloneQuantity
      ? unitText(intent.requested_unit ?? "unit")
      : "",
    packageCount: numberText(intent.package_count),
    packageSize: numberText(intent.package_size),
    packageUnit: unitText(intent.package_unit),
    packageType:
      intent.package_type == null ? "" : PACKAGE_LABELS[intent.package_type],
  };
}

function numberText(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
}

function unitText(value: string | null): string {
  if (value === null) return "";
  if (value === "unit") return "Ud.";
  return capitalizeFirst(value);
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
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
  const automaticLinks = useAutomaticProductLinksMutation(groupId);
  const undoLinks = useUndoProductLinksMutation(groupId);
  const [automaticReport, setAutomaticReport] = useState<{
    listId: string;
    result: AutomaticLinkResult;
  } | null>(null);
  const [linkingIntentId, setLinkingIntentId] = useState<string | null>(null);
  const [checkedOpen, setCheckedOpen] = useState(false);
  const dimensions = useWindowDimensions();
  const columns = dimensions.width < 360 || dimensions.fontScale > 1.25 ? 1 : 2;
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [editingIntentId, setEditingIntentId] = useState<string | null>(null);
  const [editingValues, setEditingValues] =
    useState<ShoppingIntentFieldValues | null>(null);
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

  const supermarkets = useSupermarketsQuery(activeListId);
  const sections = useMemo(() => {
    const rows = (items: readonly ShoppingIntent[]) => {
      const result: ShoppingIntent[][] = [];
      for (let index = 0; index < items.length; index += columns)
        result.push(items.slice(index, index + columns));
      return result;
    };
    const pending = activeIntents.filter((intent) => !intent.checked);
    const checked = activeIntents.filter((intent) => intent.checked);
    return [
      {
        key: "pending",
        title: "Por comprar",
        count: pending.length,
        data: rows(pending),
      },
      {
        key: "checked",
        title: "Comprados",
        count: checked.length,
        data: checkedOpen ? rows(checked) : [],
      },
    ];
  }, [activeIntents, checkedOpen, columns]);
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

  const addFreeItem = async (text: string): Promise<void> => {
    if (!activeListId) return;
    try {
      const normalized = textToIntentInput(text);
      setInputError(null);
      await addIntent.mutateAsync({
        shoppingListId: activeListId,
        operationId: createOperationId(),
        ...normalized,
      });
    } catch (error) {
      setInputError(getErrorMessage(error));
      throw error;
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
    if (editingValues === null) return;
    try {
      const draft = fieldValuesToDraft(editingValues, {
        confidence: "HIGH",
        rawText: editingValues.product.trim(),
      });
      const parsed = voiceDraftToIntentInput(draft);
      setEditingError(null);
      editIntent.mutate(
        {
          intentId,
          operationId: createOperationId(),
          input: {
            rawText: parsed.rawText,
            normalizedName: parsed.normalizedName,
            requestedQuantity: parsed.requestedQuantity ?? 1,
            requestedUnit: parsed.requestedUnit ?? null,
            packageCount: parsed.packageCount ?? null,
            packageSize: parsed.packageSize ?? null,
            packageUnit: parsed.packageUnit ?? null,
            packageType: parsed.packageType ?? null,
            totalAmount: parsed.totalAmount ?? null,
            brandPreference: parsed.brandPreference ?? null,
            variant: parsed.variant ?? null,
          },
        },
        {
          onSuccess: () => {
            setEditingIntentId(null);
            setEditingValues(null);
          },
        },
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

  const report =
    automaticReport?.listId === activeListId ? automaticReport.result : null;
  const linkingIntent = activeIntents.find(
    (intent) => intent.id === linkingIntentId,
  );
  const canAutoLink =
    sync.isOnline &&
    !sync.isSyncing &&
    sync.pendingCount === 0 &&
    sync.conflictCount === 0;
  const header = (
    <View style={styles.header}>
      <Text style={styles.muted}>{detail.data.members.length} miembro(s)</Text>
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
              ? `Sin conexión · ${sync.pendingCount} cambio(s) pendiente(s)`
              : sync.isSyncing
                ? "Sincronizando cambios…"
                : sync.conflictCount > 0
                  ? `${sync.conflictCount} cambio(s) necesitan revisión`
                  : sync.lastError
                    ? `No se pudo sincronizar · ${sync.pendingCount} cambio(s) guardados`
                    : `${sync.pendingCount} cambio(s) pendiente(s)`}
          </Text>
          {sync.isOnline && !sync.isSyncing && sync.pendingCount > 0 ? (
            <Pressable accessibilityRole="button" onPress={sync.syncNow}>
              <Text style={styles.actionText}>Reintentar</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {detail.data.lists.length > 1 ? (
        <View style={styles.tabs}>
          {detail.data.lists.map((list) => (
            <Pressable
              key={list.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeListId === list.id }}
              onPress={() => setSelectedListId(list.id)}
              style={[styles.tab, activeListId === list.id && styles.activeTab]}
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
      <Text style={styles.listTitle}>{activeList?.name ?? "Tu lista"}</Text>
      <Text style={styles.muted}>Lo que necesitas, a tu manera.</Text>
      <View style={styles.addBox}>
        {!voiceOpen && activeListId ? (
          <QuickAddPanel
            adding={addIntent.isPending}
            onAdd={addFreeItem}
            onVoicePress={() => setVoiceOpen(true)}
          />
        ) : voiceOpen ? (
          <VoiceShoppingPanel
            adding={addIntent.isPending}
            onClose={() => setVoiceOpen(false)}
            onConfirm={addVoiceDrafts}
            service={speechRecognitionService}
            aiParser={openAiShoppingIntentParser}
          />
        ) : null}
        {inputError || addIntent.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {inputError ?? getErrorMessage(addIntent.error)}
          </Text>
        ) : null}
      </View>
      {activeListId && activeIntents.some((intent) => !intent.checked) ? (
        <View style={styles.toolbar}>
          <AppButton
            loading={automaticLinks.isPending}
            disabled={!canAutoLink || undoLinks.isPending}
            icon={<Ionicons name="link-outline" size={20} color="#FFFFFF" />}
            onPress={() =>
              automaticLinks.mutate(
                {
                  shoppingListId: activeListId,
                  operationId: createOperationId(),
                },
                {
                  onSuccess: (result) =>
                    setAutomaticReport({ listId: activeListId, result }),
                },
              )
            }
          >
            Enlazar automáticamente
          </AppButton>
          <Text style={styles.caption}>
            {canAutoLink
              ? "Busca el equivalente más barato por artículo entre tus supermercados. Conserva los enlaces manuales."
              : "Disponible con conexión y después de sincronizar los cambios."}
          </Text>
          <AppButton
            tone="secondary"
            onPress={() => router.push(`/comparison/${activeListId}`)}
          >
            Comparar cesta entre supermercados
          </AppButton>
        </View>
      ) : null}
      {report ? (
        <View accessibilityLiveRegion="polite" style={styles.successBanner}>
          <Text style={styles.bodyText}>
            {report.applied} {report.applied === 1 ? "enlazado" : "enlazados"} ·{" "}
            {report.unresolved} por revisar
            {report.skipped > 0
              ? ` · ${report.skipped} han cambiado durante la búsqueda`
              : ""}
          </Text>
          {report.preservedManual > 0 ? (
            <Text style={styles.caption}>
              {report.preservedManual} enlace(s) manual(es) conservados.
            </Text>
          ) : null}
          {report.applied > 0 ? (
            <AppButton
              tone="secondary"
              loading={undoLinks.isPending}
              disabled={!canAutoLink || automaticLinks.isPending}
              onPress={() =>
                undoLinks.mutate(
                  { batchId: report.batchId, operationId: createOperationId() },
                  {
                    onSuccess: () => setAutomaticReport(null),
                  },
                )
              }
            >
              Deshacer enlaces automáticos
            </AppButton>
          ) : null}
        </View>
      ) : null}
      {automaticLinks.error || undoLinks.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {getErrorMessage(automaticLinks.error ?? undoLinks.error)}
        </Text>
      ) : null}
      {detail.data.lists.length === 0 ? (
        <ScreenState
          title="Este grupo no tiene listas"
          message="Crea una lista desde una próxima versión de la app."
        />
      ) : activeIntents.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.sectionTitle}>Tu lista empieza aquí</Text>
          <Text style={styles.muted}>
            Escribe el primer producto para añadirlo.
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      <Stack.Screen
        options={{
          title: detail.data.group.name,
          headerRight: () => (
            <Pressable
              accessibilityLabel="Ajustes del grupo"
              accessibilityRole="button"
              hitSlop={6}
              onPress={() =>
                router.push({
                  pathname: "/groups/settings/[groupId]",
                  params: { groupId },
                })
              }
              style={styles.headerIconButton}
            >
              <Ionicons color={colors.text} name="settings-outline" size={24} />
            </Pressable>
          ),
        }}
      />
      <VoiceDiscoveryModal />
      <SectionList
        sections={sections}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        keyExtractor={(row) => row.map((intent) => intent.id).join(":")}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) =>
          section.count > 0 ? (
            <Pressable
              accessibilityRole={
                section.key === "checked" ? "button" : "header"
              }
              accessibilityState={
                section.key === "checked" ? { expanded: checkedOpen } : {}
              }
              disabled={section.key !== "checked"}
              onPress={() => setCheckedOpen((open) => !open)}
              style={styles.sectionHeading}
            >
              <Text style={styles.sectionTitle}>
                {section.title} · {section.count}
              </Text>
              {section.key === "checked" ? (
                <Ionicons
                  color={colors.muted}
                  name={checkedOpen ? "chevron-up" : "chevron-down"}
                  size={20}
                />
              ) : null}
            </Pressable>
          ) : null
        }
        renderItem={({ item: row }) => (
          <View style={styles.cardRow}>
            {row.map((intent) => {
              const productLink = readProductLink(intent.product_link);
              const enabled =
                !productLink ||
                supermarkets.data?.find(
                  (item) => item.retailerId === productLink.retailerId,
                )?.enabled !== false;
              return (
                <ShoppingItemCard
                  key={intent.id}
                  intent={intent}
                  retailerEnabled={enabled}
                  onToggle={() =>
                    toggleIntent.mutate({
                      intentId: intent.id,
                      checked: !intent.checked,
                      operationId: createOperationId(),
                    })
                  }
                  onQuantity={(direction) =>
                    changeQuantity.mutate({
                      intentId: intent.id,
                      direction,
                      operationId: createOperationId(),
                    })
                  }
                  onDelete={() =>
                    deleteIntent.mutate({
                      intentId: intent.id,
                      operationId: createOperationId(),
                    })
                  }
                  onLink={() => setLinkingIntentId(intent.id)}
                  onEdit={() => {
                    setEditingIntentId(intent.id);
                    setEditingValues(intentToFieldValues(intent));
                    setEditingError(null);
                  }}
                />
              );
            })}
            {row.length < columns ? <View style={styles.spacer} /> : null}
          </View>
        )}
        ListFooterComponent={
          mutationError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {getErrorMessage(mutationError)}
            </Text>
          ) : null
        }
      />
      {linkingIntent ? (
        <ProductLinkModal
          key={linkingIntent.id}
          intent={linkingIntent}
          groupId={groupId}
          onClose={() => setLinkingIntentId(null)}
        />
      ) : null}
      <Modal
        visible={editingIntentId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setEditingIntentId(null);
          setEditingValues(null);
        }}
      >
        <Screen>
          <Text style={styles.listTitle}>Editar producto</Text>
          {editingValues && editingIntentId ? (
            <>
              <ShoppingIntentFields
                autoFocus
                showEmptyOptionalFields
                values={editingValues}
                onChange={(patch) =>
                  setEditingValues((current) =>
                    current === null ? null : { ...current, ...patch },
                  )
                }
              />
              {editingError || editIntent.error ? (
                <Text style={styles.error}>
                  {editingError ?? getErrorMessage(editIntent.error)}
                </Text>
              ) : null}
              <AppButton
                loading={editIntent.isPending}
                onPress={() => submitIntentEdit(editingIntentId)}
              >
                Guardar
              </AppButton>
            </>
          ) : null}
          <AppButton
            tone="secondary"
            onPress={() => {
              setEditingIntentId(null);
              setEditingValues(null);
            }}
          >
            Cancelar
          </AppButton>
        </Screen>
      </Modal>
    </Screen>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    list: { flex: 1 },
    listContent: { paddingBottom: spacing.xl },
    header: { gap: spacing.md, marginBottom: spacing.sm },
    headerIconButton: {
      alignItems: "center",
      borderRadius: 20,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
    listTitle: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: -0.5,
    },
    successBanner: {
      color: colors.text,
      backgroundColor: colors.successBackground,
      padding: spacing.md,
      borderRadius: 18,
      gap: spacing.sm,
    },
    syncBanner: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    syncErrorBanner: { borderColor: colors.danger },
    syncText: { color: colors.muted, flex: 1 },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
    sectionHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.md,
    },
    muted: { color: colors.muted, lineHeight: 21 },
    bodyText: { color: colors.text, lineHeight: 22 },
    caption: { color: colors.muted, lineHeight: 19, fontSize: 12 },
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
    addBox: { gap: spacing.sm },
    toolbar: { gap: spacing.sm },
    empty: {
      backgroundColor: colors.surface,
      borderRadius: 24,
      padding: spacing.lg,
      gap: spacing.sm,
      alignItems: "center",
    },
    cardRow: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: 12,
      marginBottom: 12,
    },
    spacer: { flex: 1 },
    actionText: {
      color: colors.primary,
      fontWeight: "700",
      padding: spacing.xs,
    },
    error: { color: colors.danger, lineHeight: 20 },
  });
