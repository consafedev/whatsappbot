import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  darken,
  hexToRgb,
  lighten,
  mix,
  normalizeHexColor,
  relativeLuminance,
  rgbToHex,
  ThemeColorError,
} from "./theme-color";

describe("theme color utilities", () => {
  it("parses and canonicalizes #RRGGBB colors", () => {
    expect(normalizeHexColor("#294F7C")).toBe("#294f7c");
    expect(hexToRgb("#294f7c")).toEqual({ r: 41, g: 79, b: 124 });
    expect(rgbToHex({ r: 41, g: 79, b: 124 })).toBe("#294f7c");
  });

  it("rejects malformed colors", () => {
    for (const value of ["red", "#fff", "#fffff", "#12345g", "rgb(1,2,3)", "url(#x)", "", "#"]) {
      expect(() => normalizeHexColor(value)).toThrow(ThemeColorError);
    }
  });

  it("computes reference contrast ratios", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "#000000")).toBeGreaterThanOrEqual(21);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
  });

  it("mixes, darkens and lightens deterministically", () => {
    expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(darken("#294f7c", 0)).toBe("#294f7c");
    expect(darken("#294f7c", 1)).toBe("#000000");
    expect(lighten("#294f7c", 1)).toBe("#ffffff");
    expect(darken("#294f7c", 0.5)).toBe(mix("#294f7c", "#000000", 0.5));
  });
});
