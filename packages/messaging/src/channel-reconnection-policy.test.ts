import { describe, expect, it } from "vitest";
import { calculateBackoffDelay, isFatalDisconnectError } from "./channel-reconnection-policy";

describe("channel reconnection policy", () => {
  describe("calculateBackoffDelay", () => {
    it("calculates exponential growth with bounded limits", () => {
      // Deterministic factor 1.0 (maximum of jitter window)
      expect(calculateBackoffDelay(1, 2000, 60000, 1.0)).toBe(2000);
      expect(calculateBackoffDelay(2, 2000, 60000, 1.0)).toBe(4000);
      expect(calculateBackoffDelay(3, 2000, 60000, 1.0)).toBe(8000);
      expect(calculateBackoffDelay(4, 2000, 60000, 1.0)).toBe(16000);
      expect(calculateBackoffDelay(5, 2000, 60000, 1.0)).toBe(32000);
      expect(calculateBackoffDelay(6, 2000, 60000, 1.0)).toBe(60000); // capped at maxMs
      expect(calculateBackoffDelay(10, 2000, 60000, 1.0)).toBe(60000);
    });

    it("applies jitter within expected range", () => {
      // Minimum jitter factor 0.0 -> 0.5 * exponential
      expect(calculateBackoffDelay(1, 2000, 60000, 0.0)).toBe(1000);
      expect(calculateBackoffDelay(2, 2000, 60000, 0.0)).toBe(2000);

      // Mid-range jitter factor 0.5 -> 0.75 * exponential
      expect(calculateBackoffDelay(1, 2000, 60000, 0.5)).toBe(1500);

      // Dynamic without factor should always be within [0.5 * exp, exp]
      for (let attempt = 1; attempt <= 5; attempt++) {
        const delay = calculateBackoffDelay(attempt, 2000, 60000);
        const maxExp = Math.min(60000, 2000 * 2 ** (attempt - 1));
        const minExp = Math.round(maxExp * 0.5);
        expect(delay).toBeGreaterThanOrEqual(minExp);
        expect(delay).toBeLessThanOrEqual(maxExp);
      }
    });

    it("handles non-positive attempts safely", () => {
      expect(calculateBackoffDelay(0, 2000, 60000, 1.0)).toBe(2000);
      expect(calculateBackoffDelay(-5, 2000, 60000, 1.0)).toBe(2000);
    });
  });

  describe("isFatalDisconnectError", () => {
    it("identifies fatal status codes (401, 403, 410)", () => {
      expect(isFatalDisconnectError(401)).toBe(true);
      expect(isFatalDisconnectError(403)).toBe(true);
      expect(isFatalDisconnectError(410)).toBe(true);
    });

    it("identifies fatal error strings and error objects", () => {
      expect(isFatalDisconnectError(undefined, new Error("Connection closed: loggedOut"))).toBe(
        true,
      );
      expect(isFatalDisconnectError(undefined, "bad-mac verification error")).toBe(true);
      expect(
        isFatalDisconnectError(undefined, new Error("connection_replaced by other device")),
      ).toBe(true);
      expect(isFatalDisconnectError(undefined, "account_suspended by whatsapp")).toBe(true);
      expect(isFatalDisconnectError(undefined, "phone number banned")).toBe(true);
    });

    it("classifies transient errors as non-fatal", () => {
      expect(isFatalDisconnectError(503)).toBe(false);
      expect(isFatalDisconnectError(500)).toBe(false);
      expect(isFatalDisconnectError(408)).toBe(false);
      expect(isFatalDisconnectError(undefined, new Error("connectionLost"))).toBe(false);
      expect(isFatalDisconnectError(undefined, new Error("timedOut"))).toBe(false);
      expect(isFatalDisconnectError(undefined, "restartRequired")).toBe(false);
      expect(isFatalDisconnectError(undefined, new Error("network timeout"))).toBe(false);
      expect(isFatalDisconnectError()).toBe(false);
    });
  });
});
