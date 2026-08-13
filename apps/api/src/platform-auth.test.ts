import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { PlatformLoginRateLimiter } from "./platform-auth";

describe("PlatformLoginRateLimiter", () => {
  it("limits repeated login attempts without waiting", () => {
    const limiter = new PlatformLoginRateLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(() => limiter.assertAllowed("admin@example.invalid", 1_000)).not.toThrow();
    }
    expect(() => limiter.assertAllowed("admin@example.invalid", 1_000)).toThrow(HttpException);
    expect(() => limiter.assertAllowed("admin@example.invalid", 61_001)).not.toThrow();
  });
});
