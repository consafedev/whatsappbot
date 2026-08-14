import type { ResolvedTenantTheme } from "@whatsapp-platform/themes";
import type { CSSProperties } from "react";

export function tenantShellStyle(branding: ResolvedTenantTheme): CSSProperties {
  const tokens = branding.tokens;
  return {
    "--tenant-primary": tokens.primary,
    "--tenant-primary-dark": tokens.primaryDark,
    "--tenant-on-primary": tokens.onPrimary,
    "--tenant-primary-soft": tokens.primarySoft,
    "--tenant-secondary": tokens.secondary,
    "--tenant-secondary-soft": tokens.secondarySoft,
    "--tenant-accent": tokens.accent,
    "--tenant-accent-text": tokens.accentText,
    "--tenant-accent-soft": tokens.accentSoft,
    "--tenant-canvas": tokens.canvas,
    "--tenant-surface": tokens.surface,
    "--tenant-border": tokens.border,
    "--tenant-muted": tokens.muted,
    "--tenant-text": tokens.text,
    colorScheme: branding.colorMode,
  } as CSSProperties;
}
