export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  primaryPressed: string;
  border: string;
  danger: string;
  dangerBackground: string;
  successBackground: string;
}

export const lightColors: ThemeColors = {
  background: "#F6F7F3",
  surface: "#FFFFFF",
  text: "#1E2A21",
  muted: "#68736B",
  primary: "#217A4B",
  primaryPressed: "#175C38",
  border: "#DDE3DC",
  danger: "#B42318",
  dangerBackground: "#FEF3F2",
  successBackground: "#EAF7EF",
};

export const darkColors: ThemeColors = {
  background: "#111713",
  surface: "#1B241E",
  text: "#F2F6F3",
  muted: "#AAB7AE",
  primary: "#58C486",
  primaryPressed: "#78D69E",
  border: "#344239",
  danger: "#FF8A80",
  dangerBackground: "#3A211F",
  successBackground: "#173526",
};

export const themeColors: Record<ThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;
