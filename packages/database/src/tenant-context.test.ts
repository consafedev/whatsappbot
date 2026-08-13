import { describe, expect, it } from "vitest";
import { createTenantContext } from "./tenant-context";

describe("tenant context", () => {
  it("creates an immutable UUIDv7 tenant context", () => {
    const context = createTenantContext("01989f20-1000-7000-8000-000000000001");

    expect(context).toEqual({ tenantId: "01989f20-1000-7000-8000-000000000001" });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "01989f20-1000-4000-8000-000000000001",
    "01989f20-1000-7000-7000-000000000001",
  ])("rejects an invalid tenant id: %s", (tenantId) => {
    expect(() => createTenantContext(tenantId)).toThrowError("tenantId must be a valid UUIDv7");
  });
});
