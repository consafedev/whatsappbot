import type { AiKeyStatus } from "./types";

export interface KeyPoolEntry {
  readonly id: string;
  readonly providerConfigId?: string | undefined;
  readonly encryptedKey: string;
  readonly keyMask: string;
  readonly status: AiKeyStatus | string;
  readonly rateLimitedUntil?: Date | null | undefined;
  readonly priority: number;
  readonly totalCalls: number;
}

export function isKeyAvailable(key: KeyPoolEntry, now: Date = new Date()): boolean {
  if (key.status === "disabled") {
    return false;
  }
  if (key.status === "rate_limited") {
    if (key.rateLimitedUntil && key.rateLimitedUntil.getTime() <= now.getTime()) {
      return true;
    }
    return false;
  }
  return key.status === "active";
}

export function selectNextKey(
  keys: readonly KeyPoolEntry[],
  now: Date = new Date(),
): KeyPoolEntry | null {
  const available = keys.filter((key) => isKeyAvailable(key, now));
  if (available.length === 0) {
    return null;
  }

  const sorted = [...available].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return a.totalCalls - b.totalCalls;
  });

  return sorted[0] ?? null;
}

export const KeyPoolSelector = Object.freeze({
  selectNextKey,
});
