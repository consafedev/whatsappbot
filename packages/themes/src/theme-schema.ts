import { z } from "zod";
import { contrastRatio } from "./theme-color";

export const TENANT_PRESET_KEYS = [
  "professional-neutral",
  "corporate-blue",
  "industrial-precision",
  "premium-minimal",
  "modern-dark",
] as const;

export type TenantPresetKey = (typeof TENANT_PRESET_KEYS)[number];

export const CUSTOM_PRESET = "custom";

export type TenantPresetSelector = TenantPresetKey | typeof CUSTOM_PRESET;

export type TenantThemeColorMode = "light" | "dark";

export const tenantBrandingColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a #RRGGBB hex color")
  .transform((value) => value.toLowerCase());

export function colorKeepsWhiteTextContrast(value: string): boolean {
  try {
    return contrastRatio(value, "#ffffff") >= 3;
  } catch {
    return false;
  }
}

function logoUrlIsAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    if (hostname === "::1") return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      const [a, b] = hostname.split(".").map((part) => Number.parseInt(part, 10));
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b !== undefined && b >= 16 && b <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const tenantBrandingLogoUrlSchema = z
  .string()
  .trim()
  .url({ protocol: /^https$/i })
  .max(2048)
  .refine(logoUrlIsAllowed, "Logo URL must be a public HTTPS URL without credentials");

const tenantBrandingColorsSchema = z
  .object({
    primary: tenantBrandingColorSchema,
    secondary: tenantBrandingColorSchema,
    accent: tenantBrandingColorSchema,
  })
  .strict()
  .refine(
    (colors) =>
      [colors.primary, colors.secondary, colors.accent].every(colorKeepsWhiteTextContrast),
    "Brand colors must keep white-text contrast (contrast vs white >= 3.0)",
  );

export const tenantBrandingSchema = z
  .object({
    version: z.literal(1),
    preset: z.enum([...TENANT_PRESET_KEYS, CUSTOM_PRESET]),
    colorMode: z.enum(["light", "dark"]),
    colors: tenantBrandingColorsSchema.optional(),
    logo: z
      .object({ kind: z.literal("url"), url: tenantBrandingLogoUrlSchema })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.preset === CUSTOM_PRESET && value.colors === undefined) {
      context.addIssue({
        code: "custom",
        message: "Custom preset requires explicit brand colors",
        path: ["colors"],
      });
    }
  });

export type TenantBranding = z.infer<typeof tenantBrandingSchema>;
export type TenantBrandingColors = NonNullable<TenantBranding["colors"]>;
export type TenantBrandingLogo = NonNullable<TenantBranding["logo"]>;

export function parseTenantBranding(value: unknown): TenantBranding {
  return tenantBrandingSchema.parse(value);
}

export function defaultTenantBranding(): TenantBranding {
  return { version: 1, preset: "corporate-blue", colorMode: "light", logo: null };
}
