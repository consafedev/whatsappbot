import { describe, expect, it } from "vitest";
import { contrastRatio } from "./theme-color";
import { TENANT_THEME_PRESETS } from "./theme-presets";
import { resolveTenantTheme } from "./theme-resolver";
import { defaultTenantBranding } from "./theme-schema";

describe("tenant theme resolver", () => {
  it("resolves empty or invalid stored configuration to the default corporate-blue light theme", () => {
    for (const raw of [{}, null, undefined, "corporate-blue", { version: 1, preset: "x" }]) {
      const theme = resolveTenantTheme(raw);
      expect(theme.preset).toBe("corporate-blue");
      expect(theme.colorMode).toBe("light");
      expect(theme.logo).toBeNull();
      expect(theme.tokens.primary).toBe("#294f7c");
      expect(theme.tokens.surface).toBe("#ffffff");
    }
  });

  it("resolves preset and color mode from canonical configuration", () => {
    const theme = resolveTenantTheme({
      version: 1,
      preset: "premium-minimal",
      colorMode: "dark",
    });
    expect(theme.preset).toBe("premium-minimal");
    expect(theme.colorMode).toBe("dark");
    expect(theme.tokens.primary).toBe("#e8e4da");
  });

  it("passes the validated logo through", () => {
    const theme = resolveTenantTheme({
      version: 1,
      preset: "corporate-blue",
      colorMode: "light",
      logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
    });
    expect(theme.logo).toEqual({ kind: "url", url: "https://cdn.example.com/logo.png" });
  });

  it("derives deterministic tokens for custom colors", () => {
    const theme = resolveTenantTheme({
      version: 1,
      preset: "custom",
      colorMode: "light",
      colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
    });
    expect(theme.preset).toBe("custom");
    expect(theme.tokens.primary).toBe("#0b5394");
    expect(theme.tokens.onPrimary).toBe("#ffffff");
    expect(theme.tokens.canvas).toBe("#f7f8fa");
    expect(contrastRatio(theme.tokens.onPrimary, theme.tokens.primary)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(theme.tokens.accentText, theme.tokens.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("lightens the accent text token in dark mode when the accent is too dark for the surface", () => {
    const theme = resolveTenantTheme({
      version: 1,
      preset: "custom",
      colorMode: "dark",
      colors: { primary: "#0b5394", secondary: "#1e8449", accent: "#7b3fa0" },
    });
    expect(theme.tokens.accentText).not.toBe("#7b3fa0");
    expect(contrastRatio(theme.tokens.accentText, theme.tokens.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("keeps the default visible when the custom preset lacks colors (defensive)", () => {
    const theme = resolveTenantTheme(defaultTenantBranding());
    expect(theme.preset).toBe("corporate-blue");
    expect(theme.tokens.accentText).toBe("#294f7c");
  });
});

describe("tenant theme preset catalog", () => {
  it("defines every preset with legible tokens in both color modes", () => {
    for (const [key, preset] of Object.entries(TENANT_THEME_PRESETS)) {
      expect(preset.label.length).toBeGreaterThan(0);
      for (const mode of ["light", "dark"] as const) {
        const tokens = preset.tokens[mode];
        expect(
          contrastRatio(tokens.onPrimary, tokens.primary),
          `${key}/${mode} onPrimary`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrastRatio(tokens.text, tokens.canvas),
          `${key}/${mode} text`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens.muted, tokens.canvas),
          `${key}/${mode} muted`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens.accentText, tokens.surface),
          `${key}/${mode} accentText`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
