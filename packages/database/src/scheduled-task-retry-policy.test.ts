import { describe, expect, it } from "vitest";
import { calculateRetryDelayMs } from "./scheduled-task-retry-policy";

describe("calculateRetryDelayMs", () => {
  it("calculates deterministic exponential delays from the initial delay", () => {
    expect([0, 1, 2, 3].map((retryCount) => calculateRetryDelayMs(retryCount))).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
  });

  it("uses custom options and caps the delay", () => {
    expect(calculateRetryDelayMs(4, { initialDelayMs: 100, backoffMultiplier: 3 })).toBe(8_100);
    expect(calculateRetryDelayMs(10, { initialDelayMs: 5_000, maxDelayMs: 30_000 })).toBe(30_000);
  });

  it("adds repeatable per-task jitter inside a bounded ten percent window", () => {
    const options = { jitterSeed: "task-0001" };
    const delay = calculateRetryDelayMs(1, options);

    expect(delay).toBe(calculateRetryDelayMs(1, options));
    expect(delay).toBeGreaterThanOrEqual(10_000);
    expect(delay).toBeLessThanOrEqual(11_000);
    expect(calculateRetryDelayMs(1, { ...options, maxDelayMs: 10_500 })).toBeLessThanOrEqual(
      10_500,
    );
  });

  it("rejects invalid retry counts and options", () => {
    expect(() => calculateRetryDelayMs(-1)).toThrow(RangeError);
    expect(() => calculateRetryDelayMs(1.5)).toThrow(RangeError);
    expect(() => calculateRetryDelayMs(1, { initialDelayMs: -1 })).toThrow(RangeError);
    expect(() => calculateRetryDelayMs(1, { backoffMultiplier: 0.5 })).toThrow(RangeError);
    expect(() => calculateRetryDelayMs(1, { maxDelayMs: 0 })).toThrow(RangeError);
    expect(() => calculateRetryDelayMs(1, { jitterSeed: "" })).toThrow(RangeError);
  });
});
