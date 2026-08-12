import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { useThemedStyles, useTheme } from "../features/theme/theme-context";
import { spacing, type ThemeColors } from "../lib/theme";

interface AppInputProps extends TextInputProps {
  label: string;
  error?: string | undefined;
  rightAccessory?: ReactNode;
}

export function AppInput({
  label,
  error,
  rightAccessory,
  style,
  ...props
}: AppInputProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, error ? styles.inputError : undefined]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          style={[styles.input, style]}
          {...props}
        />
        {rightAccessory ? (
          <View style={styles.rightAccessory}>{rightAccessory}</View>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { gap: spacing.xs },
    label: { color: colors.text, fontSize: 14, fontWeight: "600" },
    inputRow: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surface,
      flexDirection: "row",
      alignItems: "center",
    },
    input: {
      flex: 1,
      minHeight: 46,
      paddingHorizontal: spacing.md,
      color: colors.text,
      fontSize: 16,
    },
    rightAccessory: { paddingRight: spacing.sm },
    inputError: { borderColor: colors.danger },
    error: { color: colors.danger, fontSize: 13 },
  });
