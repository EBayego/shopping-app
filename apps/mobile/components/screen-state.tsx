import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useThemedStyles, useTheme } from "../features/theme/theme-context";
import { spacing, type ThemeColors } from "../lib/theme";
import { AppButton } from "./app-button";

interface ScreenStateProps {
  title: string;
  message?: string;
  loading?: boolean;
  retry?: () => void;
}

export function ScreenState({
  title,
  message,
  loading = false,
  retry,
}: ScreenStateProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {retry ? <AppButton onPress={retry}>Reintentar</AppButton> : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      minHeight: 280,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.lg,
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
      textAlign: "center",
    },
    message: {
      color: colors.muted,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
    },
  });
