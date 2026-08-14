import {
  CUSTOM_PRESET,
  TENANT_THEME_PRESETS,
  type TenantBranding,
  type TenantBrandingColors,
  type TenantPresetSelector,
  type TenantThemeColorMode,
  tenantBrandingSchema,
} from "@whatsapp-platform/themes";

export type TenantThemeDraft = Readonly<{
  preset: TenantPresetSelector;
  colorMode: TenantThemeColorMode;
  colors: TenantBrandingColors;
  logoUrl: string;
  logoChanged: boolean;
}>;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function draftFromConfig(config: TenantBranding): TenantThemeDraft {
  const preset = config.preset === CUSTOM_PRESET ? "corporate-blue" : config.preset;
  const presetColors = TENANT_THEME_PRESETS[preset].tokens[config.colorMode];
  return {
    preset: config.preset,
    colorMode: config.colorMode,
    colors: config.colors ?? {
      primary: presetColors.primary,
      secondary: presetColors.secondary,
      accent: presetColors.accent,
    },
    logoUrl: config.logo?.url ?? "",
    logoChanged: false,
  };
}

export function normalizeHexInput(value: string): string | null {
  return HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function draftConfig(draft: TenantThemeDraft): TenantBranding | null {
  const base: Record<string, unknown> = {
    version: 1,
    preset: draft.preset,
    colorMode: draft.colorMode,
  };
  if (draft.preset === CUSTOM_PRESET) {
    const primary = normalizeHexInput(draft.colors.primary);
    const secondary = normalizeHexInput(draft.colors.secondary);
    const accent = normalizeHexInput(draft.colors.accent);
    if (primary === null || secondary === null || accent === null) return null;
    base.colors = { primary, secondary, accent };
  }
  if (draft.logoChanged) {
    const url = draft.logoUrl.trim();
    base.logo = url === "" ? null : { kind: "url", url };
  }
  const parsed = tenantBrandingSchema.safeParse(base);
  return parsed.success ? parsed.data : null;
}
