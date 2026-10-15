import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppInput } from "../../components/app-input";
import { useThemedStyles } from "../theme/theme-context";
import type { ThemeColors } from "../../lib/theme";
import { productIcon } from "./product-icons";

export function QuickAddPanel({
  adding,
  onAdd,
  onVoicePress,
}: {
  adding: boolean;
  onAdd: (text: string) => Promise<unknown>;
  onVoicePress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const name = text.trim();
  const submit = async () => {
    if (!name || adding || submitting) return;
    setSubmitting(true);
    try {
      await onAdd(name);
      setText((current) => (current === text ? "" : current));
    } catch {
      // The parent displays the error. Preserve the draft for retry.
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View style={styles.panel}>
      <AppInput
        label="Añadir a la lista"
        placeholder="¿Qué necesitas?"
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => void submit()}
        returnKeyType="done"
        rightAccessory={
          <Pressable
            accessibilityLabel="Añadir productos por voz"
            accessibilityRole="button"
            onPress={onVoicePress}
            style={styles.voice}
          >
            <Text style={styles.voiceText}>🎙️</Text>
          </Pressable>
        }
      />
      {name ? (
        <Pressable
          accessibilityLabel={`Añadir ${name}`}
          accessibilityRole="button"
          disabled={adding || submitting}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.tile,
            pressed && styles.pressed,
            (adding || submitting) && styles.disabled,
          ]}
        >
          <Text style={styles.icon} accessible={false}>
            {productIcon(name)}
          </Text>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.hint}>
            {adding || submitting ? "Añadiendo…" : "+ Añadir"}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.help}>
          Escribe un nombre y añádelo. Puedes enlazarlo con un supermercado
          después.
        </Text>
      )}
    </View>
  );
}
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    panel: { gap: 12 },
    voice: { padding: 10 },
    voiceText: { fontSize: 22 },
    tile: {
      width: "48%",
      minHeight: 154,
      borderRadius: 24,
      padding: 16,
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.successBackground,
    },
    icon: { fontSize: 44 },
    name: {
      color: colors.text,
      textAlign: "center",
      fontSize: 17,
      fontWeight: "700",
    },
    hint: { color: colors.primary, fontSize: 14, fontWeight: "700" },
    help: { color: colors.muted, lineHeight: 20 },
    pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
    disabled: { opacity: 0.5 },
  });
