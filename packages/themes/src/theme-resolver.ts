import { contrastRatio, darken, lighten, mix } from "./theme-color";
import {
  TENANT_COLOR_MODE_DEFAULTS,
  TENANT_THEME_PRESETS,
  type TenantThemeColorMode,
  type TenantThemeTokens,
} from "./theme-presets";
import {
  CUSTOM_PRESET,
  defaultTenantBranding,
  type TenantBranding,
  type TenantBrandingColors,
  type TenantPresetSelector,
  tenantBrandingSchema,
} from "./theme-schema";

export type ResolvedTenantTheme = Readonly<{
  colorMode: TenantThemeColorMode;
  logo: Readonly<{ kind: "url"; url: string }> | null;
  preset: TenantPresetSelector;
  tokens: TenantThemeTokens;
}>;

const ACCENT_TEXT_MIN_CONTRAST = 4.5;
const ACCENT_LIGHTEN_STEPS = 40;
const ACCENT_LIGHTEN_STEP = 0.08;

function deriveCustomTokens(
  colors: TenantBrandingColors,
  mode: TenantThemeColorMode,
): TenantThemeTokens {
  const defaults = TENANT_COLOR_MODE_DEFAULTS[mode];
  const primary = colors.primary;
  const primaryDark = darken(primary, 0.16);
  const onPrimary = contrastRatio(primary, "#ffffff") >= 3 ? "#ffffff" : "#111827";
  const primarySoft = mix(primary, defaults.canvas, 0.08);
  const secondary = colors.secondary;
  const secondarySoft = mix(secondary, defaults.canvas, 0.08);
  const accent = colors.accent;
  const accentSoft = mix(accent, defaults.canvas, 0.08);
  let accentText = accent;
  if (contrastRatio(accentText, defaults.surface) < ACCENT_TEXT_MIN_CONTRAST) {
    for (let step = 0; step < ACCENT_LIGHTEN_STEPS; step += 1) {
      accentText = lighten(accentText, ACCENT_LIGHTEN_STEP);
      if (contrastRatio(accentText, defaults.surface) >= ACCENT_TEXT_MIN_CONTRAST) break;
    }
  }
  return {
    primary,
    primaryDark,
    onPrimary,
    primarySoft,
    secondary,
    secondarySoft,
    accent,
    accentText,
    accentSoft,
    ...defaults,
  };
}

export function resolveTenantTheme(raw: unknown): ResolvedTenantTheme {
  const parsed = tenantBrandingSchema.safeParse(raw);
  if (!parsed.success) {
    return resolveTenantTheme(defaultTenantBranding());
  }
  return themeFromBranding(parsed.data);
}

export function themeFromBranding(branding: TenantBranding): ResolvedTenantTheme {
  if (branding.preset === CUSTOM_PRESET) {
    if (branding.colors === undefined) {
      return resolveTenantTheme(defaultTenantBranding());
    }
    return {
      colorMode: branding.colorMode,
      logo: branding.logo ?? null,
      preset: CUSTOM_PRESET,
      tokens: deriveCustomTokens(branding.colors, branding.colorMode),
    };
  }
  const preset = TENANT_THEME_PRESETS[branding.preset];
  return {
    colorMode: branding.colorMode,
    logo: branding.logo ?? null,
    preset: branding.preset,
    tokens: preset.tokens[branding.colorMode],
  };
}
