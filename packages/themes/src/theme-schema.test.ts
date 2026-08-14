import { describe, expect, it } from "vitest";
import {
  colorKeepsWhiteTextContrast,
  defaultTenantBranding,
  tenantBrandingLogoUrlSchema,
  tenantBrandingSchema,
} from "./theme-schema";

describe("tenant branding schema", () => {
  it("accepts the canonical default configuration", () => {
    expect(tenantBrandingSchema.safeParse(defaultTenantBranding()).success).toBe(true);
  });

  it("accepts a preset with an explicit logo", () => {
    const parsed = tenantBrandingSchema.safeParse({
      version: 1,
      preset: "premium-minimal",
      colorMode: "dark",
      logo: { kind: "url", url: "https://cdn.example.com/logo.png" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.logo).toEqual({ kind: "url", url: "https://cdn.example.com/logo.png" });
  });

  it("requires explicit colors for the custom preset", () => {
    const result = tenantBrandingSchema.safeParse({
      version: 1,
      preset: "custom",
      colorMode: "light",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-canonical shapes and injection attempts", () => {
    const invalid: unknown[] = [
      {},
      { version: 2, preset: "corporate-blue", colorMode: "light" },
      { version: 1, preset: "not-a-preset", colorMode: "light" },
      { version: 1, preset: "corporate-blue", colorMode: "sepia" },
      { version: 1, preset: "corporate-blue", colorMode: "light", colors: {} },
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "red", secondary: "#294f7c", accent: "#294f7c" },
      },
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "#fff", secondary: "#294f7c", accent: "#294f7c" },
      },
      {
        version: 1,
        preset: "custom",
        colorMode: "light",
        colors: { primary: "url(https://evil.example)", secondary: "#294f7c", accent: "#294f7c" },
      },
      {
        version: 1,
        preset: "corporate-blue",
        colorMode: "light",
        extra: { css: "body{display:none}" },
      },
      {
        version: 1,
        preset: "corporate-blue",
        colorMode: "light",
        logo: { kind: "file", url: "x" },
      },
    ];
    for (const value of invalid) {
      expect(tenantBrandingSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("rejects colors that cannot keep white-text contrast", () => {
    expect(colorKeepsWhiteTextContrast("#f0f0f0")).toBe(false);
    expect(colorKeepsWhiteTextContrast("#294f7c")).toBe(true);
  });

  it("accepts public HTTPS logo URLs without credentials", () => {
    expect(tenantBrandingLogoUrlSchema.safeParse("https://cdn.example.com/logo.png").success).toBe(
      true,
    );
  });

  it("rejects private, local, credential-bearing and insecure logo URLs", () => {
    const denied: string[] = [
      "http://cdn.example.com/logo.png",
      "https://localhost/logo.png",
      "https://localhost:3000/logo.png",
      "https://tenant.local/logo.png",
      "https://app.internal/logo.png",
      "https://127.0.0.1/logo.png",
      "https://10.0.0.1/logo.png",
      "https://192.168.1.10/logo.png",
      "https://172.20.0.4/logo.png",
      "https://169.254.1.1/logo.png",
      "https://user:pass@cdn.example.com/logo.png",
      "not a url",
      `https://example.com/${"a".repeat(2100)}`,
    ];
    for (const url of denied) {
      expect(tenantBrandingLogoUrlSchema.safeParse(url).success, url).toBe(false);
    }
  });
});
