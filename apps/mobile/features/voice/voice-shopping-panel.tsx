import {
  parseShoppingIntentSegments,
  type ShoppingIntentDraft,
} from "@shopping-app/voice-parser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../../components/app-button";
import { useThemedStyles } from "../theme/theme-context";
import { spacing, type ThemeColors } from "../../lib/theme";
import {
  SpeechRecognitionError,
  type SpeechRecognitionService,
} from "./speech-recognition-service";
import {
  draftToFieldValues,
  fieldValuesToDraft,
  ShoppingIntentFields,
  type ShoppingIntentFieldValues,
} from "./shopping-intent-fields";

interface VoiceShoppingPanelProps {
  adding: boolean;
  onClose: () => void;
  onConfirm: (drafts: readonly ShoppingIntentDraft[]) => Promise<void>;
  service: SpeechRecognitionService;
}

interface EditableDraft extends ShoppingIntentFieldValues {
  id: string;
  source: ShoppingIntentDraft;
  selected: boolean;
}

const WAVEFORM_BAR_COUNT = 28;
const EMPTY_WAVEFORM = Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0);

export function VoiceShoppingPanel({
  adding,
  onClose,
  onConfirm,
  service,
}: VoiceShoppingPanelProps) {
  const styles = useThemedStyles(createStyles);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [blockedPermission, setBlockedPermission] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [waveform, setWaveform] = useState<readonly number[]>(EMPTY_WAVEFORM);
  const startedAt = useRef<number | null>(null);

  const handleVolumeChange = useCallback((level: number): void => {
    setWaveform((current) => [...current.slice(1), clamp(level, 0, 1)]);
  }, []);

  const startListening = useCallback(async (): Promise<void> => {
    setListening(true);
    setMessage(null);
    setBlockedPermission(false);
    setTranscript("");
    setDrafts([]);
    setDurationSeconds(0);
    setWaveform(EMPTY_WAVEFORM);
    startedAt.current = Date.now();
    try {
      const recognized = await service.recognize({
        locale: "es-ES",
        onVolumeChange: handleVolumeChange,
      });
      if (recognized.transcript.trim().length === 0) {
        throw new SpeechRecognitionError(
          "EMPTY_TRANSCRIPT",
          "No se ha reconocido ningún producto.",
        );
      }
      const parsed = parseShoppingIntentSegments(recognized.segments);
      setTranscript(recognized.transcript);
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
      startedAt.current = null;
      setListening(false);
    }
  }, [handleVolumeChange, service]);

  useEffect(() => {
    if (!listening) return undefined;
    const timer = setInterval(() => {
      if (startedAt.current !== null) {
        setDurationSeconds(
          Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)),
        );
      }
    }, 250);
    return () => clearInterval(timer);
  }, [listening]);

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
          <AudioWaveform durationSeconds={durationSeconds} levels={waveform} />
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
  const styles = useThemedStyles(createStyles);
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
      <ShoppingIntentFields onChange={onChange} values={draft} />
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
    ...draftToFieldValues(draft),
  };
}

function fromEditableDraft(editable: EditableDraft): ShoppingIntentDraft {
  return fieldValuesToDraft(editable, editable.source);
}

function AudioWaveform({
  durationSeconds,
  levels,
}: {
  durationSeconds: number;
  levels: readonly number[];
}) {
  const styles = useThemedStyles(createStyles);
  const duration = formatDuration(durationSeconds);
  return (
    <View
      accessibilityLabel={`Duración de grabación ${duration}`}
      style={styles.waveformRow}
    >
      <View accessibilityElementsHidden style={styles.waveform}>
        {levels.map((level, index) => (
          <View
            key={index}
            style={[styles.waveformBar, { height: 4 + Math.round(level * 28) }]}
          />
        ))}
      </View>
      <Text style={styles.duration}>{duration}</Text>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    waveformRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 40,
    },
    waveform: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 2,
      height: 36,
    },
    waveformBar: {
      backgroundColor: colors.primary,
      borderRadius: 2,
      flex: 1,
      minWidth: 2,
    },
    duration: {
      color: colors.text,
      fontVariant: ["tabular-nums"],
      fontWeight: "700",
      minWidth: 46,
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
    selectionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
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
    error: { color: colors.danger, lineHeight: 20, fontWeight: "600" },
    privacy: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  });
