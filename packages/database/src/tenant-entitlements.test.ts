import { describe, expect, it } from "vitest";
import { tenantEntitlementEffective, tenantEntitlementStatus } from "./tenant-entitlements";

const boundary = new Date("2026-08-13T12:00:00.000Z");

describe("tenant entitlement temporal semantics", () => {
  it("treats startsAt equal to now as effective", () => {
    const row = { enabled: true, endsAt: null, startsAt: boundary };
    expect(tenantEntitlementEffective(row, boundary)).toBe(true);
    expect(tenantEntitlementStatus(row, boundary)).toBe("effective");
  });

  it("treats endsAt equal to now as expired", () => {
    const row = { enabled: true, endsAt: boundary, startsAt: null };
    expect(tenantEntitlementEffective(row, boundary)).toBe(false);
    expect(tenantEntitlementStatus(row, boundary)).toBe("expired");
  });

  it("distinguishes disabled, scheduled, expired and effective", () => {
    expect(
      tenantEntitlementStatus({ enabled: false, endsAt: null, startsAt: null }, boundary),
    ).toBe("disabled");
    expect(
      tenantEntitlementStatus(
        { enabled: true, endsAt: null, startsAt: new Date(boundary.getTime() + 1) },
        boundary,
      ),
    ).toBe("scheduled");
    expect(
      tenantEntitlementStatus(
        { enabled: true, endsAt: new Date(boundary.getTime() - 1), startsAt: null },
        boundary,
      ),
    ).toBe("expired");
    expect(
      tenantEntitlementStatus(
        {
          enabled: true,
          endsAt: new Date(boundary.getTime() + 1),
          startsAt: new Date(boundary.getTime() - 1),
        },
        boundary,
      ),
    ).toBe("effective");
  });
});
