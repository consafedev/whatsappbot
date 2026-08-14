import { defaultTenantBranding } from "@whatsapp-platform/themes";
import { describe, expect, it } from "vitest";
import { draftConfig, draftFromConfig, normalizeHexInput } from "./tenant-app-theme-form";

describe("tenant theme form", () => {
  it("canonicalizes hex color input", () => {
    expect(normalizeHexInput("#294F7C")).toBe("#294f7c");
    expect(normalizeHexInput("#294f7c")).toBe("#294f7c");
    expect(normalizeHexInput("red")).toBeNull();
    expect(normalizeHexInput("#fff")).toBeNull();
  });

  it("builds a preset draft config from the saved configuration", () => {
    const config = defaultTenantBranding();
    const draft = draftFromConfig(config);
    expect(draft.preset).toBe("corporate-blue");
    expect(draft.colorMode).toBe("light");
    expect(draft.colors.primary).toBe("#294f7c");
    expect(draft.logoUrl).toBe("");
    expect(draft.logoChanged).toBe(false);
  });

  it("produces a valid canonical config for a preset selection", () => {
    const config = draftConfig({
      preset: "premium-minimal",
      colorMode: "dark",
      colors: { primary: "#294f7c", secondary: "#294f7c", accent: "#294f7c" },
      logoUrl: "",
      logoChanged: false,
    });
    expect(config).toEqual({ version: 1, preset: "premium-minimal", colorMode: "dark" });
  });

  it("rejects invalid custom colors", () => {
    const config = draftConfig({
      preset: "custom",
      colorMode: "light",
      colors: { primary: "red", secondary: "#294f7c", accent: "#294f7c" },
      logoUrl: "",
      logoChanged: false,
    });
    expect(config).toBeNull();
  });

  it("produces a valid custom config with canonical colors", () => {
    const config = draftConfig({
      preset: "custom",
      colorMode: "light",
      colors: { primary: "#294F7C", secondary: "#1e8449", accent: "#7b3fa0" },
      logoUrl: "",
      logoChanged: false,
    });
    expect(config?.colors?.primary).toBe("#294f7c");
    expect(config?.colors?.secondary).toBe("#1e8449");
  });

  it("rejects custom colors that break white-text contrast", () => {
    const config = draftConfig({
      preset: "custom",
      colorMode: "light",
      colors: { primary: "#f0f0f0", secondary: "#294f7c", accent: "#294f7c" },
      logoUrl: "",
      logoChanged: false,
    });
    expect(config).toBeNull();
  });

  it("includes a validated logo when provided", () => {
    const config = draftConfig({
      preset: "corporate-blue",
      colorMode: "light",
      colors: { primary: "#294f7c", secondary: "#294f7c", accent: "#294f7c" },
      logoUrl: "https://cdn.example.com/logo.png",
      logoChanged: true,
    });
    expect(config?.logo).toEqual({ kind: "url", url: "https://cdn.example.com/logo.png" });
  });

  it("clears the logo when the field is emptied", () => {
    const config = draftConfig({
      preset: "corporate-blue",
      colorMode: "light",
      colors: { primary: "#294f7c", secondary: "#294f7c", accent: "#294f7c" },
      logoUrl: "",
      logoChanged: true,
    });
    expect(config?.logo).toBeNull();
  });

  it("rejects insecure logo URLs before saving", () => {
    const config = draftConfig({
      preset: "corporate-blue",
      colorMode: "light",
      colors: { primary: "#294f7c", secondary: "#294f7c", accent: "#294f7c" },
      logoUrl: "http://cdn.example.com/logo.png",
      logoChanged: true,
    });
    expect(config).toBeNull();
  });
});
