export class ThemeColorError extends Error {
  override readonly name = "ThemeColorError";
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(value: string): string {
  if (!HEX_COLOR_PATTERN.test(value)) {
    throw new ThemeColorError(`Invalid hex color: ${value}`);
  }
  return value.toLowerCase();
}

export type RgbColor = Readonly<{ r: number; g: number; b: number }>;

export function hexToRgb(value: string): RgbColor {
  const hex = normalizeHexColor(value);
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function hexChannel(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

export function rgbToHex(color: RgbColor): string {
  return `#${hexChannel(color.r)}${hexChannel(color.g)}${hexChannel(color.b)}`;
}

export function relativeLuminance(value: string): number {
  const { r, g, b } = hexToRgb(value);
  const linear = (channel: number): number => {
    const ratio = channel / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mix(first: string, second: string, firstWeight: number): string {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const channel = (fromA: number, fromB: number): number =>
    Math.round(fromA * firstWeight + fromB * (1 - firstWeight));
  return rgbToHex({ r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b) });
}

export function darken(value: string, amount: number): string {
  return mix(value, "#000000", 1 - amount);
}

export function lighten(value: string, amount: number): string {
  return mix(value, "#ffffff", 1 - amount);
}
