import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";

import { colors, spacing } from "../lib/theme";

type AppButtonProps = Omit<PressableProps, "children"> & {
  children: ReactNode;
  loading?: boolean;
  tone?: "primary" | "secondary" | "danger";
};

export function AppButton({
  children,
  disabled,
  loading = false,
  tone = "primary",
  style,
  ...props
}: AppButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        styles[tone],
        state.pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={tone === "primary" ? "#FFFFFF" : colors.primary}
        />
      ) : (
        <Text
          style={[styles.label, tone !== "primary" && styles.secondaryLabel]}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border },
  danger: {
    backgroundColor: colors.dangerBackground,
    borderColor: colors.danger,
  },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  label: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  secondaryLabel: { color: colors.text },
});
