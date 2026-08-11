import {
  parseShoppingIntents,
  type ShoppingIntentDraft,
  type ShoppingIntentUnit,
} from "@shopping-app/voice-parser";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../../components/app-button";
import { AppInput } from "../../components/app-input";
import { colors, spacing } from "../../lib/theme";
import {
  SpeechRecognitionError,
  type SpeechRecognitionService,
} from "./speech-recognition-service";

interface VoiceShoppingPanelProps {
  adding: boolean;
  onClose: () => void;
  onConfirm: (drafts: readonly ShoppingIntentDraft[]) => Promise<void>;
  service: SpeechRecognitionService;
}

interface EditableDraft {
  id: string;
  source: ShoppingIntentDraft;
  selected: boolean;
  product: string;
  variant: string;
  brandPreference: string;
  requestedQuantity: string;
  requestedUnit: string;
  packageCount: string;
  packageSize: string;
  packageUnit: string;
}

const VALID_UNITS = new Set<ShoppingIntentUnit>([
  "g",
  "kg",
  "ml",
  "cl",
  "l",
  "unit",
  "bottle",
  "can",
  "pack",
]);

export function VoiceShoppingPanel({
  adding,
  onClose,
  onConfirm,
  service,
}: VoiceShoppingPanelProps) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [blockedPermission, setBlockedPermission] = useState(false);

  const startListening = useCallback(async (): Promise<void> => {
    setListening(true);
    setMessage(null);
    setBlockedPermission(false);
    setTranscript("");
    setDrafts([]);
    try {
      const recognized = (
        await service.recognize({
          locale: "es-ES",
        })
      ).trim();
      if (recognized.length === 0) {
        throw new SpeechRecognitionError(
          "EMPTY_TRANSCRIPT",
          "No se ha reconocido ningún producto.",
        );
      }
      const parsed = parseShoppingIntents(recognized);
      setTranscript(recognized);
      setDrafts(parsed.map(toEditableDraft));
      if (parsed.length === 0) {
        setMessage("No hemos identificado productos. Prueba de nuevo.");
      }
    } catch (error) {
      const speechError =
        error instanceof SpeechRecognitionError
          ? error
          : new SpeechRecognitionError(
              "NATIVE_ERROR",
              error instanceof Error
                ? error.message
                : "El reconocimiento de voz ha fallado.",
            );
      setBlockedPermission(speechError.code === "PERMISSION_BLOCKED");
      setMessage(messageForError(speechError));
    } finally {
      setListening(false);
    }
  }, [service]);

  useEffect(() => {
    void startListening();
    return () => {
      service.cancel();
    };
  }, [service, startListening]);

  const confirm = async (): Promise<void> => {
    setMessage(null);
    try {
      const selected = drafts.filter((draft) => draft.selected);
      if (selected.length === 0) {
        setMessage("Selecciona al menos un producto para añadir.");
        return;
      }
      const confirmed = selected.map(fromEditableDraft);
      await onConfirm(confirmed);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Revisa los campos indicados.",
      );
    }
  };

  const updateDraft = (
    id: string,
    patch: Partial<Omit<EditableDraft, "id" | "source">>,
  ): void => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === id ? { ...draft, ...patch } : draft,
      ),
    );
  };

  return (
    <View style={styles.panel}>
      <View style={styles.heading}>
        <Text style={styles.title}>Añadir por voz</Text>
        <Pressable accessibilityRole="button" onPress={onClose}>
          <Text style={styles.action}>Cerrar</Text>
        </Pressable>
      </View>

      {listening ? (
        <View style={styles.listeningBox}>
          <Text style={styles.title}>Escuchando…</Text>
          <Text style={styles.hint}>Di uno o varios productos.</Text>
          <AppButton
            tone="secondary"
            onPress={() => {
              service.stop();
            }}
          >
            Parar escucha
          </AppButton>
        </View>
      ) : (
        <AppButton onPress={() => void startListening()}>
          {transcript ? "Volver a escuchar" : "Empezar a escuchar"}
        </AppButton>
      )}

      {transcript ? (
        <View style={styles.transcriptBox}>
          <Text style={styles.label}>Transcript</Text>
          <Text selectable style={styles.transcript}>
            {transcript}
          </Text>
        </View>
      ) : null}

      {drafts.map((draft, index) => (
        <VoiceDraftEditor
          key={draft.id}
          draft={draft}
          index={index}
          onChange={(patch) => updateDraft(draft.id, patch)}
        />
      ))}

      {message ? <Text style={styles.error}>{message}</Text> : null}
      {blockedPermission ? (
        <AppButton tone="secondary" onPress={() => void service.openSettings()}>
          Abrir Ajustes
        </AppButton>
      ) : null}
      {drafts.length > 0 ? (
        <AppButton
          loading={adding}
          disabled={listening}
          onPress={() => void confirm()}
        >
          Añadir seleccionados
        </AppButton>
      ) : null}
      <Text style={styles.privacy}>
        La app no guarda el audio; solo conserva el texto que confirmes.
      </Text>
    </View>
  );
}

function VoiceDraftEditor({
  draft,
  index,
  onChange,
}: {
  draft: EditableDraft;
  index: number;
  onChange: (patch: Partial<Omit<EditableDraft, "id" | "source">>) => void;
}) {
  const confidenceMessage =
    draft.source.confidence === "HIGH"
      ? "Resultado de alta confianza, preseleccionado."
      : draft.source.confidence === "MEDIUM"
        ? "Revisa y corrige los campos antes de seleccionarlo."
        : "No estamos seguros. Corrige y confirma este producto claramente.";
  return (
    <View
      style={[styles.card, draft.source.confidence === "LOW" && styles.lowCard]}
    >
      <Pressable
        accessibilityLabel={`Seleccionar resultado ${index + 1}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: draft.selected }}
        onPress={() => onChange({ selected: !draft.selected })}
        style={styles.selectionRow}
      >
        <View
          style={[styles.checkbox, draft.selected && styles.checkboxSelected]}
        >
          {draft.selected ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <View style={styles.selectionCopy}>
          <Text style={styles.title}>Resultado {index + 1}</Text>
          <Text style={styles.hint}>{confidenceMessage}</Text>
        </View>
      </Pressable>
      <AppInput
        label="Producto"
        onChangeText={(product) => onChange({ product })}
        value={draft.product}
      />
      {draft.variant.trim() ? (
        <AppInput
          label="Variante"
          onChangeText={(variant) => onChange({ variant })}
          value={draft.variant}
        />
      ) : null}
      {draft.brandPreference.trim() ? (
        <AppInput
          label="Marca"
          onChangeText={(brandPreference) => onChange({ brandPreference })}
          value={draft.brandPreference}
        />
      ) : null}
      <View style={styles.fieldRow}>
        <AppInput
          keyboardType="decimal-pad"
          label="Cantidad"
          onChangeText={(requestedQuantity) => onChange({ requestedQuantity })}
          style={styles.rowInput}
          value={draft.requestedQuantity}
        />
        {shouldShowUnit(draft.requestedUnit) ? (
          <AppInput
            autoCapitalize="none"
            label="Unidad"
            onChangeText={(requestedUnit) => onChange({ requestedUnit })}
            style={styles.rowInput}
            value={draft.requestedUnit}
          />
        ) : null}
      </View>
      {draft.packageCount || draft.packageSize || draft.packageUnit ? (
        <View style={styles.packageBox}>
          <Text style={styles.label}>Formato del envase</Text>
          <View style={styles.fieldRow}>
            <AppInput
              keyboardType="decimal-pad"
              label="Envases"
              onChangeText={(packageCount) => onChange({ packageCount })}
              style={styles.rowInput}
              value={draft.packageCount}
            />
            <AppInput
              keyboardType="decimal-pad"
              label="Tamaño"
              onChangeText={(packageSize) => onChange({ packageSize })}
              style={styles.rowInput}
              value={draft.packageSize}
            />
            {shouldShowUnit(draft.packageUnit) ? (
              <AppInput
                autoCapitalize="none"
                label="Unidad envase"
                onChangeText={(packageUnit) => onChange({ packageUnit })}
                style={styles.rowInput}
                value={draft.packageUnit}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function toEditableDraft(
  draft: ShoppingIntentDraft,
  index: number,
): EditableDraft {
  return {
    id: `${index}:${draft.rawText}`,
    source: draft,
    selected: draft.confidence === "HIGH",
    product: capitalizeFirst(draft.product ?? ""),
    variant: draft.variant ?? "",
    brandPreference: draft.brandPreference ?? "",
    requestedQuantity: numberText(draft.requestedQuantity),
    requestedUnit: capitalizeFirst(draft.requestedUnit ?? ""),
    packageCount: numberText(draft.packageCount),
    packageSize: numberText(draft.packageSize),
    packageUnit: capitalizeFirst(draft.packageUnit ?? ""),
  };
}

function fromEditableDraft(editable: EditableDraft): ShoppingIntentDraft {
  const product = editable.product.trim();
  if (!product)
    throw new TypeError("Cada resultado seleccionado necesita un producto.");
  const requestedQuantity = optionalPositiveNumber(
    editable.requestedQuantity,
    "cantidad",
  );
  const requestedUnit = optionalUnit(editable.requestedUnit, "unidad");
  if ((requestedQuantity === undefined) !== (requestedUnit === undefined)) {
    throw new TypeError("La cantidad y su unidad deben indicarse juntas.");
  }
  const packageCount = optionalPositiveInteger(
    editable.packageCount,
    "número de envases",
  );
  const packageSize = optionalPositiveNumber(
    editable.packageSize,
    "tamaño del envase",
  );
  const packageUnit = optionalUnit(editable.packageUnit, "unidad del envase");
  if ((packageSize === undefined) !== (packageUnit === undefined)) {
    throw new TypeError(
      "El tamaño y la unidad del envase deben indicarse juntos.",
    );
  }
  const totalAmount =
    packageSize !== undefined
      ? (packageCount ?? requestedQuantity ?? 1) * packageSize
      : requestedQuantity !== undefined &&
          requestedUnit !== undefined &&
          requestedUnit !== "unit" &&
          requestedUnit !== "bottle" &&
          requestedUnit !== "can" &&
          requestedUnit !== "pack"
        ? requestedQuantity
        : undefined;
  return {
    rawText: editable.source.rawText,
    confidence: editable.source.confidence,
    product,
    ...(editable.variant.trim() ? { variant: editable.variant.trim() } : {}),
    ...(editable.brandPreference.trim()
      ? { brandPreference: editable.brandPreference.trim() }
      : {}),
    ...(requestedQuantity === undefined ? {} : { requestedQuantity }),
    ...(requestedUnit === undefined ? {} : { requestedUnit }),
    ...(packageCount === undefined ? {} : { packageCount }),
    ...(packageSize === undefined ? {} : { packageSize }),
    ...(packageUnit === undefined ? {} : { packageUnit }),
    ...(totalAmount === undefined ? {} : { totalAmount }),
  };
}

function optionalPositiveNumber(
  value: string,
  label: string,
): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError(`La ${label} debe ser un número mayor que cero.`);
  }
  return parsed;
}

function optionalPositiveInteger(
  value: string,
  label: string,
): number | undefined {
  const parsed = optionalPositiveNumber(value, label);
  if (parsed !== undefined && !Number.isInteger(parsed)) {
    throw new TypeError(`El ${label} debe ser un número entero.`);
  }
  return parsed;
}

function optionalUnit(
  value: string,
  label: string,
): ShoppingIntentUnit | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!VALID_UNITS.has(normalized as ShoppingIntentUnit)) {
    throw new TypeError(`La ${label} no es válida.`);
  }
  return normalized as ShoppingIntentUnit;
}

function numberText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function shouldShowUnit(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unit";
}

function messageForError(error: SpeechRecognitionError): string {
  switch (error.code) {
    case "PERMISSION_DENIED":
      return "Necesitamos permiso de micrófono y reconocimiento de voz para escuchar.";
    case "PERMISSION_BLOCKED":
      return "El permiso está bloqueado. Actívalo desde los Ajustes del dispositivo.";
    case "CANCELLED":
      return "Escucha cancelada.";
    case "TIMEOUT":
      return "No se detectó voz a tiempo. Puedes intentarlo de nuevo.";
    case "UNAVAILABLE":
      return "El reconocimiento de voz no está disponible en este dispositivo.";
    case "EMPTY_TRANSCRIPT":
      return "No se ha reconocido ningún producto. Inténtalo de nuevo.";
    case "NATIVE_ERROR":
      return `Error de reconocimiento: ${error.message}`;
  }
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, marginVertical: spacing.sm },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" },
  action: { color: colors.primary, fontWeight: "700" },
  hint: { color: colors.muted, lineHeight: 20 },
  label: { color: colors.text, fontWeight: "700" },
  listeningBox: {
    backgroundColor: colors.successBackground,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  transcriptBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  transcript: { color: colors.text, lineHeight: 22 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lowCard: { borderColor: colors.danger },
  selectionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  selectionCopy: { flex: 1 },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: { backgroundColor: colors.primary },
  checkmark: { color: "#FFFFFF", fontWeight: "800" },
  fieldRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rowInput: { minWidth: 112 },
  packageBox: { gap: spacing.sm },
  error: { color: colors.danger, lineHeight: 20, fontWeight: "600" },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
