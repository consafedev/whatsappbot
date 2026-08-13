import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { TenantAuthRateLimiter } from "./tenant-auth";

describe("TenantAuthRateLimiter", () => {
  it("keeps independent no-sleep buckets", () => {
    const limiter = new TenantAuthRateLimiter();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(() => limiter.assertAllowed("login", "key", 20, 1_000)).not.toThrow();
    }
    expect(() => limiter.assertAllowed("login", "key", 20, 1_000)).toThrow(HttpException);
    expect(() => limiter.assertAllowed("reset-request", "key", 5, 1_000)).not.toThrow();
    expect(() => limiter.assertAllowed("login", "key", 20, 61_001)).not.toThrow();
  });
});
