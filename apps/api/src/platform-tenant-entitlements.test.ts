import { describe, expect, it } from "vitest";
import {
  PLATFORM_ENTITLEMENT_CONFIG_MAX_BYTES,
  parseLimitEntitlementKey,
  parseModuleEntitlementKey,
  parsePlatformLimitEntitlementPatch,
  parsePlatformModuleEntitlementPatch,
} from "./platform-tenant-entitlements";

describe("Platform entitlement HTTP validation", () => {
  it("accepts only canonical module and limit keys", () => {
    expect(parseModuleEntitlementKey("module.quotes")).toBe("module.quotes");
    expect(parseLimitEntitlementKey("limit.users")).toBe("limit.users");
    expect(() => parseModuleEntitlementKey("module.fake")).toThrow();
    expect(() => parseLimitEntitlementKey("module.quotes")).toThrow();
  });

  it("uses replace-object config semantics and rejects unsafe or oversized config", () => {
    expect(parsePlatformModuleEntitlementPatch({ config: {} })).toEqual({ config: {} });
    expect(() => parsePlatformModuleEntitlementPatch({ config: [] })).toThrow();
    expect(() => parsePlatformModuleEntitlementPatch({ config: null })).toThrow();
    expect(() =>
      parsePlatformModuleEntitlementPatch({
        config: JSON.parse('{"__proto__":{"polluted":true}}'),
      }),
    ).toThrow();
    expect(() =>
      parsePlatformModuleEntitlementPatch({
        config: { value: "x".repeat(PLATFORM_ENTITLEMENT_CONFIG_MAX_BYTES) },
      }),
    ).toThrow();
  });

  it("rejects empty/extra module patches and unsafe Decimal values", () => {
    expect(() => parsePlatformModuleEntitlementPatch({})).toThrow();
    expect(() => parsePlatformModuleEntitlementPatch({ source: "plan" })).toThrow();
    expect(parsePlatformLimitEntitlementPatch({ value: "9007199254740993" })).toEqual({
      value: "9007199254740993",
    });
    for (const value of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "unlimited",
      "1.00001",
      "10000000000000000",
    ]) {
      expect(() => parsePlatformLimitEntitlementPatch({ value })).toThrow();
    }
  });
});
