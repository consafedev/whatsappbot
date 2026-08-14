import type { TenantPresetKey } from "./theme-schema";

export type TenantThemeColorMode = "light" | "dark";

export type TenantThemeTokens = Readonly<{
  primary: string;
  primaryDark: string;
  onPrimary: string;
  primarySoft: string;
  secondary: string;
  secondarySoft: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  canvas: string;
  surface: string;
  border: string;
  muted: string;
  text: string;
}>;

export type TenantThemePreset = Readonly<{
  label: string;
  description: string;
  tokens: Readonly<Record<TenantThemeColorMode, TenantThemeTokens>>;
}>;

export const TENANT_THEME_PRESETS: Readonly<Record<TenantPresetKey, TenantThemePreset>> = {
  "corporate-blue": {
    label: "Corporate Blue",
    description: "Azul corporativo con superficies claras.",
    tokens: {
      light: {
        primary: "#294f7c",
        primaryDark: "#1f3c60",
        onPrimary: "#ffffff",
        primarySoft: "#e9f0f8",
        secondary: "#3b6ea5",
        secondarySoft: "#edf3f9",
        accent: "#294f7c",
        accentText: "#294f7c",
        accentSoft: "#e9f0f8",
        canvas: "#f7f8fa",
        surface: "#ffffff",
        border: "#dfe4ea",
        muted: "#64717d",
        text: "#1f2933",
      },
      dark: {
        primary: "#4f82b8",
        primaryDark: "#3d6a9c",
        onPrimary: "#0d1622",
        primarySoft: "#263a4f",
        secondary: "#7ba3c9",
        secondarySoft: "#263242",
        accent: "#7ba3c9",
        accentText: "#8fb2d4",
        accentSoft: "#223449",
        canvas: "#151a21",
        surface: "#1e2631",
        border: "#2e3a4a",
        muted: "#94a3b8",
        text: "#e6ebf2",
      },
    },
  },
  "professional-neutral": {
    label: "Professional Neutral",
    description: "Grises neutros y sobrios para operaciones formales.",
    tokens: {
      light: {
        primary: "#3c4251",
        primaryDark: "#2c3140",
        onPrimary: "#ffffff",
        primarySoft: "#eef0f4",
        secondary: "#6b7280",
        secondarySoft: "#f1f3f6",
        accent: "#3c4251",
        accentText: "#3c4251",
        accentSoft: "#eef0f4",
        canvas: "#f8f9fa",
        surface: "#ffffff",
        border: "#e2e5ea",
        muted: "#6b7280",
        text: "#1f2430",
      },
      dark: {
        primary: "#a9b1c0",
        primaryDark: "#8d96a6",
        onPrimary: "#171a21",
        primarySoft: "#2a2f3a",
        secondary: "#7d8796",
        secondarySoft: "#252a33",
        accent: "#a9b1c0",
        accentText: "#b6bdc9",
        accentSoft: "#262c37",
        canvas: "#16181d",
        surface: "#1e2128",
        border: "#2d323c",
        muted: "#98a1ae",
        text: "#e8ebf0",
      },
    },
  },
  "industrial-precision": {
    label: "Industrial Precision",
    description: "Acero y ámbar para operaciones industriales.",
    tokens: {
      light: {
        primary: "#2f3e46",
        primaryDark: "#243138",
        onPrimary: "#ffffff",
        primarySoft: "#e8ecee",
        secondary: "#c2410c",
        secondarySoft: "#fbeae4",
        accent: "#c2410c",
        accentText: "#c2410c",
        accentSoft: "#fbeae4",
        canvas: "#f7f7f6",
        surface: "#ffffff",
        border: "#e1e3e3",
        muted: "#636e72",
        text: "#1e262b",
      },
      dark: {
        primary: "#8a9ba6",
        primaryDark: "#6f7f8a",
        onPrimary: "#131a1f",
        primarySoft: "#28343c",
        secondary: "#ff8a5c",
        secondarySoft: "#33231b",
        accent: "#ff8a5c",
        accentText: "#ffa07f",
        accentSoft: "#33231b",
        canvas: "#14181b",
        surface: "#1b2126",
        border: "#2b333a",
        muted: "#9aa6ae",
        text: "#e7ecef",
      },
    },
  },
  "premium-minimal": {
    label: "Premium Minimal",
    description: "Casi negro y dorado para marcas premium.",
    tokens: {
      light: {
        primary: "#101418",
        primaryDark: "#000000",
        onPrimary: "#ffffff",
        primarySoft: "#e9ebed",
        secondary: "#8a6d1f",
        secondarySoft: "#f6f0dd",
        accent: "#8a6d1f",
        accentText: "#8a6d1f",
        accentSoft: "#f3ecd9",
        canvas: "#fafafa",
        surface: "#ffffff",
        border: "#e6e6e6",
        muted: "#6b6b6b",
        text: "#141414",
      },
      dark: {
        primary: "#e8e4da",
        primaryDark: "#c9c3b2",
        onPrimary: "#141414",
        primarySoft: "#2c2a24",
        secondary: "#d4b46a",
        secondarySoft: "#2c2618",
        accent: "#d4b46a",
        accentText: "#dfc58a",
        accentSoft: "#2c2618",
        canvas: "#121212",
        surface: "#1a1a1a",
        border: "#2c2c2c",
        muted: "#9d9d9d",
        text: "#ececec",
      },
    },
  },
  "modern-dark": {
    label: "Modern Dark",
    description: "Índigo vibrante pensado para entornos oscuros.",
    tokens: {
      light: {
        primary: "#4f46e5",
        primaryDark: "#4338ca",
        onPrimary: "#ffffff",
        primarySoft: "#eef2ff",
        secondary: "#7c3aed",
        secondarySoft: "#f3eefe",
        accent: "#4f46e5",
        accentText: "#4f46e5",
        accentSoft: "#eef2ff",
        canvas: "#f7f8fc",
        surface: "#ffffff",
        border: "#e2e6f2",
        muted: "#64708c",
        text: "#1f2434",
      },
      dark: {
        primary: "#818cf8",
        primaryDark: "#6366f1",
        onPrimary: "#131530",
        primarySoft: "#232a4d",
        secondary: "#a78bfa",
        secondarySoft: "#2a2344",
        accent: "#a78bfa",
        accentText: "#b4a6fc",
        accentSoft: "#2a2344",
        canvas: "#0f1220",
        surface: "#171b2e",
        border: "#262c47",
        muted: "#9aa2c4",
        text: "#e9ecf7",
      },
    },
  },
};

export const TENANT_PRESET_LABELS: Readonly<Record<TenantPresetKey, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(TENANT_THEME_PRESETS).map(([key, preset]) => [key, preset.label]),
  ) as Record<TenantPresetKey, string>,
);

export const TENANT_COLOR_MODE_DEFAULTS: Readonly<
  Record<
    TenantThemeColorMode,
    Pick<TenantThemeTokens, "canvas" | "surface" | "border" | "muted" | "text">
  >
> = Object.freeze({
  light: {
    canvas: "#f7f8fa",
    surface: "#ffffff",
    border: "#dfe4ea",
    muted: "#64717d",
    text: "#1f2933",
  },
  dark: {
    canvas: "#151a21",
    surface: "#1e2631",
    border: "#2e3a4a",
    muted: "#94a3b8",
    text: "#e6ebf2",
  },
});
