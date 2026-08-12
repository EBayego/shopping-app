import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { secureStoreAdapter } from "../../services/secure-store-adapter";
import { spacing, type ThemeColors } from "../../lib/theme";
import { useThemedStyles } from "../theme/theme-context";

const DISMISSED_KEY = "voice-discovery-dismissed-v1";

export function VoiceDiscoveryModal() {
  const styles = useThemedStyles(createStyles);
  const [visible, setVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setDontShowAgain(false);
      void secureStoreAdapter
        .getItem(DISMISSED_KEY)
        .then((value) => {
          if (active && value !== "true") setVisible(true);
        })
        .catch(() => {
          if (active) setVisible(true);
        });
      return () => {
        active = false;
        setVisible(false);
      };
    }, []),
  );

  const close = async (): Promise<void> => {
    try {
      if (dontShowAgain) {
        await secureStoreAdapter.setItem(DISMISSED_KEY, "true");
      }
    } finally {
      setVisible(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => void close()}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.heading}>
            <Text style={styles.icon}>🎙️</Text>
            <Pressable
              accessibilityLabel="Cerrar ayuda de voz"
              accessibilityRole="button"
              onPress={() => void close()}
              style={styles.closeButton}
            >
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>Añade la compra hablando</Text>
          <Text style={styles.body}>
            Pulsa el micrófono del buscador y dinos todos los productos y
            cantidades que quieras. Los transcribiremos a texto para que puedas
            revisarlos antes de añadirlos.
          </Text>
          <Pressable
            accessibilityLabel="No volver a mostrar esta ayuda"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dontShowAgain }}
            onPress={() => setDontShowAgain((current) => !current)}
            style={styles.checkboxRow}
          >
            <View
              style={[styles.checkbox, dontShowAgain && styles.checkboxChecked]}
            >
              {dontShowAgain ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.checkboxText}>No volver a mostrar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: "center",
      padding: spacing.lg,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: spacing.lg,
      gap: spacing.md,
    },
    heading: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    icon: { fontSize: 30 },
    closeButton: { padding: spacing.xs },
    close: { color: colors.muted, fontSize: 30, lineHeight: 30 },
    title: { color: colors.text, fontSize: 22, fontWeight: "800" },
    body: { color: colors.muted, lineHeight: 22 },
    checkboxRow: {
      flexDirection: "row",
      alignItems: "center",
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
    checkboxText: { color: colors.text, fontWeight: "600" },
  });
