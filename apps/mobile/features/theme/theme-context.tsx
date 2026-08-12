import { createContext, useContext, useMemo } from "react";

import { themeColors, type ThemeColors, type ThemeMode } from "../../lib/theme";

export interface ThemeContextValue {
  colors: ThemeColors;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  colors: themeColors.light,
  mode: "light",
  setMode: () => undefined,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function useThemedStyles<T>(
  createStyles: (colors: ThemeColors) => T,
): T {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors, createStyles]);
}
