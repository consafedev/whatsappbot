export const FATAL_DISCONNECT_STATUS_CODES = [401, 403, 410] as const;

const FATAL_ERROR_PATTERNS = [
  /logged\s*out/i,
  /bad[-_]mac/i,
  /connection[-_]replaced/i,
  /multidevice[-_]mismatch/i,
  /account[-_]suspended/i,
  /banned/i,
];

/**
 * Calculates exponential backoff with jitter for channel reconnection attempts.
 *
 * @param attempt 1-indexed attempt number (e.g. 1, 2, 3...)
 * @param baseMs base backoff in milliseconds (default 2000ms)
 * @param maxMs maximum backoff in milliseconds (default 60000ms)
 * @param randomFactor optional random value between 0 and 1 for deterministic testing
 */
export function calculateBackoffDelay(
  attempt: number,
  baseMs = 2000,
  maxMs = 60000,
  randomFactor?: number,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(maxMs, baseMs * 2 ** (safeAttempt - 1));
  const factor =
    randomFactor !== undefined ? Math.max(0, Math.min(1, randomFactor)) : Math.random();
  // Full jitter: between 0.5 * exponential and 1.0 * exponential (or 0 to exponential)
  const jittered = Math.round(exponential * (0.5 + 0.5 * factor));
  return Math.min(maxMs, Math.max(0, jittered));
}

/**
 * Classifies Baileys/WhatsApp disconnect events into fatal (requires full re-auth / QR) vs transient (retryable).
 *
 * @param statusCode HTTP / Baileys DisconnectReason status code
 * @param error optional error object or error string
 */
export function isFatalDisconnectError(statusCode?: number, error?: Error | string): boolean {
  if (
    statusCode !== undefined &&
    FATAL_DISCONNECT_STATUS_CODES.includes(statusCode as 401 | 403 | 410)
  ) {
    return true;
  }

  const errorMessage =
    typeof error === "string" ? error : error instanceof Error ? error.message : "";

  if (
    errorMessage.length > 0 &&
    FATAL_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))
  ) {
    return true;
  }

  return false;
}
