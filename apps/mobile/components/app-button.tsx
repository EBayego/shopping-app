import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from "react-native";

import { useThemedStyles, useTheme } from "../features/theme/theme-context";
import { spacing, type ThemeColors } from "../lib/theme";

type AppButtonProps = Omit<PressableProps, "children"> & {
  children: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  tone?: "primary" | "secondary" | "danger";
};

export function AppButton({
  children,
  disabled,
  icon,
  loading = false,
  tone = "primary",
  style,
  ...props
}: AppButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
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
        <View style={styles.content}>
          {icon}
          <Text
            style={[styles.label, tone !== "primary" && styles.secondaryLabel]}
          >
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    content: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "center",
    },
    label: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
    secondaryLabel: { color: colors.text },
  });
