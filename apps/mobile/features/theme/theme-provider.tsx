import type { PropsWithChildren } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";

import { themeColors, type ThemeMode } from "../../lib/theme";
import { secureStoreAdapter } from "../../services/secure-store-adapter";
import { ThemeContext, type ThemeContextValue } from "./theme-context";

const THEME_STORAGE_KEY = "shopping-app-theme";

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>("light");

  useEffect(() => {
    let active = true;
    void secureStoreAdapter
      .getItem(THEME_STORAGE_KEY)
      .then((storedMode) => {
        if (active && (storedMode === "light" || storedMode === "dark")) {
          setModeState(storedMode);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(mode);
  }, [mode]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    void secureStoreAdapter
      .setItem(THEME_STORAGE_KEY, nextMode)
      .catch(() => undefined);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: themeColors[mode], mode, setMode }),
    [mode, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
